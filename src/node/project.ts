// Ties config, git and the analyzer together for one repository.

import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { analyzeSource, FileMetrics } from "../core/analyze";
import {
  Config,
  FileSettings,
  isIncluded,
  LoadResult,
  Policy,
  settingsFor,
} from "../core/config";
import type { ContextLoad } from "../core/context";
import { Evaluation, evaluateFile } from "../core/evaluate";
import type { ProjectReader } from "../core/insights";
import * as git from "./git";
import { Churn, parseChurn } from "../core/churn";
import { buildDependents, DependentsIndex } from "../core/dependents";
import { matchesAny, normalizePath } from "../core/glob";
import { DiskCache } from "./diskCache";
import { loadConfig } from "./configFile";
import { walk } from "./walk";

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const RESOLVE_EXT = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export interface ProjectOptions {
  /** Whether git may be used (false in VS Code Restricted Mode). */
  useGit: boolean;
  /** Judge every file with this policy instead of the repo config's (a one-off audit). */
  policy?: Policy;
}



export class Project implements ProjectReader {
  readonly loaded: LoadResult;
  private readonly refCache = new Map<string, { at: number; commit?: string }>();
  private readonly trees = new Map<string, Map<string, string>>();
  private diskCache?: DiskCache;

  /** Commit a ref points at (undefined if it does not resolve), remembered for a few seconds. */
  private commitOf(ref: string): string | undefined {
    const hit = this.refCache.get(ref);
    if (hit && Date.now() - hit.at < 5_000) return hit.commit;
    const commit = git.resolveCommit(this.root, ref);
    this.refCache.set(ref, { at: Date.now(), commit });
    return commit;
  }

  /** Path → blob id for a commit, from one git call (the last few commits are kept). */
  private tree(commit: string): Map<string, string> {
    let t = this.trees.get(commit);
    if (!t) {
      t = git.treeBlobs(this.root, commit);
      if (this.trees.size >= 4) this.trees.delete(this.trees.keys().next().value as string);
      this.trees.set(commit, t);
    }
    return t;
  }

  /** Folder for Complexity Lens's own files (.git/complexity-lens), or undefined when git is off or this is not a repository. */
  stateDir(): string | undefined {
    if (!this.options.useGit) return undefined;
    try {
      return path.join(git.gitDir(this.root), "complexity-lens");
    } catch {
      return undefined;
    }
  }

  /** On-disk cache in the state folder; memory only without one. */
  private get disk(): DiskCache {
    this.diskCache ??= new DiskCache(this.stateDir());
    return this.diskCache;
  }

  /**
   * The ref to compare with: "HEAD" for the last commit (or a ref that isn't safe), otherwise
   * the commit where this branch forked from `compare` (what a pull request contains).
   */
  baseRefFor(compare: string): string {
    return compare === "HEAD" || !git.isSafeRef(compare) ? "HEAD" : git.mergeBase(this.root, compare);
  }

  /** Writes the on-disk cache now (it is also saved shortly after changes and when the process exits). */
  saveCache(): void {
    this.diskCache?.save();
  }

  private churnCache?: { key: string; map: Map<string, Churn> };
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

  /** Effective settings for one file (with the policy option applied). */
  settings(relPath: string): FileSettings {
    return settingsFor(this.config, relPath, this.options.policy);
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
    const marker = this.settings(relPath).allowComment.marker;
    if (text !== undefined) return analyzeSource(relPath, text, marker);
    const pending = this.overlays.get(relPath);
    if (pending !== undefined) return this.overlayMetrics(relPath, pending, marker);
    const abs = this.absolute(relPath);
    if (!abs) return undefined;
    let st: fs.Stats;
    try {
      st = fs.statSync(abs);
    } catch {
      return undefined;
    }
    const hit = this.cache.get(relPath);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.metrics;
    const stored = this.disk.getFile(relPath, st.mtimeMs, st.size, marker);
    if (stored) {
      this.cache.set(relPath, { mtimeMs: st.mtimeMs, metrics: stored });
      return stored;
    }
    const src = this.readWorking(relPath);
    if (src === undefined) return undefined;
    const metrics = analyzeSource(relPath, src, marker);
    this.cache.set(relPath, { mtimeMs: st.mtimeMs, metrics });
    this.disk.setFile(relPath, st.mtimeMs, st.size, marker, metrics);
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
    if (!this.options.useGit) return undefined;
    const commit = this.commitOf(ref);
    const blob = commit && this.tree(commit).get(relPath);
    if (!blob) return undefined;
    // Unchanged since the ref: the old version is the current one, no git read needed.
    const working = this.overlays.get(relPath) ?? this.readWorking(relPath);
    if (working !== undefined && gitBlobId(working, blob.length) === blob) return this.metrics(relPath);
    const marker = this.settings(relPath).allowComment.marker;
    const cached = this.disk.getBlob(blob, marker);
    if (cached) return cached;
    const text = git.blobText(this.root, blob);
    if (text === undefined || text.length > MAX_SOURCE_BYTES) return undefined;
    const metrics = analyzeSource(relPath, text, marker);
    this.disk.setBlob(blob, marker, metrics);
    return metrics;
  }

  /** Metrics, baseline, context load and findings of one file. Cached metrics are never modified. */
  evaluate(relPath: string, baseRef = "HEAD", text?: string): Evaluation {
    const metrics = this.metrics(relPath, text);
    if (!metrics) return { findings: [] };
    const base = this.baselineMetrics(relPath, baseRef);
    const context = this.contextBreakdown(relPath, metrics);
    return { metrics, base, context, findings: evaluateFile(metrics, base, this.settings(relPath), context) };
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
   * Context load split into the file itself and the files it imports (with their sizes),
   * tokens.includeImports levels deep. Imports matching tokens.ignoreImports are reported in
   * `ignored` and not counted or followed. `rootMetrics` are the file's metrics when the caller has them.
   */
  contextBreakdown(relPath: string, rootMetrics?: FileMetrics): ContextLoad {
    const depth = this.config.tokens.includeImports;
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
    const base = normalizePath(path.posix.join(path.posix.dirname(fromRel), spec)).replace(/\/+$/, "");
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

  /** Churn per file over hotspots.historyDays, recomputed only when HEAD or the day changes. */
  churn(): Map<string, Churn> {
    if (!this.options.useGit) return new Map();
    const days = this.config.hotspots.historyDays;
    const key = `${this.commitOf("HEAD") ?? "none"}|${days}|${new Date().toISOString().slice(0, 10)}`;
    if (this.churnCache?.key === key) return this.churnCache.map;
    let map = this.disk.getChurn(key);
    if (!map) {
      map = new Map<string, Churn>();
      try {
        map = parseChurn(git.logNumstat(this.root, days), days);
      } catch {
        /* no history available */
      }
      this.disk.setChurn(key, map);
    }
    this.churnCache = { key, map };
    return map;
  }

  /** Reverse import index over the given files (uses cached metrics). */
  dependents(files: readonly string[]): DependentsIndex {
    return buildDependents(files, (rel) => this.metrics(rel)?.relativeImports, (from, spec) => this.resolveImport(from, spec));
  }
}

/** Git's object id for this content as a blob (SHA-1, or SHA-256 when `idLength` is 64). */
function gitBlobId(text: string, idLength: number): string {
  const body = Buffer.from(text, "utf8");
  return createHash(idLength === 64 ? "sha256" : "sha1")
    .update(`blob ${body.length}\0`)
    .update(body)
    .digest("hex");
}
