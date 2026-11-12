// The commented starter file written by `complexity-lens init` and the VS Code command.

import type { PresetName } from "./config";
import { PRESETS } from "./config";

export function configTemplate(preset: PresetName = "recommended"): string {
  const p = PRESETS[preset];
  const l = p.limits;
  return `// Complexity Lens configuration. Every option is optional: anything you leave out
// comes from the preset. Hover an option in VS Code to see what it does.
{
  // Starting point: "relaxed" (inform only), "recommended" (balanced) or "strict" (new projects).
  "preset": "${preset}",

  // Files to measure, and files to skip (tests, generated code, build output).
  "include": ["**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"],
  "exclude": ["**/*.test.*", "**/*.spec.*", "**/__tests__/**", "**/generated/**", "**/*.d.ts", "dist/**", "build/**", "out/**", "coverage/**", "**/node_modules/**", "**/vendor/**", "**/*.min.js"],

  // When something counts as "too much". Set a limit to null to turn that check off.
  "limits": {
    "cognitiveComplexity": ${l.cognitiveComplexity}, // how hard a function is to follow
    "functionLines": ${l.functionLines},       // length of one function
    "nestingDepth": ${l.nestingDepth},         // if/for/try inside each other
    "parameters": ${l.parameters},            // inputs a function takes
    "fileLines": ${l.fileLines},           // length of a file
    "fileTokens": ${l.fileTokens},         // estimated tokens an AI reads to open the file
    "imports": ${l.imports}               // files this file depends on
  },

  // "ratchet": don't make it worse (new code must be under the limits, old code may not grow).
  // "absolute": everything in the checked files must be under the limits.
  "policy": "${p.policy}",

  // Accept a function as is with a comment above it, e.g.  // complexity-ok: parser state machine
  "allowComment": { "marker": "complexity-ok", "requireReason": true },

  // Agent hook: checks code while an AI agent edits it.
  //   afterEdit: "off" | "inform" (a note) | "nudge" (a problem the agent must answer)
  //   onFinish:  "off" | "inform" (a summary) | "block" (can't finish until fixed)
  //   maxRetries: how often "block" sends the agent back before reporting to you instead.
  "hook": { "afterEdit": "${p.hook.afterEdit}", "onFinish": "${p.hook.onFinish}", "maxRetries": ${p.hook.maxRetries} },

  // Pull request check: "off" | "warn" | "failOnRegression" | "failOverLimit".
  "ci": { "mode": "${p.ci.mode}" },

  // AI cost also counts files this file imports, this many levels deep (0 = the file alone).
  "tokens": { "includeImports": 1 },

  // Hotspots look at how often files changed in git over this many days.
  "hotspots": { "historyDays": 90 },

  // Different rules for parts of the repo, applied in order. Example:
  // { "files": ["src/legacy/**"], "hook": { "onFinish": "inform" } }
  "overrides": []
}
`;
}
