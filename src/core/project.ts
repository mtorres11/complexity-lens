// Ties config, git and the analyzer together for one repository.

import * as fs from "fs";
import * as path from "path";
import { analyzeSource, FileMetrics } from "./analyze";
import {
  Config,
  isIncluded,
  LoadResult,
  settingsFor,
} from "./config";
import { resolveConfig } from "./configParse";
import { parseJsonc } from "./jsonc";
import { evaluateFile, Finding } from "./evaluate";
import * as git from "./git";
import { Churn, parseChurn } from "./churn";
import { buildDependents, DependentsIndex } from "./dependents";
import { matchesAny, normalizePath } from "./glob";

export const CONFIG_FILE = "complexity-lens.json";
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const RESOLVE_EXT = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

export interface ProjectOptions {
  /** Whether git may be used (false in VS Code Restricted Mode). */
  useGit: boolean;
}

export class Project {
  readonly loaded: LoadResult;
  private readonly refCache = new Map<string, { at: number; ok: boolean }>();

  /** Whether a ref resolves, remembered for a few seconds. */
  private refExists(ref: string): boolean {
    const hit = this.refCache.get(ref);
    if (hit && Date.now() - hit.at < 5_000) return hit.ok;
    const ok = git.hasCommit(this.root, ref);
    this.refCache.set(ref, { at: Date.now(), ok });
    return ok;
  }

  private churnCache?: { at: number; map: Map<string, Churn> };
  private readonly cache = new Map<
    string,
    { mtimeMs: number; metrics: FileMetrics }
  >();
  /** Unsaved editor text per file, so metrics follow edits before they are saved. */
  private readonly overlays = new Map<string, string>();
  private readonly overlayCache = new Map<string, { text: string; metrics: FileMetrics }>();

  constructor(
    readonly root: string,
    readonly options: ProjectOptions = { useGit: true },
  ) {
    this.loaded = loadConfig(root);
  }

  get config(): Config {
    return this.loaded.config;
  }

  /** Repo-relative path for an absolute path, or undefined if it is outside the repo. */
  relative(absPath: string): string | undefined {
    const rel = path.relative(this.root, path.resolve(absPath));
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
    return normalizePath(rel);
  }

  /** Absolute path for a repo-relative path; refuses anything that escapes the repo. */
  absolute(relPath: string): string | undefined {
    const abs = path.resolve(this.root, relPath);
    return this.relative(abs) === undefined ? undefined : abs;
  }

  includes(relPath: string): boolean {
    return isIncluded(this.config, relPath);
  }

  readWorking(relPath: string): string | undefined {
    const abs = this.absolute(relPath);
    if (!abs) return undefined;
    try {
      const st = fs.lstatSync(abs);
      if (!st.isFile() || st.size > MAX_SOURCE_BYTES) return undefined; // skips symlinks too
      return fs.readFileSync(abs, "utf8");
    } catch {
      return undefined;
    }
  }

  /**
   * Use this text instead of the file on disk until it is cleared (pass undefined),
   * e.g. while a file has unsaved edits in the editor.
   */
  setOverlay(relPath: string, text: string | undefined): void {
    if (text === undefined) {
      this.overlays.delete(relPath);
      this.overlayCache.delete(relPath);
    } else this.overlays.set(relPath, text);
  }

