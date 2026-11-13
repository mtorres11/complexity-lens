// Validation of complexity-lens.json. The file comes from the repository, so it is treated
// as untrusted data: invalid values are reported and fall back to the preset.

import {
  AllowComment,
  Config,
  defaultConfig,
  HookSettings,
  LIMIT_KEYS,
  Limits,
  LoadResult,
  Override,
} from "./config";

const ENUMS = {
  preset: ["relaxed", "recommended", "strict"],
  policy: ["ratchet", "absolute"],
  afterEdit: ["off", "inform", "nudge"],
  onFinish: ["off", "inform", "block"],
  ci: ["off", "warn", "failOnRegression", "failOverLimit"],
} as const;

const MARKER_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
const MAX_GLOBS = 200;
const MAX_GLOB_LENGTH = 300;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

class Validator {
  errors: string[] = [];
  warnings: string[] = [];

  unknownKeys(obj: Obj, allowed: readonly string[], path: string): void {
    for (const k of Object.keys(obj)) {
      if (k === "$schema") continue;
      if (!allowed.includes(k))
        this.warnings.push(`${path}${k}: unknown option, ignored`);
    }
  }

  enumOf<T extends string>(
    v: unknown,
    values: readonly T[],
    path: string,
  ): T | undefined {
    if (v === undefined) return undefined;
    if (typeof v === "string" && (values as readonly string[]).includes(v))
      return v as T;
    this.errors.push(`${path}: must be one of ${values.join(", ")}`);
    return undefined;
  }

  int(v: unknown, path: string, min: number, max: number): number | undefined {
    if (v === undefined) return undefined;
    if (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max)
      return v;
    this.errors.push(`${path}: must be a whole number from ${min} to ${max}`);
    return undefined;
  }

  bool(v: unknown, path: string): boolean | undefined {
    if (v === undefined) return undefined;
    if (typeof v === "boolean") return v;
    this.errors.push(`${path}: must be true or false`);
    return undefined;
  }

  /** Problem with one file pattern, or undefined if it's acceptable. */
  private globProblem(g: unknown): string | undefined {
    if (typeof g !== "string" || !g.trim() || g.length > MAX_GLOB_LENGTH) return `each pattern must be a non-empty string (max ${MAX_GLOB_LENGTH} characters)`;
    if (g.startsWith("/") || g.split("/").includes("..")) return `"${g}" must be relative to the repo root and cannot use ".."`;
    return undefined;
  }

  globs(v: unknown, path: string): string[] | undefined {
    if (v === undefined) return undefined;
    const list = typeof v === "string" ? [v] : v;
    if (!Array.isArray(list) || list.length > MAX_GLOBS) {
      this.errors.push(`${path}: must be a list of up to ${MAX_GLOBS} file patterns`);
      return undefined;
    }
    const out: string[] = [];
    for (const g of list) {
      const problem = this.globProblem(g);
      if (problem) this.errors.push(`${path}: ${problem}`);
      else out.push(g as string);
    }
    return out;
  }

  limits(v: unknown, path: string): Partial<Limits> | undefined {
    if (v === undefined) return undefined;
    if (!isObj(v)) {
      this.errors.push(`${path}: must be an object`);
      return undefined;
    }
    this.unknownKeys(v, LIMIT_KEYS, `${path}.`);
    const out: Partial<Limits> = {};
    for (const k of LIMIT_KEYS) {
      if (!(k in v)) continue;
      if (v[k] === null) out[k] = null;
      else {
        const n = this.int(v[k], `${path}.${k}`, 1, 1_000_000);
        if (n !== undefined) out[k] = n;
      }
    }
    return out;
  }

  hook(v: unknown, path: string): Partial<HookSettings> | undefined {
    if (v === undefined) return undefined;
    if (!isObj(v)) {
      this.errors.push(`${path}: must be an object`);
      return undefined;
    }
    this.unknownKeys(v, ["afterEdit", "onFinish", "maxRetries"], `${path}.`);
    return strip({
      afterEdit: this.enumOf(v.afterEdit, ENUMS.afterEdit, `${path}.afterEdit`),
      onFinish: this.enumOf(v.onFinish, ENUMS.onFinish, `${path}.onFinish`),
      maxRetries: this.int(v.maxRetries, `${path}.maxRetries`, 0, 10),
    });
  }

  allowComment(v: unknown, path: string): Partial<AllowComment> | undefined {
    if (v === undefined) return undefined;
    if (!isObj(v)) {
      this.errors.push(`${path}: must be an object`);
      return undefined;
    }
    this.unknownKeys(v, ["marker", "requireReason"], `${path}.`);
    let marker: string | undefined;
    if (v.marker !== undefined) {
      if (typeof v.marker === "string" && MARKER_RE.test(v.marker))
        marker = v.marker;
      else
        this.errors.push(
          `${path}.marker: 3-40 lowercase letters, digits or hyphens`,
        );
    }
    return strip({
      marker,
      requireReason: this.bool(v.requireReason, `${path}.requireReason`),
    });
  }
}

