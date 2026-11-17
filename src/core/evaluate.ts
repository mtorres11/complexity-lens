// Compares a file's current metrics with its baseline (usually the last commit) and the
// limits that apply to it, and returns findings.
//   ratchet  : new functions must be under the limit; existing ones may stay over it but
//              must not get worse. Untouched code is never flagged.
//   absolute : anything over a limit is flagged.

import type { FileMetrics, FunctionMetrics } from "./analyze";
import type { FileSettings, LimitKey } from "./config";
import { ContextLoad, contextTokensOf } from "./context";
import { formatTokens } from "./format";
import { FILE_KEYS, fileValue, FUNCTION_KEYS, isAllowed, METRIC } from "./limits";

export type FindingStatus =
  /** New function or file that is over a limit. */
  | "new-over"
  /** Existing function or file that got worse and is over a limit. */
  | "regression"
  /** Over a limit (absolute policy), not necessarily changed. */
  | "over"
  /** Over a limit but accepted with the allow comment. */
  | "allowed"
  /** Got better (only reported for information). */
  | "improved";

export interface Finding {
  path: string;
  /** Function key, or undefined for file-level metrics. */
  fn?: string;
  line: number;
  metric: LimitKey;
  value: number;
  limit: number;
  baseline?: number;
  status: FindingStatus;
  /** Advice specific to this finding; falls back to HINT[metric]. */
  hint?: string;
}

export const isProblem = (f: Finding): boolean =>
  f.status === "new-over" || f.status === "regression" || f.status === "over";

function judge(
  value: number,
  limit: number | null,
  baseline: number | undefined,
  policy: FileSettings["policy"],
): FindingStatus | undefined {
  if (limit === null) return undefined;
  const over = value > limit;
  const improved =
    baseline !== undefined && value < baseline && baseline > limit;
  if (!over) return improved ? "improved" : undefined;
  if (baseline === undefined) return "new-over";
  if (value > baseline) return "regression";
  // Over the limit and not worse: absolute still flags it; ratchet only notes progress.
  if (policy === "absolute") return "over";
  return improved ? "improved" : undefined;
}

function functionFindings(path: string, fn: FunctionMetrics, prev: FunctionMetrics | undefined, s: FileSettings): Finding[] {
  const out: Finding[] = [];
  for (const m of FUNCTION_KEYS) {
    const limit = s.limits[m];
    const status = judge(fn[m], limit, prev?.[m], s.policy);
    if (!status || limit === null) continue;
    const accepted = status !== "improved" && isAllowed(fn, s);
    out.push({ path, fn: fn.key, line: fn.line, metric: m, value: fn[m], limit, baseline: prev?.[m], status: accepted ? "allowed" : status });
  }
  return out;
}

function fileFindings(current: FileMetrics, baseline: FileMetrics | undefined, s: FileSettings, ctx?: ContextLoad): Finding[] {
  const out: Finding[] = [];
  for (const m of FILE_KEYS) {
    const limit = s.limits[m];
    const value = fileValue(current, m, s, ctx);
    const before = baseline && fileValue(baseline, m, s, ctx);
    const status = value === undefined ? undefined : judge(value, limit, before, s.policy);
    if (status && limit !== null && value !== undefined) {
      const hint = m === "contextTokens" ? importsDominateHint(current, ctx) : undefined;
      out.push({ path: current.path, line: 1, metric: m, value, limit, baseline: before, status, ...(hint ? { hint } : {}) });
    }
  }
  return out;
}

/**
 * @param baseline metrics of the same file at the baseline (undefined for a new file)
 * @param ctx the file's context load; without it the context load is not judged
 */
export function evaluateFile(current: FileMetrics, baseline: FileMetrics | undefined, s: FileSettings, ctx?: ContextLoad): Finding[] {
  const before = new Map((baseline?.functions ?? []).map((f) => [f.key, f]));
  return [
    ...current.functions.flatMap((fn) => functionFindings(current.path, fn, before.get(fn.key), s)),
    ...fileFindings(current, baseline, s, ctx),
  ];
}

export const HINT: Record<LimitKey, string> = {
  cognitiveComplexity:
    "extract branches into well-named helpers, return early, or replace nested conditions with a lookup",
  cyclomaticComplexity: "reduce the number of paths: fewer branches and boolean conditions, or split by case",
  functionLines: "split it into smaller functions that each do one thing",
  nestingDepth: "use early returns / guard clauses to flatten the nesting",
  parameters: "pass fewer things: split the function, or pass the object the values come from",
  fileLines: "move cohesive groups of functions into their own files",
  fileTokens:
    "split the file so an agent only needs to read the part it changes",
  imports: "reduce dependencies or split the file by responsibility",
  lcom: "the file or class does unrelated jobs: move each group into its own file or class",
  contextTokens: "an agent reads this file and its imports to change it: split it, or depend on smaller modules",
};

/**
 * When imports are at least half of the context load, splitting the file itself can't bring
 * it under the limit, so the advice points at the largest import instead.
 */
export function importsDominateHint(m: FileMetrics, ctx: ContextLoad | undefined): string | undefined {
  const largest = ctx?.imports[0];
  const total = ctx ? contextTokensOf(m, ctx) : m.fileTokens;
  const fromImports = total - m.fileTokens;
  if (!largest || fromImports < m.fileTokens) return undefined;
  return (
    `most of it is imports (${formatTokens(fromImports)} of ${formatTokens(total)} tokens; largest: ${largest.path} ≈${formatTokens(largest.tokens)}), ` +
    "so splitting this file won't lower it: slim or split the largest import, import a smaller module, " +
    "or add generated or data-only files to tokens.ignoreImports"
  );
}

export const hintFor = (f: Finding): string => f.hint ?? HINT[f.metric];

const STATUS_TAG: Record<FindingStatus, string> = {
  "new-over": "new, over limit",
  regression: "got worse",
  over: "over limit",
  allowed: "accepted by comment",
  improved: "improved",
};

export function describe(f: Finding): string {
  const change = f.baseline !== undefined && f.baseline !== f.value ? `${f.baseline} → ${f.value}` : `${f.value}`;
  return `${f.fn ?? "file"}: ${METRIC[f.metric].label} ${change} (limit ${f.limit}, ${STATUS_TAG[f.status]})`;
}
