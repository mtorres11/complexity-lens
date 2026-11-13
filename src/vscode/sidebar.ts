// The sidebar webview controller. All data shown comes from the extension; the webview only
// sends back small, validated requests (switch tab, open a file, run an action on a file).

import { randomBytes } from "crypto";
import * as vscode from "vscode";
import * as git from "../core/git";
import type { Project } from "../core/project";
import type { About } from "./about";
import { runAction, runBatch } from "./actions";
import { DataBuilder, Progress } from "./data";
import {
  ACTIONS,
  BATCHES,
  FromWebview,
  Scope,
  SCOPES,
  Sort,
  SORTS,
  TABS,
  ToWebview,
  UpdateMessage,
} from "./protocol";

export interface Current {
  project?: Project;
  rel?: string;
  errors: string[];
  trusted: boolean;
}

const ACTION_TITLE: Record<(typeof ACTIONS)[number], string> = {
  fixPrompt: "preparing the fix prompt",
  ticket: "preparing the ticket draft",
  chore: "preparing the chore",
  accept: "accepting the function",
  ignore: "ignoring the file",
  unignore: "showing the file again",
};
const BATCH_TITLE: Record<(typeof BATCHES)[number], string> = {
  fixAll: "preparing the fix-all prompt",
  prSummary: "preparing the PR summary",
  tickets: "preparing ticket drafts",
  choreList: "preparing the chore list",
};

const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

