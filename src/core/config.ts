// Repo configuration (complexity-lens.json): presets, validation and per-file resolution.
// The file comes from the repository, so it is treated as untrusted data: it can only
// change thresholds, modes and which files are scanned. It can never name a command,
// a URL or a path outside the repository.

import { matchesAny } from "./glob";

export { PRESETS, defaultConfig } from "./presets";

export type Policy = "ratchet" | "absolute";
export type AfterEditMode = "off" | "inform" | "nudge";
export type OnFinishMode = "off" | "inform" | "block";
export type CiMode = "off" | "warn" | "failOnRegression" | "failOverLimit";
export type PresetName = "relaxed" | "recommended" | "strict";

export const LIMIT_KEYS = [
  "cognitiveComplexity",
  "cyclomaticComplexity",
  "functionLines",
  "nestingDepth",
  "parameters",
  "fileLines",
  "fileTokens",
  "imports",
  "lcom",
  "contextTokens",
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
/** A limit of null turns that check off. */
export type Limits = Record<LimitKey, number | null>;

export interface HookSettings {
  afterEdit: AfterEditMode;
  onFinish: OnFinishMode;
  maxRetries: number;
}

export interface AllowComment {
  marker: string;
  requireReason: boolean;
}

/** Settings that apply to one file after presets and overrides are merged. */
export interface FileSettings {
  limits: Limits;
  policy: Policy;
  hook: HookSettings;
  allowComment: AllowComment;
}

export interface Override {
  files: string[];
  limits?: Partial<Limits>;
  policy?: Policy;
  hook?: Partial<HookSettings>;
  allowComment?: Partial<AllowComment>;
}

export interface Config extends FileSettings {
  preset: PresetName;
  include: string[];
  exclude: string[];
  ci: { mode: CiMode };
  /**
   * includeImports: how many levels of relative imports count toward context load.
   * ignoreImports: imports matching these patterns are listed but not counted (generated
   * code, examples, fixtures: data an agent doesn't need to read to change the file).
   */
  tokens: { includeImports: number; ignoreImports: string[] };
  hotspots: { historyDays: number };
  /** Commits in hotspots.historyDays that make an over-limit file FIX (hotspot) or PLAN. */
  verdicts: { fixCommits: number; planCommits: number };
  overrides: Override[];
}

export interface LoadResult {
  config: Config;
  errors: string[];
  warnings: string[];
}

export function isIncluded(config: Config, relPath: string): boolean {
  return (
    matchesAny(relPath, config.include) && !matchesAny(relPath, config.exclude)
  );
}

/** Effective settings for one file: top-level values, then every matching override in order. */
export function settingsFor(config: Config, relPath: string): FileSettings {
  const out: FileSettings = {
    limits: { ...config.limits },
    policy: config.policy,
    hook: { ...config.hook },
    allowComment: { ...config.allowComment },
  };
  for (const o of config.overrides) {
    if (!matchesAny(relPath, o.files)) continue;
    Object.assign(out.limits, o.limits);
    if (o.policy) out.policy = o.policy;
    Object.assign(out.hook, o.hook);
    Object.assign(out.allowComment, o.allowComment);
  }
  return out;
}
