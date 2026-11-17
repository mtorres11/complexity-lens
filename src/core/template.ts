// The commented starter file written by `complexity-lens init` and the VS Code command.
// Every value comes from the preset, so the file always matches it.

import { CI_MODES, defaultConfig, PresetName } from "./config";
import { METRICS } from "./limits";
import { PRESET_INFO } from "./presets";
import { VERDICT_TEXT } from "./verdict";

/** One-line JSON with spaces, e.g. { "a": 1 } or ["x", "y"]. */
const inline = (v: unknown): string => JSON.stringify(v, null, 1).replace(/\n\s*/g, " ").replace(/\[ /g, "[").replace(/ \]/g, "]");

/** The limits block: one line per metric with what it measures. */
function limitLines(limits: Record<string, number | null>): string {
  const lines = METRICS.map((m, i) => {
    const entry = `"${m.key}": ${limits[m.key]}${i < METRICS.length - 1 ? "," : ""}`;
    return `    ${entry.padEnd(30)} // ${m.help}`;
  });
  return lines.join("\n");
}

const presetLines = () =>
  Object.entries(PRESET_INFO)
    .map(([name, info]) => `  //   "${name}": ${info}`)
    .join("\n");

export function configTemplate(preset: PresetName = "recommended"): string {
  const c = defaultConfig(preset);
  return `// Complexity Lens configuration. Every option is optional: anything you leave out
// comes from the preset. Hover an option in VS Code to see what it does.
{
  // Starting point:
${presetLines()}
  "preset": "${preset}",

  // Files to measure, and files to skip (tests, generated code, build output).
  "include": ${inline(c.include)},
  "exclude": ${inline(c.exclude)},

  // When something counts as "too much". Set a limit to null to turn that check off.
  "limits": {
${limitLines(c.limits)}
  },

  // "ratchet": don't make it worse (new code must be under the limits, old code may not grow).
  // "absolute": everything in the checked files must be under the limits.
  "policy": "${c.policy}",

  // Accept a function as is with a comment above it, e.g.  // ${c.allowComment.marker}: parser state machine
  "allowComment": ${inline(c.allowComment)},

  // Agent hook: checks code while an AI agent edits it.
  //   afterEdit: "off" | "inform" (a note) | "nudge" (a problem the agent must answer)
  //   onFinish:  "off" | "inform" (a summary) | "block" (can't finish until fixed)
  //   maxRetries: how often "block" sends the agent back before reporting to you instead.
  "hook": ${inline(c.hook)},

  // Pull request check: ${CI_MODES.map((m) => `"${m}"`).join(" | ")}.
  "ci": ${inline(c.ci)},

  // AI cost also counts files this file imports, this many levels deep (0 = the file alone),
  // except imports matching ignoreImports (generated code, examples, fixtures: data, not logic).
  "tokens": ${inline(c.tokens)},

  // Hotspots look at how often files changed in git over this many days.
  "hotspots": ${inline(c.hotspots)},

  // Verdicts for files over a limit: FIX if changed at least fixCommits times in historyDays,
  // PLAN if at least planCommits times, otherwise LEAVE (${VERDICT_TEXT.LEAVE.reason}).
  "verdicts": ${inline(c.verdicts)},

  // Different rules for parts of the repo, applied in order. Example:
  // { "files": ["src/legacy/**"], "hook": { "onFinish": "inform" } }
  "overrides": []
}
`;
}
