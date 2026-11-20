// The sidebar panel's logic, independent of the editor: state, data per tab, and the small,
// validated requests the panel sends back. Only paths the panel was shown can be opened or
// acted on, and only known tabs, scopes, sorts, branches and actions are accepted.

import { defaultConfig } from "../core/config";
import { askClaude } from "../node/claude";
import * as git from "../node/git";
import type { Project } from "../node/project";
import {
  ACTIONS,
  BATCHES,
  FromWebview,
  HostWording,
  Scope,
  SCOPES,
  Sort,
  SORTS,
  Tab,
  TABS,
  ToWebview,
  UpdateMessage,
  ViewData,
} from "../shared/protocol";
import { ActionContext, BATCH_ACTIONS, FILE_ACTIONS } from "./actions";
import { DataBuilder, Progress } from "./data";
import type { HostPort } from "./host";

/** The project and file the editor is on. */
export interface Current {
  project?: Project;
  rel?: string;
  errors: string[];
  trusted: boolean;
}

export interface PanelInfo {
  about: UpdateMessage["about"];
  wording: HostWording;
}

type Handlers = { [K in FromWebview["type"]]: (m: Extract<FromWebview, { type: K }>, c: Current) => unknown };

const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

/** User-requested actions are never cancelled by a panel refresh. */
const UNCANCELLED: Progress = { onProgress: () => undefined, isCancelled: () => false };

export class PanelController {
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private builders = new WeakMap<Project, DataBuilder>();
  /** Paths shown in the last update (only these can be opened or acted on). */
  private known = new Set<string>();
  private refs: string[] = [];

  constructor(
    private readonly host: HostPort,
    private readonly current: () => Current,
    private readonly info: PanelInfo,
    /** Answers a prompt in the repo folder; Claude Code unless a test passes its own. */
    private readonly ai?: (prompt: string, root: string) => Promise<string>,
  ) {}

