// Compares a file's current metrics with its baseline (usually the last commit) and the
// limits that apply to it, and returns findings.
//   ratchet  : new functions must be under the limit; existing ones may stay over it but
//              must not get worse. Untouched code is never flagged.
//   absolute : anything over a limit is flagged.

import type { FileMetrics, FunctionMetrics } from "./analyze";
import type { FileSettings, LimitKey } from "./config";

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
}

const FUNCTION_METRICS = [
  "cognitiveComplexity",
  "cyclomaticComplexity",
  "functionLines",
  "nestingDepth",
  "parameters",
] as const;
const FILE_METRICS = ["fileLines", "fileTokens", "imports", "lcom", "contextTokens"] as const;
type FileMetric = (typeof FILE_METRICS)[number];

/**
 * LCOM that counts against the limit: classes always; the module only once the file is at
 * least half the line limit, so small utility files with a few unrelated helpers are fine.
 */
export function judgedLcom(m: FileMetrics, s: FileSettings): number {
  const classes = Math.max(0, ...m.cohesion.filter((c) => c.scope === "class").map((c) => c.lcom));
  const big = s.limits.fileLines === null || m.fileLines * 2 >= s.limits.fileLines;
  const mod = big ? Math.max(0, ...m.cohesion.filter((c) => c.scope === "module").map((c) => c.lcom)) : 0;
  return Math.max(classes, mod);
}

/** Value of a file-level metric, or undefined when it can't be measured. */
export function fileValue(m: FileMetrics, metric: FileMetric, s: FileSettings): number | undefined {
  if (metric === "lcom") return judgedLcom(m, s);
  if (metric === "contextTokens") return m.contextTokens;
  return m[metric];
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

function allowed(fn: FunctionMetrics, s: FileSettings): boolean {
  if (fn.allowReason === undefined) return false;
  return !s.allowComment.requireReason || fn.allowReason.length > 0;
}

function functionFindings(path: string, fn: FunctionMetrics, prev: FunctionMetrics | undefined, s: FileSettings): Finding[] {
  const out: Finding[] = [];
  for (const m of FUNCTION_METRICS) {
    const limit = s.limits[m];
    const status = judge(fn[m], limit, prev?.[m], s.policy);
    if (!status || limit === null) continue;
    const accepted = status !== "improved" && allowed(fn, s);
    out.push({ path, fn: fn.key, line: fn.line, metric: m, value: fn[m], limit, baseline: prev?.[m], status: accepted ? "allowed" : status });
  }
  return out;
}

function fileFindings(current: FileMetrics, baseline: FileMetrics | undefined, s: FileSettings): Finding[] {
  const out: Finding[] = [];
  for (const m of FILE_METRICS) {
    const limit = s.limits[m];
    const value = fileValue(current, m, s);
    const before = baseline && fileValue(baseline, m, s);
    const status = value === undefined ? undefined : judge(value, limit, before, s.policy);
    if (status && limit !== null && value !== undefined) {
      out.push({ path: current.path, line: 1, metric: m, value, limit, baseline: before, status });
    }
  }
  return out;
}

/**
 * @param baseline metrics of the same file at the baseline (undefined for a new file)
 */
export function evaluateFile(current: FileMetrics, baseline: FileMetrics | undefined, s: FileSettings): Finding[] {
  const before = new Map((baseline?.functions ?? []).map((f) => [f.key, f]));
  return [
    ...current.functions.flatMap((fn) => functionFindings(current.path, fn, before.get(fn.key), s)),
    ...fileFindings(current, baseline, s),
  ];
}

export const METRIC_LABEL: Record<LimitKey, string> = {
  cognitiveComplexity: "cognitive complexity",
  cyclomaticComplexity: "cyclomatic complexity",
  functionLines: "lines",
  nestingDepth: "nesting depth",
  parameters: "parameters",
  fileLines: "file lines",
  fileTokens: "estimated tokens",
  imports: "imports",
  lcom: "cohesion (LCOM, unrelated groups)",
  contextTokens: "context load (tokens incl. imports)",
};

export const HINT: Record<LimitKey, string> = {
  cognitiveComplexity:
    "extract branches into well-named helpers, return early, or replace nested conditions with a lookup",
  cyclomaticComplexity: "reduce the number of paths: fewer branches and boolean conditions, or split by case",
  functionLines: "split it into smaller functions that each do one thing",
  nestingDepth: "use early returns / guard clauses to flatten the nesting",
  parameters: "group related parameters into an options object",
  fileLines: "move cohesive groups of functions into their own files",
  fileTokens:
    "split the file so an agent only needs to read the part it changes",
  imports: "reduce dependencies or split the file by responsibility",
  lcom: "the file or class does unrelated jobs: move each group into its own file or class",
  contextTokens: "an agent reads this file and its imports to change it: split it, or depend on smaller modules",
};

export function describe(f: Finding): string {
  const where = f.fn ? `${f.fn}` : "file";
  const change =
    f.baseline !== undefined && f.baseline !== f.value
      ? `${f.baseline} → ${f.value}`
      : `${f.value}`;
  const tag =
    f.status === "new-over"
      ? "new, over limit"
      : f.status === "regression"
        ? "got worse"
        : f.status === "allowed"
          ? "accepted by comment"
          : f.status === "improved"
            ? "improved"
            : "over limit";
  return `${where}: ${METRIC_LABEL[f.metric]} ${change} (limit ${f.limit}, ${tag})`;
}
