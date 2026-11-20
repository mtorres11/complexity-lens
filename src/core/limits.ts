// The metrics that have limits, in one table, and the rules for "over the limit".

import type { FileMetrics, FunctionMetrics } from "./analyze";
import type { FileSettings, Limits } from "./config";
import type { FileDetail } from "./insights";
import { ContextLoad, contextTokensOf } from "./context";

/**
 * Every metric with a limit, in report order. `label` reads in a sentence ("cognitive complexity
 * 16 → 20"), `short` in compact lists ("cognitive 20"), `title` in menus, `help` explains it.
 */
export const METRICS = [
  { key: "cognitiveComplexity", scope: "function", unit: "count", label: "cognitive complexity", short: "cognitive", title: "Cognitive complexity", help: "how hard a function is to follow" },
  { key: "cyclomaticComplexity", scope: "function", unit: "count", label: "cyclomatic complexity", short: "cyclomatic", title: "Cyclomatic complexity", help: "independent paths through a function" },
  { key: "functionLines", scope: "function", unit: "count", label: "lines", short: "lines", title: "Function length", help: "length of one function" },
  { key: "nestingDepth", scope: "function", unit: "count", label: "nesting depth", short: "nesting", title: "Nesting depth", help: "if/for/try inside each other" },
  { key: "parameters", scope: "function", unit: "count", label: "parameters", short: "parameters", title: "Parameters", help: "inputs a function takes" },
  { key: "fileLines", scope: "file", unit: "count", label: "file lines", short: "file lines", title: "File lines", help: "length of a file" },
  { key: "fileTokens", scope: "file", unit: "tokens", label: "estimated tokens", short: "tokens", title: "File tokens", help: "estimated tokens an AI reads to open the file" },
  { key: "imports", scope: "file", unit: "count", label: "imports", short: "imports", title: "Coupling (imports)", help: "efferent coupling: modules this file imports" },
  { key: "lcom", scope: "file", unit: "count", label: "cohesion (LCOM, unrelated groups)", short: "cohesion", title: "Cohesion (LCOM)", help: "cohesion: unrelated groups in a class or (big) file" },
  { key: "contextTokens", scope: "file", unit: "tokens", label: "context load (tokens incl. imports)", short: "context load", title: "Context load", help: "context load: tokens to read the file plus its imports" },
] as const;

export type Metric = (typeof METRICS)[number];
export type LimitKey = Metric["key"];
type FunctionMetric = Extract<Metric, { scope: "function" }>;
export type FunctionMetricKey = FunctionMetric["key"];
export type FileMetricKey = Extract<Metric, { scope: "file" }>["key"];

export const LIMIT_KEYS: readonly LimitKey[] = METRICS.map((m) => m.key);
export const METRIC = Object.fromEntries(METRICS.map((m) => [m.key, m])) as { [K in LimitKey]: Extract<Metric, { key: K }> };
export const FUNCTION_METRICS = METRICS.filter((m): m is FunctionMetric => m.scope === "function");
export const FUNCTION_KEYS: readonly FunctionMetricKey[] = FUNCTION_METRICS.map((m) => m.key);
export const FILE_KEYS = METRICS.filter((m) => m.scope === "file").map((m) => m.key) as FileMetricKey[];

/** A function's values for the function metrics. */
export type FunctionValues = Pick<FunctionMetrics, FunctionMetricKey>;

/** True when a measured value is above a limit that is turned on. */
export const isOver = (value: number | undefined, limit: number | null): boolean =>
  value !== undefined && limit !== null && value > limit;

/** The function metrics a function is over. */
export const functionOverLimits = (f: FunctionValues, limits: Limits): FunctionMetricKey[] =>
  FUNCTION_KEYS.filter((k) => isOver(f[k], limits[k]));

/** True when the file has a metric over its limit ("red"), itself or in one of its functions. */
export const hasRed = (d: Pick<FileDetail, "overLimits" | "functions">): boolean =>
  d.overLimits.length > 0 || d.functions.some((f) => f.over);

/** Accepted with the allow comment (and a reason, when the config requires one). */
export function isAllowed(fn: FunctionMetrics, s: FileSettings): boolean {
  if (fn.allowReason === undefined) return false;
  return !s.allowComment.requireReason || fn.allowReason.length > 0;
}

/**
 * LCOM that counts against the limit: classes always; the module only once the file is at
 * least half the line limit, so small utility files with a few unrelated helpers are fine.
 */
export function judgedLcom(m: FileMetrics, s: FileSettings): number {
  const lcomOf = (scope: "class" | "module") => Math.max(0, ...m.cohesion.filter((c) => c.scope === scope).map((c) => c.lcom));
  const big = s.limits.fileLines === null || m.fileLines * 2 >= s.limits.fileLines;
  return Math.max(lcomOf("class"), big ? lcomOf("module") : 0);
}

/** Value of a file-level metric, or undefined when it can't be measured (context load without `ctx`). */
export function fileValue(m: FileMetrics, metric: FileMetricKey, s: FileSettings, ctx?: ContextLoad): number | undefined {
  if (metric === "lcom") return judgedLcom(m, s);
  if (metric === "contextTokens") return ctx && contextTokensOf(m, ctx);
  return m[metric];
}

/**
 * A metric's value for a file as judged against its limit: the worst function not accepted with
 * the allow comment for function metrics, the file's own value otherwise.
 */
export function metricValue(m: FileMetrics, metric: Metric, s: FileSettings, ctx?: ContextLoad): number | undefined {
  if (metric.scope === "file") return fileValue(m, metric.key, s, ctx);
  return Math.max(0, ...m.functions.filter((f) => !isAllowed(f, s)).map((f) => f[metric.key]));
}

/** "cognitive 20 (limit 15), cyclomatic 3, …": a function's metrics, with limits when given. */
export function functionMetricsText(f: FunctionValues, limits?: Limits, separator = ", "): string {
  const limitText = (k: FunctionMetricKey) => (limits?.[k] == null ? "" : ` (limit ${limits[k]})`);
  return FUNCTION_METRICS.map((m) => `${m.short} ${f[m.key]}${limitText(m.key)}`).join(separator);
}