  refreshSoon(delayMs = 400, invalidate = false): void {
    if (invalidate) this.builders = new WeakMap();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), delayMs);
  }

  private builder(p: Project): DataBuilder {
    let b = this.builders.get(p);
    if (!b) {
      b = new DataBuilder(p, Math.min(20000, Math.max(100, this.host.getSetting("maxFiles", 3000))));
      this.builders.set(p, b);
    }
    return b;
  }

  private state(): { tab: Tab; scope: Scope; sort: Sort; compare: string } {
    const tab = this.host.getState("tab", "report");
    const scope = this.host.getSetting("scope", "changed");
    const sort = this.host.getSetting("sort", "payoff");
    const compare = this.host.getState("compare", "HEAD");
    return {
      tab: oneOf(tab, TABS) ? tab : "report",
      scope: oneOf(scope, SCOPES) ? scope : "changed",
      sort: oneOf(sort, SORTS) ? sort : "payoff",
      compare: compare === "HEAD" || this.refs.includes(compare) ? compare : "HEAD",
    };
  }

  private ignoredKey = (p: Project) => `ignored:${p.root}`;

  private progress(gen: number): Progress {
    return {
      onProgress: (done, total) => gen === this.generation && this.post({ type: "progress", done, total }),
      isCancelled: () => gen !== this.generation,
    };
  }

  private post(m: ToWebview): void {
    this.host.post(m);
  }

  private base(c: Current, st: ReturnType<PanelController["state"]>): Omit<UpdateMessage, "loading" | "data" | "truncated"> {
    return {
      type: "update",
      ...st,
      refs: this.refs,
      trusted: c.trusted,
      configErrors: c.errors,
      ...this.info,
      fixCommits: (c.project?.config ?? defaultConfig()).verdicts.fixCommits,
    };
  }

  /** Builds the data for the current tab. */
  private load(project: Project, st: ReturnType<PanelController["state"]>, rel: string | undefined, p: Progress) {
    const b = this.builder(project);
    if (st.tab === "change") return b.change(st.compare, p);
    if (st.tab === "todo") return b.todo(this.host.getState<string[]>(this.ignoredKey(project), []), p);
    return b.report(st.scope, st.sort, rel, p);
  }

  async refresh(): Promise<void> {
    if (!this.host.visible()) return;
    const gen = ++this.generation;
    const c = this.current();
    if (c.project && c.trusted) this.refs = safeBranches(c.project.root);
    const st = this.state();
    const base = this.base(c, st);
    if (!c.project) return this.post({ ...base, loading: false, data: {}, truncated: false, empty: "Open a folder to see its complexity." });
    this.post({ ...base, loading: true, data: {}, truncated: false });
    try {
      const out = await this.load(c.project, st, c.rel, this.progress(gen));
      if (!out || gen !== this.generation) return;
      this.known = collectPaths(out.data);
      this.post({ ...base, loading: false, data: out.data, truncated: out.truncated });
    } catch (e) {
      if (gen === this.generation) this.post({ ...base, loading: false, data: {}, truncated: false, error: (e as Error).message });
    }
  }

  private readonly handlers: Handlers = {
    ready: () => this.refresh(),
    refresh: () => this.refresh(),
    tab: async (m) => {
      if (oneOf(m.value, TABS)) await this.host.setState("tab", m.value);
      return this.refresh();
    },
    compare: async (m) => {
      if (m.value === "HEAD" || this.refs.includes(m.value)) await this.host.setState("compare", m.value);
      return this.refresh();
    },
    scope: (m) => oneOf(m.value, SCOPES) && this.host.setSetting("scope", m.value),
    sort: (m) => oneOf(m.value, SORTS) && this.host.setSetting("sort", m.value),
    open: (m, c) => this.open(c, m.path, m.line),
    detail: (m, c) => this.sendDetail(c, m.path),
    action: (m, c) => this.action(c, m),
    batch: (m, c) => this.batch(c, m.kind),
    openConfig: () => this.host.run("openConfig"),
    installHook: () => this.host.run("installHook"),
    openRepo: () => this.host.run("openRepo"),
  };

  /** Handles one message from the panel; anything malformed or unknown is ignored. */
  async onMessage(m: unknown): Promise<void> {
    const type = (m as { type?: unknown } | null)?.type;
    if (typeof type !== "string" || !Object.hasOwn(this.handlers, type)) return;
    const handler = this.handlers[type as FromWebview["type"]] as (m: FromWebview, c: Current) => unknown;
    await handler(m as FromWebview, this.current());
  }

  /** Paths must be repo files that are in view or reachable from a shown detail. */
  private allowed(c: Current, p: unknown): p is string {
    return typeof p === "string" && !!c.project && (this.known.has(p) || c.project.includes(p)) && !!c.project.absolute(p);
  }

  private async open(c: Current, p: unknown, line: unknown): Promise<void> {
    const abs = this.allowed(c, p) ? c.project?.absolute(p) : undefined;
    if (!abs) return;
    await this.host.openFile(abs, typeof line === "number" && Number.isInteger(line) && line > 0 ? line : 1);
  }

  private async sendDetail(c: Current, p: unknown): Promise<void> {
    if (!this.allowed(c, p) || !c.project) return;
    const d = await this.builder(c.project).detail(p, this.progress(this.generation));
    if (!d) return this.post({ type: "detailError", path: p, text: "This file can't be analysed." });
    for (const x of [...d.dependents, ...d.internalImports]) this.known.add(x);
    this.post({ type: "detail", detail: d });
  }

  private context(project: Project): ActionContext {
    const b = this.builder(project);
    const key = this.ignoredKey(project);
    const ignored = () => this.host.getState<string[]>(key, []);
    return {
      host: this.host,
      project,
      askAi: (prompt) => (this.ai ? this.ai(prompt, project.root) : askClaude(prompt, project.root, this.host.getSetting("claudePath", ""))),
      detail: (rel) => b.detail(rel, UNCANCELLED),
      changeItems: () => b.changeItems(this.state().compare, UNCANCELLED),
      topFix: () => b.topFix(UNCANCELLED, ignored()),
      ignored,
      setIgnored: async (list) => {
        await this.host.setState(key, list);
        this.refreshSoon(0);
      },
    };
  }

  /** Runs a user action with progress; failures are shown, never silent. */
  private async guarded(title: string, run: () => Promise<void>, progress = true): Promise<void> {
    try {
      await (progress ? this.host.withProgress(`Complexity Lens: ${title}…`, run) : run());
    } catch (e) {
      this.host.notify("error", `Complexity Lens: ${title} failed: ${(e as Error).message}`);
    }
  }

  private async action(c: Current, m: Extract<FromWebview, { type: "action" }>): Promise<void> {
    if (!c.project || !oneOf(m.kind, ACTIONS) || !this.allowed(c, m.path)) return;
    const strategy = FILE_ACTIONS[m.kind];
    if (strategy.editsFiles && !c.trusted) return this.host.notify("warning", "Complexity Lens: trust this workspace to edit files.");
    const ctx = this.context(c.project);
    const fn = typeof m.fn === "string" ? m.fn : undefined;
    await this.guarded(strategy.title, () => strategy.run(ctx, m.path, fn), !strategy.ownProgress);
  }

  private async batch(c: Current, kind: unknown): Promise<void> {
    if (!c.project || !oneOf(kind, BATCHES)) return;
    const ctx = this.context(c.project);
    await this.guarded(BATCH_ACTIONS[kind].title, () => BATCH_ACTIONS[kind].run(ctx));
  }
}

function safeBranches(root: string): string[] {
  try {
    return git.listBranches(root);
  } catch {
    return [];
  }
}

function collectPaths(data: ViewData): Set<string> {
  const rows = [...(data.report ?? []), ...(data.change?.items ?? []), ...(data.todo?.fix ?? []), ...(data.todo?.plan ?? []), ...(data.todo?.leave ?? [])];
  return new Set([...rows.map((r) => r.path), ...(data.todo?.ignored ?? [])]);
}