  /** Current metrics of a file: unsaved editor text if any, else disk (cached by modification time). */
  metrics(relPath: string, text?: string): FileMetrics | undefined {
    const marker = settingsFor(this.config, relPath).allowComment.marker;
    if (text !== undefined) return analyzeSource(relPath, text, marker);
    const pending = this.overlays.get(relPath);
    if (pending !== undefined) return this.overlayMetrics(relPath, pending, marker);
    const abs = this.absolute(relPath);
    if (!abs) return undefined;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(abs).mtimeMs;
    } catch {
      return undefined;
    }
    const hit = this.cache.get(relPath);
    if (hit && hit.mtimeMs === mtimeMs) return hit.metrics;
    const src = this.readWorking(relPath);
    if (src === undefined) return undefined;
    const metrics = analyzeSource(relPath, src, marker);
    this.cache.set(relPath, { mtimeMs, metrics });
    return metrics;
  }

  private overlayMetrics(relPath: string, text: string, marker: string): FileMetrics {
    const hit = this.overlayCache.get(relPath);
    if (hit && hit.text === text) return hit.metrics;
    const metrics = analyzeSource(relPath, text, marker);
    this.overlayCache.set(relPath, { text, metrics });
    return metrics;
  }

  /** Metrics of the file at a git ref, or undefined if it did not exist (or git is off). */
  baselineMetrics(relPath: string, ref = "HEAD"): FileMetrics | undefined {
    if (!this.options.useGit || !this.refExists(ref)) return undefined;
    const text = git.fileAt(this.root, ref, relPath);
    if (text === undefined || text.length > MAX_SOURCE_BYTES) return undefined;
    return analyzeSource(
      relPath,
      text,
      settingsFor(this.config, relPath).allowComment.marker,
    );
  }

  evaluate(
    relPath: string,
    baseRef = "HEAD",
    text?: string,
  ): { metrics?: FileMetrics; findings: Finding[] } {
    const metrics = this.metrics(relPath, text);
    if (!metrics) return { findings: [] };
    const base = this.baselineMetrics(relPath, baseRef);
    // Context load: the file plus its imports. The baseline reuses today's imports.
    const ctx = this.contextBreakdown(relPath, undefined, metrics);
    metrics.contextTokens = ctx.total;
    metrics.contextLargestImport = ctx.imports[0];
    if (base) base.contextTokens = base.fileTokens + (metrics.contextTokens - metrics.fileTokens);
    return {
      metrics,
      findings: evaluateFile(metrics, base, settingsFor(this.config, relPath)),
    };
  }

  /** Included files: all of them, or only changed ones relative to `base`. */
  files(scope: "all" | "changed", base = "HEAD", max = 20000): string[] {
    let list: string[];
    if (this.options.useGit && git.repoRoot(this.root)) {
      list =
        scope === "changed"
          ? git.changedFiles(this.root, base)
          : git.listFiles(this.root);
    } else {
      list = scope === "changed" ? [] : walk(this.root, max * 4);
    }
    return list
      .map(normalizePath)
      .filter((f) => this.includes(f) && fs.existsSync(path.join(this.root, f)))
      .slice(0, max);
  }

  /**
   * Estimated tokens to read a file plus its relative imports, `depth` levels deep.
   * `rootMetrics` lets the editor pass metrics for unsaved text of the root file.
   */
  aiCost(relPath: string, depth = this.config.tokens.includeImports, rootMetrics?: FileMetrics): number {
    return this.contextBreakdown(relPath, depth, rootMetrics).total;
  }

  /**
   * Context load split into the file itself and the files it imports (with their sizes).
   * Imports matching tokens.ignoreImports are reported in `ignored` and not counted or followed.
   */
  contextBreakdown(relPath: string, depth = this.config.tokens.includeImports, rootMetrics?: FileMetrics) {
    const seen = new Set<string>();
    const imports: { path: string; tokens: number }[] = [];
    const ignored: string[] = [];
    const ignore = this.config.tokens.ignoreImports;
    const visit = (rel: string, level: number): void => {
      if (seen.has(rel)) return;
      seen.add(rel);
      if (level > 0 && matchesAny(rel, ignore)) return void ignored.push(rel);
      const m = rel === relPath && rootMetrics ? rootMetrics : this.metrics(rel);
      if (!m) return;
      if (level > 0) imports.push({ path: rel, tokens: m.fileTokens });
      if (level < depth) visitImports(rel, m, level + 1);
    };
    const visitImports = (rel: string, m: FileMetrics, level: number): void => {
      for (const spec of m.relativeImports) {
        const target = this.resolveImport(rel, spec);
        if (target) visit(target, level);
      }
    };
    visit(relPath, 0);
    const own = (rootMetrics ?? this.metrics(relPath))?.fileTokens ?? 0;
    const fromImports = imports.reduce((n, i) => n + i.tokens, 0);
    return {
      own,
      fromImports,
      total: own + fromImports,
      imports: imports.sort((a, b) => b.tokens - a.tokens),
      ignored: ignored.sort(),
    };
  }

  resolveImport(fromRel: string, spec: string): string | undefined {
    const base = normalizePath(
      path.posix.join(path.posix.dirname(fromRel), spec),
    );
    const candidates = [
      base,
      ...RESOLVE_EXT.map((e) => base + e),
      ...RESOLVE_EXT.map((e) => `${base}/index${e}`),
      // "./x.js" written in TS sources that compile to JS
      ...(/\.[cm]?js$/.test(base)
        ? RESOLVE_EXT.map((e) => base.replace(/\.[cm]?js$/, e))
        : []),
    ];
    for (const c of candidates) {
      const abs = this.absolute(c);
      if (
        abs &&
        fs.existsSync(abs) &&
        fs.statSync(abs).isFile() &&
        !c.includes("node_modules/")
      )
        return c;
    }
    return undefined;
  }

  /** Churn per file over hotspots.historyDays (cached for a minute). */
  churn(): Map<string, Churn> {
    if (!this.options.useGit) return new Map();
    if (this.churnCache && Date.now() - this.churnCache.at < 60_000) return this.churnCache.map;
    let map = new Map<string, Churn>();
    try {
      map = parseChurn(git.logNumstat(this.root, this.config.hotspots.historyDays), this.config.hotspots.historyDays);
    } catch {
      /* no history available */
    }
    this.churnCache = { at: Date.now(), map };
    return map;
  }

  /** Reverse import index over the given files (uses cached metrics). */
  dependents(files: readonly string[]): DependentsIndex {
    return buildDependents(files, (rel) => this.metrics(rel)?.relativeImports, (from, spec) => this.resolveImport(from, spec));
  }

  hotspotCounts(): Map<string, number> {
    if (!this.options.useGit) return new Map();
    try {
      return git.commitCounts(this.root, this.config.hotspots.historyDays);
    } catch {
      return new Map();
    }
  }
}

export function loadConfig(root: string): LoadResult {
  const file = path.join(root, CONFIG_FILE);
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile()) return resolveConfig(undefined);
    if (st.size > MAX_CONFIG_BYTES) {
      const r = resolveConfig(undefined);
      r.errors.push(
        `${CONFIG_FILE} is larger than ${MAX_CONFIG_BYTES / 1024} KB and was ignored`,
      );
      return r;
    }
    return resolveConfig(parseJsonc(fs.readFileSync(file, "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return resolveConfig(undefined);
    const r = resolveConfig(undefined);
    r.errors.push(`${CONFIG_FILE}: ${(e as Error).message}`);
    return r;
  }
}

/** Fallback file listing when git is unavailable: skips dot folders and node_modules. */
function readDir(root: string, dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return [];
  }
}

function walk(root: string, max: number): string[] {
  const out: string[] = [];
  const stack = [""];
  while (stack.length && out.length < max) {
    const dir = stack.pop() as string;
    const entries = readDir(root, dir).filter((e) => !e.name.startsWith(".") && e.name !== "node_modules");
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) stack.push(rel);
      else if (e.isFile()) out.push(rel);
    }
  }
  return out;
}