export class Sidebar implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private generation = 0;
  private timer?: NodeJS.Timeout;
  private builders = new WeakMap<Project, DataBuilder>();
  /** Paths shown in the last update (only these can be opened or acted on). */
  private known = new Set<string>();
  private refs: string[] = [];

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly current: () => Current,
    private readonly about: About,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);
    view.webview.onDidReceiveMessage(
      (m) => void this.onMessage(m as FromWebview),
    );
    view.onDidChangeVisibility(() => view.visible && this.refreshSoon(0));
  }

  refreshSoon(delayMs = 400, invalidate = false): void {
    if (invalidate) this.builders = new WeakMap();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), delayMs);
  }

  private builder(p: Project): DataBuilder {
    let b = this.builders.get(p);
    if (!b) {
      const max = Math.min(
        20000,
        Math.max(
          100,
          vscode.workspace
            .getConfiguration("complexityLens")
            .get<number>("maxFiles", 3000),
        ),
      );
      b = new DataBuilder(p, max);
      this.builders.set(p, b);
    }
    return b;
  }

  private state() {
    const c = vscode.workspace.getConfiguration("complexityLens");
    const scope = c.get<string>("scope", "changed");
    const sort = c.get<string>("sort", "payoff");
    const tab = this.ctx.workspaceState.get<string>("tab", "report");
    const compare = this.ctx.workspaceState.get<string>("compare", "HEAD");
    return {
      tab: oneOf(tab, TABS) ? tab : "report",
      scope: oneOf(scope, SCOPES) ? scope : "changed",
      sort: oneOf(sort, SORTS) ? sort : "payoff",
      compare:
        compare === "HEAD" || this.refs.includes(compare) ? compare : "HEAD",
    };
  }

  private ignoredKey(p: Project) {
    return `ignored:${p.root}`;
  }

  private progress(gen: number): Progress {
    return {
      onProgress: (done, total) =>
        gen === this.generation &&
        void this.post({ type: "progress", done, total }),
      isCancelled: () => gen !== this.generation,
    };
  }

  private post(m: ToWebview): void {
    void this.view?.webview.postMessage(m);
  }

  private base(
    c: Current,
    st: ReturnType<Sidebar["state"]>,
  ): Omit<UpdateMessage, "loading" | "data" | "truncated"> {
    return {
      type: "update",
      ...st,
      refs: this.refs,
      trusted: c.trusted,
      configErrors: c.errors,
      about: {
        author: this.about.author,
        version: this.about.version,
        hasRepo: !!this.about.repoUrl,
      },
      fixCommits: c.project?.config.verdicts.fixCommits ?? 6,
    };
  }

  /** Builds the data for the current tab. */
  private load(project: Project, st: ReturnType<Sidebar["state"]>, rel: string | undefined, p: Progress) {
    const b = this.builder(project);
    if (st.tab === "change") return b.change(st.compare, p);
    if (st.tab === "todo") return b.todo(this.ctx.workspaceState.get<string[]>(this.ignoredKey(project), []), p);
    return b.report(st.scope, st.sort, rel, p);
  }

  async refresh(): Promise<void> {
    if (!this.view?.visible) return;
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

  // complexity-ok: message dispatcher, one case per message type; each case delegates to a method
  private async onMessage(m: FromWebview): Promise<void> {
    if (!m || typeof m !== "object") return;
    const c = this.current();
    switch (m.type) {
      case "ready":
      case "refresh":
        return this.refresh();
      case "tab":
        if (oneOf(m.value, TABS))
          await this.ctx.workspaceState.update("tab", m.value);
        return this.refresh();
      case "compare":
        if (m.value === "HEAD" || this.refs.includes(m.value))
          await this.ctx.workspaceState.update("compare", m.value);
        return this.refresh();
      case "scope":
      case "sort":
        return this.setSetting(m.type, m.value);
      case "open":
        return this.open(c, m.path, m.line);
      case "detail":
        return this.sendDetail(c, m.path);
      case "action":
        return this.action(c, m);
      case "batch":
        return this.batch(c, m.kind);
      case "openConfig":
        return void vscode.commands.executeCommand("complexityLens.openConfig");
      case "installHook":
        return void vscode.commands.executeCommand(
          "complexityLens.installHook",
        );
      case "openRepo":
        // Only the https repo URL from the extension's own package.json, never a URL from the webview.
        if (this.about.repoUrl)
          void vscode.env.openExternal(vscode.Uri.parse(this.about.repoUrl));
        return;
    }
  }

  private async setSetting(
    key: "scope" | "sort",
    value: unknown,
  ): Promise<void> {
    const ok = key === "scope" ? oneOf(value, SCOPES) : oneOf(value, SORTS);
    if (ok)
      await vscode.workspace
        .getConfiguration("complexityLens")
        .update(key, value as Scope | Sort, vscode.ConfigurationTarget.Global);
  }

  /** Paths must be repo files that are in view or reachable from a shown detail. */
  private allowed(c: Current, p: unknown): p is string {
    return (
      typeof p === "string" &&
      !!c.project &&
      (this.known.has(p) || c.project.includes(p)) &&
      !!c.project.absolute(p)
    );
  }

  private async open(c: Current, p: unknown, line: unknown): Promise<void> {
    if (!this.allowed(c, p) || !c.project) return;
    const abs = c.project.absolute(p) as string;
    const n =
      typeof line === "number" && Number.isInteger(line) && line > 0
        ? line - 1
        : 0;
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(vscode.Uri.file(abs)),
      { selection: new vscode.Range(n, 0, n, 0) },
    );
  }

  private async sendDetail(c: Current, p: unknown): Promise<void> {
    if (!this.allowed(c, p) || !c.project) return;
    const d = await this.builder(c.project).detail(
      p,
      this.progress(this.generation),
    );
    if (!d)
      return this.post({
        type: "detailError",
        path: p,
        text: "This file can't be analysed.",
      });
    for (const x of [...d.dependents, ...d.internalImports]) this.known.add(x);
    this.post({ type: "detail", detail: d });
  }

  private deps(project: Project) {
    const b = this.builder(project);
    // User-requested actions must never be cancelled by a panel refresh.
    const p: Progress = { onProgress: () => undefined, isCancelled: () => false };
    const key = this.ignoredKey(project);
    const ignored = () => this.ctx.workspaceState.get<string[]>(key, []);
    return {
      project,
      detail: (rel: string) => b.detail(rel, p),
      ignored,
      setIgnored: async (list: string[]) => {
        await this.ctx.workspaceState.update(key, list);
        this.refreshSoon(0);
      },
      changeItems: () => b.changeItems(this.state().compare, p),
      topFix: () => b.topFix(p, ignored()),
    };
  }

  /** Runs a user action with a progress notification; failures are shown, never silent. */
  private async guarded(title: string, run: () => Promise<void>): Promise<void> {
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Complexity Lens: ${title}…` }, run);
    } catch (e) {
      vscode.window.showErrorMessage(`Complexity Lens: ${title} failed: ${(e as Error).message}`);
    }
  }

  private async action(c: Current, m: Extract<FromWebview, { type: "action" }>): Promise<void> {
    if (!c.project || !oneOf(m.kind, ACTIONS) || !this.allowed(c, m.path)) return;
    if (m.kind === "accept" && !c.trusted) return void vscode.window.showWarningMessage("Complexity Lens: trust this workspace to edit files.");
    const project = c.project;
    const fn = typeof m.fn === "string" ? m.fn : undefined;
    await this.guarded(ACTION_TITLE[m.kind], () => runAction(this.deps(project), m.kind, m.path, fn));
  }

  private async batch(c: Current, kind: unknown): Promise<void> {
    if (!c.project || !oneOf(kind, BATCHES)) return;
    const project = c.project;
    await this.guarded(BATCH_TITLE[kind], () => runBatch(this.deps(project), kind));
  }

  private html(webview: vscode.Webview, media: vscode.Uri): string {
    const nonce = randomBytes(24).toString("base64url");
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, "main.css"));
    const js = webview.asWebviewUri(
      vscode.Uri.joinPath(media, "dist", "webview.js"),
    );
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}"><title>Complexity Lens</title></head>
<body><div id="app"></div><script nonce="${nonce}" src="${js}"></script></body></html>`;
  }
}

function safeBranches(root: string): string[] {
  try {
    return git.listBranches(root);
  } catch {
    return [];
  }
}

function collectPaths(data: import("./protocol").ViewData): Set<string> {
  const rows = [
    ...(data.report ?? []),
    ...(data.change?.items ?? []),
    ...(data.todo?.fix ?? []),
    ...(data.todo?.plan ?? []),
    ...(data.todo?.leave ?? []),
  ];
  return new Set([...rows.map((r) => r.path), ...(data.todo?.ignored ?? [])]);
}
