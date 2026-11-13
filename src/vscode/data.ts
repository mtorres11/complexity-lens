// Computes what each tab shows. Work runs in batches that yield to the editor, and the
// reverse-import index (afferent coupling) is built once per refresh from cached metrics.

import * as git from "../core/git";
import {
  FileDetail,
  FileSummary,
  InsightContext,
  detail,
  summarize,
} from "../core/insights";
import type { Project } from "../core/project";
import type { Scope, Sort, ViewData } from "./protocol";

const yieldToEditor = () => new Promise<void>((r) => setImmediate(r));

export interface Progress {
  onProgress: (done: number, total: number) => void;
  isCancelled: () => boolean;
}

const SORTERS: Record<Sort, (a: FileSummary, b: FileSummary) => number> = {
  payoff: (a, b) => b.payoff - a.payoff,
  aiCost: (a, b) => b.contextTokens - a.contextTokens,
  complexity: (a, b) => b.cognitive - a.cognitive,
  churn: (a, b) => b.churn.commits - a.churn.commits,
  name: (a, b) => a.path.localeCompare(b.path),
};

/** Analyses every file (cached by modification time), yielding regularly. Returns false if cancelled. */
async function warm(
  project: Project,
  files: string[],
  p: Progress,
): Promise<boolean> {
  for (let i = 0; i < files.length; i++) {
    if (p.isCancelled()) return false;
    project.metrics(files[i]);
    if (i % 40 === 39) {
      p.onProgress(i + 1, files.length);
      await yieldToEditor();
    }
  }
  return true;
}

export class DataBuilder {
  private ctxCache?: {
    at: number;
    ctx: Omit<InsightContext, "baseRef">;
    files: string[];
  };

  constructor(
    private readonly project: Project,
    private readonly maxFiles: number,
  ) {}

  /** Churn and dependents for the whole repo (cached briefly between tab switches). */
  private async context(
    p: Progress,
  ): Promise<
    | {
        ctx: Omit<InsightContext, "baseRef">;
        files: string[];
        truncated: boolean;
      }
    | undefined
  > {
    const all = this.project.files("all");
    const files = all.slice(0, this.maxFiles);
    if (this.ctxCache && Date.now() - this.ctxCache.at < 15_000)
      return { ...this.ctxCache, truncated: all.length > files.length };
    if (!(await warm(this.project, files, p))) return undefined;
    const ctx = {
      churn: this.project.churn(),
      dependents: this.project.dependents(files),
    };
    this.ctxCache = { at: Date.now(), ctx, files };
    return { ctx, files, truncated: all.length > files.length };
  }

  invalidate(): void {
    this.ctxCache = undefined;
  }

  private async summaries(
    files: string[],
    ctx: InsightContext,
    p: Progress,
  ): Promise<FileSummary[] | undefined> {
    const out: FileSummary[] = [];
    for (let i = 0; i < files.length; i++) {
      if (p.isCancelled()) return undefined;
      const s = summarize(this.project, files[i], ctx);
      if (s) out.push(s);
      if (i % 25 === 24) await yieldToEditor();
    }
    return out;
  }

  async report(
    scope: Scope,
    sort: Sort,
    currentFile: string | undefined,
    p: Progress,
  ): Promise<{ data: ViewData; truncated: boolean } | undefined> {
    const c = await this.context(p);
    if (!c) return undefined;
    const files =
      scope === "repo"
        ? c.files
        : scope === "changed"
          ? this.project.files("changed")
          : currentFile && this.project.includes(currentFile)
            ? [currentFile]
            : [];
    const rows = await this.summaries(files, { ...c.ctx, baseRef: "HEAD", changed: new Set(this.project.files("changed")) }, p);
    return (
      rows && {
        data: { report: rows.sort(SORTERS[sort]) },
        truncated: scope === "repo" && c.truncated,
      }
    );
  }

  async change(
    compare: string,
    p: Progress,
  ): Promise<{ data: ViewData; truncated: boolean } | undefined> {
    const c = await this.context(p);
    if (!c) return undefined;
    const ref =
      compare === "HEAD" || !git.isSafeRef(compare)
        ? "HEAD"
        : git.mergeBase(this.project.root, compare);
    const files = this.project.files(
      "changed",
      compare === "HEAD" ? "HEAD" : compare,
    );
    const items = await this.summaries(files, { ...c.ctx, baseRef: ref }, p);
    return (
      items && {
        data: {
          change: {
            items: items.sort(
              (a, b) =>
                b.problems.length - a.problems.length || SORTERS.payoff(a, b),
            ),
            compare,
          },
        },
        truncated: false,
      }
    );
  }

  async todo(
    ignored: string[],
    p: Progress,
  ): Promise<{ data: ViewData; truncated: boolean } | undefined> {
    const c = await this.context(p);
    if (!c) return undefined;
    const skip = new Set(ignored);
    const rows = await this.summaries(
      c.files.filter((f) => !skip.has(f)),
      { ...c.ctx, baseRef: "HEAD", changed: new Set(this.project.files("changed")) },
      p,
    );
    if (!rows) return undefined;
    const by = (v: FileSummary["verdict"]) =>
      rows
        .filter((r) => r.verdict === v)
        .sort(SORTERS.payoff)
        .slice(0, 100);
    return {
      data: {
        todo: { fix: by("FIX"), plan: by("PLAN"), leave: by("LEAVE"), ignored },
      },
      truncated: c.truncated,
    };
  }

  async detail(rel: string, p: Progress): Promise<FileDetail | undefined> {
    const c = await this.context(p);
    if (!c) return undefined;
    return detail(this.project, rel, { ...c.ctx, baseRef: "HEAD" });
  }

  /** The summaries of the "Your change" tab, for batch actions. */
  async changeItems(compare: string, p: Progress): Promise<FileSummary[]> {
    return (await this.change(compare, p))?.data.change?.items ?? [];
  }

  async topFix(p: Progress, ignored: string[], n = 5): Promise<FileSummary[]> {
    const t = (await this.todo(ignored, p))?.data.todo;
    return t ? [...t.fix, ...t.plan].slice(0, n) : [];
  }
}
