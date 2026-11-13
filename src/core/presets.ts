// Presets and defaults for complexity-lens.json.

import type { Config, PresetName } from "./config";

const BASE: Pick<Config, "include" | "exclude" | "allowComment" | "tokens" | "hotspots" | "verdicts"> = {
  include: ["**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"],
  exclude: [
    "**/*.test.*",
    "**/*.spec.*",
    "**/__tests__/**",
    "**/generated/**",
    "**/_generated/**",
    "**/*.generated.*",
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
  verdicts: { fixCommits: 6, planCommits: 2 },
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
    | "verdicts"
  >
> = {
  relaxed: {
    limits: {
      cognitiveComplexity: 25,
      cyclomaticComplexity: 20,
      functionLines: 100,
      nestingDepth: 5,
      parameters: 7,
      fileLines: 800,
      fileTokens: 16000,
      imports: 25,
    lcom: 4,
    contextTokens: 40000,
    },
    policy: "ratchet",
    hook: { afterEdit: "inform", onFinish: "off", maxRetries: 2 },
    ci: { mode: "off" },
  },
  recommended: {
    limits: {
      cognitiveComplexity: 15,
      cyclomaticComplexity: 10,
      functionLines: 60,
      nestingDepth: 4,
      parameters: 5,
      fileLines: 400,
      fileTokens: 8000,
      imports: 15,
    lcom: 1,
    contextTokens: 20000,
    },
    policy: "ratchet",
    hook: { afterEdit: "nudge", onFinish: "block", maxRetries: 2 },
    ci: { mode: "warn" },
  },
  strict: {
    limits: {
      cognitiveComplexity: 10,
      cyclomaticComplexity: 8,
      functionLines: 40,
      nestingDepth: 3,
      parameters: 4,
      fileLines: 300,
      fileTokens: 6000,
      imports: 12,
    lcom: 1,
    contextTokens: 15000,
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
    verdicts: { ...BASE.verdicts },
    overrides: [],
  };
}

