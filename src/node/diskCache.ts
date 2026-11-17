// On-disk cache of analysis results, so a reload or a new window does not re-parse every file.
// Lives in the repository's git directory (never in the working tree). Entries are keyed so they can
// never be stale: files by path + modification time + size + allow-comment marker, old versions by git
// blob id, churn by HEAD commit + window + day. The whole cache is dropped when the build changes.

import * as fs from "fs";
import * as path from "path";
import type { FileMetrics } from "../core/analyze";
import type { Churn } from "../core/churn";

const FORMAT = 1;
const FILE_NAME = "metrics-cache.json";
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 50_000;
const SAVE_DELAY_MS = 2_000;

/** Changes with every build, so analyzer changes never reuse old results. Tests and dev builds use "dev". */
const BUILD_ID = process.env.CL_BUILD || "dev";

interface FileEntry {
  mtimeMs: number;
  size: number;
  marker: string;
  metrics: FileMetrics;
}

interface CacheFile {
  format: number;
  build: string;
  files: Record<string, FileEntry>;
  blobs: Record<string, FileMetrics>;
  churn?: { key: string; entries: [string, Churn][] };
}

function isMetrics(v: unknown): v is FileMetrics {
  const m = v as FileMetrics;
  return (
    !!m &&
    typeof m === "object" &&
    typeof m.path === "string" &&
    typeof m.fileTokens === "number" &&
    Array.isArray(m.functions) &&
    Array.isArray(m.relativeImports) &&
    Array.isArray(m.cohesion)
  );
}

function isEntry(v: unknown): v is FileEntry {
  const e = v as FileEntry;
  return (
    !!e &&
    typeof e.mtimeMs === "number" &&
    typeof e.size === "number" &&
    typeof e.marker === "string" &&
    isMetrics(e.metrics)
  );
}

/** Valid entries of a parsed object, as a Map (so keys like "__proto__" are harmless). */
function entries<T>(obj: unknown, ok: (v: unknown) => v is T): Map<string, T> {
  const out = new Map<string, T>();
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (out.size >= MAX_ENTRIES) break;
    if (ok(v)) out.set(k, v);
  }
  return out;
}

function readCache(file: string): Partial<CacheFile> | undefined {
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > MAX_BYTES) return undefined;
    const data = JSON.parse(
      fs.readFileSync(file, "utf8"),
    ) as Partial<CacheFile>;
    return data.format === FORMAT && data.build === BUILD_ID ? data : undefined;
  } catch {
    return undefined;
  }
}

/** Caches with a directory, saved once more when the process exits (one listener for all of them). */
const live = new Set<WeakRef<DiskCache>>();
let exitHooked = false;

function registerForExit(cache: DiskCache): void {
  live.add(new WeakRef(cache));
  if (exitHooked) return;
  exitHooked = true;
  process.once("exit", () => {
    for (const ref of live) ref.deref()?.save();
  });
}

export class DiskCache {
  private readonly files: Map<string, FileEntry>;
  private readonly blobs: Map<string, FileMetrics>;
  private churn?: { key: string; entries: [string, Churn][] };
  private timer?: NodeJS.Timeout;
  private dirty = false;

  /** `dir` undefined = memory only (no git directory, or git is off). */
  constructor(private readonly dir: string | undefined) {
    const data = dir ? readCache(path.join(dir, FILE_NAME)) : undefined;
    this.files = entries(data?.files, isEntry);
    this.blobs = entries(data?.blobs, isMetrics);
    const c = data?.churn;
    if (c && typeof c.key === "string" && Array.isArray(c.entries))
      this.churn = c;
    if (dir) registerForExit(this);
  }

  getFile(
    rel: string,
    mtimeMs: number,
    size: number,
    marker: string,
  ): FileMetrics | undefined {
    const e = this.files.get(rel);
    return e && e.mtimeMs === mtimeMs && e.size === size && e.marker === marker
      ? e.metrics
      : undefined;
  }

  setFile(
    rel: string,
    mtimeMs: number,
    size: number,
    marker: string,
    metrics: FileMetrics,
  ): void {
    this.files.set(rel, { mtimeMs, size, marker, metrics });
    this.touch();
  }

  /** Metrics of an old file version, by git blob id and allow-comment marker. */
  getBlob(blob: string, marker: string): FileMetrics | undefined {
    return this.blobs.get(`${blob}:${marker}`);
  }

  setBlob(blob: string, marker: string, metrics: FileMetrics): void {
    if (this.blobs.size >= MAX_ENTRIES) this.blobs.clear();
    this.blobs.set(`${blob}:${marker}`, metrics);
    this.touch();
  }

  getChurn(key: string): Map<string, Churn> | undefined {
    return this.churn?.key === key ? new Map(this.churn.entries) : undefined;
  }

  setChurn(key: string, map: Map<string, Churn>): void {
    this.churn = { key, entries: [...map] };
    this.touch();
  }

  /** Writes pending changes now (atomically: temp file, then rename). Never throws. */
  save(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.dirty || !this.dir) return;
    this.dirty = false;
    const data: CacheFile = {
      format: FORMAT,
      build: BUILD_ID,
      files: Object.fromEntries(this.files),
      blobs: Object.fromEntries(this.blobs),
      churn: this.churn,
    };
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const file = path.join(this.dir, FILE_NAME);
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    } catch {
      /* a cache that cannot be written is only slower */
    }
  }

  private touch(): void {
    this.dirty = true;
    if (!this.dir || this.timer) return;
    this.timer = setTimeout(() => this.save(), SAVE_DELAY_MS);
    this.timer.unref?.();
  }
}
