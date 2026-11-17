// Repo configuration (complexity-lens.json): presets, validation and per-file resolution.
// The file comes from the repository, so it is treated as untrusted data: it can only
// change thresholds, modes and which files are scanned. It can never name a command,
// a URL or a path outside the repository.

import { matchesAny } from "./glob";
import type { LimitKey } from "./limits";

export { PRESETS, defaultConfig } from "./presets";
export { LIMIT_KEYS } from "./limits";
export type { LimitKey } from "./limits";

export const PRESET_NAMES = ["relaxed", "recommended", "strict"] as const;
export const POLICIES = ["ratchet", "absolute"] as const;
export const AFTER_EDIT_MODES = ["off", "inform", "nudge"] as const;
export const ON_FINISH_MODES = ["off", "inform", "block"] as const;
export const CI_MODES = ["off", "warn", "failOnRegression", "failOverLimit"] as const;

export type PresetName = (typeof PRESET_NAMES)[number];
export type Policy = (typeof POLICIES)[number];
export type AfterEditMode = (typeof AFTER_EDIT_MODES)[number];
export type OnFinishMode = (typeof ON_FINISH_MODES)[number];
export type CiMode = (typeof CI_MODES)[number];

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

/** The comment that accepts a function as it is, e.g. "// complexity-ok: parser state machine". */
export const allowCommentText = (marker: string, reason: string): string => `// ${marker}: ${reason}`;

/**
 * Effective settings for one file: top-level values, then every matching override in order.
 * `policy`, when given, replaces every policy in the config (a one-off audit).
 */
export function settingsFor(config: Config, relPath: string, policy?: Policy): FileSettings {
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
  if (policy) out.policy = policy;
  return out;
}