function strip<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/** Validates raw JSON and merges it over its preset. Invalid values fall back to the preset. */
const TOP_KEYS = ["preset", "include", "exclude", "limits", "policy", "allowComment", "hook", "ci", "tokens", "hotspots", "verdicts", "overrides"];

/** Runs `apply` on an optional nested object, reporting a wrong type or unknown keys. */
function section(v: Validator, value: unknown, path: string, keys: readonly string[], apply: (o: Obj) => void): void {
  if (value === undefined) return;
  if (!isObj(value)) return void v.errors.push(`${path}: must be an object`);
  v.unknownKeys(value, keys, `${path}.`);
  apply(value);
}

function applyCore(v: Validator, raw: Obj, cfg: Config): void {
  cfg.include = v.globs(raw.include, "include") ?? cfg.include;
  cfg.exclude = v.globs(raw.exclude, "exclude") ?? cfg.exclude;
  Object.assign(cfg.limits, v.limits(raw.limits, "limits"));
  cfg.policy = v.enumOf(raw.policy, ENUMS.policy, "policy") ?? cfg.policy;
  Object.assign(cfg.allowComment, v.allowComment(raw.allowComment, "allowComment"));
  Object.assign(cfg.hook, v.hook(raw.hook, "hook"));
}

function applySmallSections(v: Validator, raw: Obj, cfg: Config): void {
  section(v, raw.ci, "ci", ["mode"], (o) => {
    cfg.ci.mode = v.enumOf(o.mode, ENUMS.ci, "ci.mode") ?? cfg.ci.mode;
  });
  section(v, raw.tokens, "tokens", ["includeImports", "ignoreImports"], (o) => {
    cfg.tokens.includeImports = v.int(o.includeImports, "tokens.includeImports", 0, 3) ?? cfg.tokens.includeImports;
    cfg.tokens.ignoreImports = v.globs(o.ignoreImports, "tokens.ignoreImports") ?? cfg.tokens.ignoreImports;
  });
  section(v, raw.verdicts, "verdicts", ["fixCommits", "planCommits"], (o) => {
    cfg.verdicts.fixCommits = v.int(o.fixCommits, "verdicts.fixCommits", 1, 10000) ?? cfg.verdicts.fixCommits;
    cfg.verdicts.planCommits = v.int(o.planCommits, "verdicts.planCommits", 1, 10000) ?? cfg.verdicts.planCommits;
  });
  section(v, raw.hotspots, "hotspots", ["historyDays"], (o) => {
    cfg.hotspots.historyDays = v.int(o.historyDays, "hotspots.historyDays", 1, 3650) ?? cfg.hotspots.historyDays;
  });
}

function parseOverride(v: Validator, o: unknown, p: string): Override | undefined {
  if (!isObj(o)) return void v.errors.push(`${p}: must be an object`);
  v.unknownKeys(o, ["files", "limits", "policy", "hook", "allowComment"], `${p}.`);
  const files = v.globs(o.files, `${p}.files`);
  if (!files?.length) return void v.errors.push(`${p}.files: at least one pattern is required`);
  return strip({
    files,
    limits: v.limits(o.limits, `${p}.limits`),
    policy: v.enumOf(o.policy, ENUMS.policy, `${p}.policy`),
    hook: v.hook(o.hook, `${p}.hook`),
    allowComment: v.allowComment(o.allowComment, `${p}.allowComment`),
  }) as Override;
}

function applyOverrides(v: Validator, raw: Obj, cfg: Config): void {
  if (raw.overrides === undefined) return;
  if (!Array.isArray(raw.overrides) || raw.overrides.length > 100) {
    return void v.errors.push("overrides: must be a list of up to 100 entries");
  }
  raw.overrides.forEach((o, i) => {
    const parsed = parseOverride(v, o, `overrides[${i}]`);
    if (parsed) cfg.overrides.push(parsed);
  });
}

/** Validates raw JSON and merges it over its preset. Invalid values fall back to the preset. */
export function resolveConfig(raw: unknown): LoadResult {
  if (raw === undefined || raw === null) return { config: defaultConfig(), errors: [], warnings: [] };
  if (!isObj(raw)) return { config: defaultConfig(), errors: ["complexity-lens.json must contain a JSON object"], warnings: [] };
  const v = new Validator();
  v.unknownKeys(raw, TOP_KEYS, "");
  const cfg = defaultConfig(v.enumOf(raw.preset, ENUMS.preset, "preset") ?? "recommended");
  applyCore(v, raw, cfg);
  applySmallSections(v, raw, cfg);
  applyOverrides(v, raw, cfg);
  return { config: cfg, errors: v.errors, warnings: v.warnings };
}
