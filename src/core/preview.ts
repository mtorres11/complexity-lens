// "Preview fix": the prompt that asks the AI for whole files instead of edits, the parser for its
// answer, and the before/after metrics shown next to the diff. Pure: no files, no processes.

import type { FileMetrics } from "./analyze";
import type { FileSettings } from "./config";
import { formatTokens } from "./format";
import { isOver, LimitKey, METRIC, METRICS, metricValue } from "./limits";

const START = "<<<FILE ";
const END = "<<<END";

/** The fix prompt, plus how to answer: whole files between markers, and no edits of its own. */
export function previewPrompt(fixPrompt: string): string {
  return [
    fixPrompt,
    "",
    "This is a preview the user reviews before anything changes: don't edit, create or delete any file yourself. You may read files for context.",
    "Reply with the complete new content of every file you change or create, each one exactly like this, with the path relative to the repository root:",
    `${START}src/example.ts`,
    "…the whole file…",
    END,
    "Outside the markers, write at most three short lines on what you changed.",
  ].join("\n");
}

export interface ProposedFile {
  path: string;
  content: string;
}

/** Files in the AI's answer, in order. A path given twice keeps its last version. */
export function parseProposal(answer: string): ProposedFile[] {
  const files = new Map<string, string>();
  const re = /^<<<FILE (.+?)\s*\r?\n([\s\S]*?)^<<<END[ \t]*$/gm;
  for (const m of answer.matchAll(re)) files.set(m[1].trim(), m[2]);
  return [...files].map(([path, content]) => ({ path, content }));
}

export interface MetricChange {
  key: LimitKey;
  /** Undefined for a new file. */
  before?: number;
  after: number;
  limit: number;
}

/**
 * Metrics over their limit before or after the change (context load is left out: it depends on
 * the imports, which the preview doesn't re-read).
 */
export function metricChanges(before: FileMetrics | undefined, after: FileMetrics, s: FileSettings): MetricChange[] {
  return METRICS.flatMap((metric) => {
    const limit = s.limits[metric.key];
    const a = metricValue(after, metric, s);
    const b = before && metricValue(before, metric, s);
    if (limit === null || a === undefined || (!isOver(b, limit) && !isOver(a, limit))) return [];
    return [{ key: metric.key, before: b, after: a, limit }];
  });
}

/** Within its limit now, but over it after the change. */
export const isNewFinding = (c: MetricChange): boolean => isOver(c.after, c.limit) && !isOver(c.before, c.limit);

/** "cognitive 20 → 9 ✓", "lines 30 → 70 ✖ new", "tokens ≈9k ✖" (new file). */
export function changeText(c: MetricChange): string {
  const m = METRIC[c.key];
  const n = (v: number) => (m.unit === "tokens" ? `≈${formatTokens(v)}` : `${v}`);
  const mark = isOver(c.after, c.limit) ? `✖${isNewFinding(c) ? " new" : ""}` : "✓";
  return `${m.short} ${c.before === undefined ? "" : `${n(c.before)} → `}${n(c.after)} ${mark}`;
}

/** "every metric within its limit", "not measured", or the changes joined. */
const filePart = (changes: MetricChange[] | undefined) => {
  if (!changes) return "not measured";
  return changes.length ? changes.map(changeText).join(", ") : "every metric within its limit";
};

/**
 * The review headline and one line per file, e.g. "1 file changed.\nsrc/a.ts: cognitive 20 → 9 ✓".
 * `changes` is undefined for files Complexity Lens doesn't measure.
 */
export function proposalSummary(files: readonly { path: string; changes?: MetricChange[] }[]): string {
  const fresh = files.some((f) => f.changes?.some(isNewFinding));
  const head = `${files.length} file${files.length === 1 ? "" : "s"} changed.${fresh ? " ⚠ It adds new findings." : ""}`;
  return [head, ...files.map((f) => `${f.path}: ${filePart(f.changes)}`)].join("\n");
}
