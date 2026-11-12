// Repo configuration (complexity-lens.json): presets, validation and per-file resolution.
// The file comes from the repository, so it is treated as untrusted data: it can only
// change thresholds, modes and which files are scanned. It can never name a command,
// a URL or a path outside the repository.

import { matchesAny } from "./glob";

export type Policy = "ratchet" | "absolute";
export type AfterEditMode = "off" | "inform" | "nudge";
export type OnFinishMode = "off" | "inform" | "block";
export type CiMode = "off" | "warn" | "failOnRegression" | "failOverLimit";
export type PresetName = "relaxed" | "recommended" | "strict";

export const LIMIT_KEYS = [
  "cognitiveComplexity",
  "functionLines",
  "nestingDepth",
  "parameters",
  "fileLines",
  "fileTokens",
  "imports",
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
  tokens: { includeImports: number };
  hotspots: { historyDays: number };
  overrides: Override[];
}

export interface LoadResult {
  config: Config;
  errors: string[];
  warnings: string[];
}

const BASE = {
  include: ["**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"],
  exclude: [
    "**/*.test.*",
    "**/*.spec.*",
    "**/__tests__/**",
    "**/generated/**",
    "**/*.d.ts",
    "dist/**",
    "build/**",
    "out/**",
    "coverage/**",
    "**/node_modules/**",
    "**/vendor/**",
    "**/*.min.js",
  ],
  allowComment: { marker: "complexity-ok", requireReason: true },
  tokens: { includeImports: 1 },
  hotspots: { historyDays: 90 },
};

export const PRESETS: Record<
  PresetName,
  Omit<
    Config,
    | "preset"
    | "include"
    | "exclude"
    | "overrides"
    | "allowComment"
    | "tokens"
    | "hotspots"
  >
> = {
  relaxed: {
    limits: {
      cognitiveComplexity: 25,
      functionLines: 100,
      nestingDepth: 5,
      parameters: 7,
      fileLines: 800,
      fileTokens: 16000,
      imports: 25,
    },
    policy: "ratchet",
    hook: { afterEdit: "inform", onFinish: "off", maxRetries: 2 },
    ci: { mode: "off" },
  },
  recommended: {
    limits: {
      cognitiveComplexity: 15,
      functionLines: 60,
      nestingDepth: 4,
      parameters: 5,
      fileLines: 400,
      fileTokens: 8000,
      imports: 15,
    },
    policy: "ratchet",
    hook: { afterEdit: "nudge", onFinish: "block", maxRetries: 2 },
    ci: { mode: "warn" },
  },
  strict: {
    limits: {
      cognitiveComplexity: 10,
      functionLines: 40,
      nestingDepth: 3,
      parameters: 4,
      fileLines: 300,
      fileTokens: 6000,
      imports: 12,
    },
    policy: "absolute",
    hook: { afterEdit: "nudge", onFinish: "block", maxRetries: 2 },
    ci: { mode: "failOverLimit" },
  },
};

export function defaultConfig(preset: PresetName = "recommended"): Config {
  const p = PRESETS[preset];
  return {
    preset,
    include: [...BASE.include],
    exclude: [...BASE.exclude],
    limits: { ...p.limits },
    policy: p.policy,
    hook: { ...p.hook },
    ci: { ...p.ci },
    allowComment: { ...BASE.allowComment },
    tokens: { ...BASE.tokens },
    hotspots: { ...BASE.hotspots },
    overrides: [],
  };
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
