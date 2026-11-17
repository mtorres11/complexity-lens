// View models for the screens: file summaries (report, lists), file detail, function detail.
// Plain JSON so the webview, the CLI and future integrations can all use them.

import type { FileMetrics, FunctionMetrics, Increment } from "./analyze";
import { functionAdvice } from "./advice";
import { SplitSuggestion, suggestSplit } from "./split";
import { Churn, emptyChurn } from "./churn";
import type { Config, FileSettings, Limits } from "./config";
import { ContextLoad, contextTokensOf } from "./context";
import { Coupling, coupling, DependentsIndex } from "./dependents";
import { describe, Evaluation, evaluateFile, Finding, importsDominateHint, isProblem } from "./evaluate";
import { functionOverLimits, FunctionValues, judgedLcom } from "./limits";
import { decide, Decision } from "./verdict";

export interface Item {
  line: number;
  text: string;
  status: Finding["status"];
  fn?: string;
}

/** File values shown on cards and screens: the worst function values, judged LCOM and context load. */
export interface FileValues {
  cognitiveComplexity: number;
  cyclomaticComplexity: number;
  nestingDepth: number;
  lcom: number;
  contextTokens: number;
}

export interface FileSummary extends Decision, FileValues {
  path: string;
  worstFunction?: string;
  cognitiveBefore?: number;
  fileLines: number;
  churn: Churn;
  coupling: Coupling;
  limits: Limits;
  /** Allow-comment marker for this file, e.g. "complexity-ok". */
  allowMarker: string;
  problems: Item[];
  notes: Item[];
}

export interface FunctionDetail extends FunctionValues {
  key: string;
  line: number;
  endLine: number;
  before?: FunctionValues;
  allowReason?: string;
  over: boolean;
  /** Places adding to the cognitive score, in source order. */
  hotspots: Increment[];
  calls: string[];
  calledBy: string[];
  advice: string[];
}

export interface FileDetail extends FileSummary {
  fileTokens: number;
  before?: FileValues;
  context: {
    own: number;
    fromImports: number;
    imports: { path: string; tokens: number }[];
    /** Imports matched by tokens.ignoreImports: listed, not counted. */
    ignored: string[];
    /** Set when the context load is over its limit mostly because of imports. */
    importsAdvice?: string;
  };
  dependents: string[];
  internalImports: string[];
  externalImports: number;
  functions: FunctionDetail[];
  split?: SplitSuggestion;
}

/** What the view models need from a repository (implemented by the node Project). */
export interface ProjectReader {
  readonly config: Config;
  settings(rel: string): FileSettings;
  metrics(rel: string): FileMetrics | undefined;
  contextBreakdown(rel: string): ContextLoad;
  evaluate(rel: string, baseRef: string): Evaluation;
  resolveImport(fromRel: string, spec: string): string | undefined;
}

export interface InsightContext {
  churn: Map<string, Churn>;
  dependents: DependentsIndex;
  baseRef: string;
  /**
   * Files that differ from baseRef. Files outside this set are compared with themselves,
   * which skips a git read per file in whole-repo views. Undefined = read git for every file.
   */
  changed?: Set<string>;
}

const worstOf = (m: FileMetrics, k: keyof FunctionValues) => Math.max(0, ...m.functions.map((f) => f[k]));

const fileValues = (m: FileMetrics, s: FileSettings, context: ContextLoad): FileValues => ({
  cognitiveComplexity: worstOf(m, "cognitiveComplexity"),
  cyclomaticComplexity: worstOf(m, "cyclomaticComplexity"),
  nestingDepth: worstOf(m, "nestingDepth"),
  lcom: judgedLcom(m, s),
  contextTokens: contextTokensOf(m, context),
});

const functionValues = (f: FunctionMetrics): FunctionValues => ({
  cognitiveComplexity: f.cognitiveComplexity,
  cyclomaticComplexity: f.cyclomaticComplexity,
  functionLines: f.functionLines,
  nestingDepth: f.nestingDepth,
  parameters: f.parameters,
});
const toItem = (f: Finding): Item => ({
  line: f.line,
  text: describe(f),
  status: f.status,
  fn: f.fn,
});

interface Measured {
  m: FileMetrics;
  base?: FileMetrics;
  context: ContextLoad;
  findings: Finding[];
  s: FileSettings;
}

/** Current metrics, baseline, context load and findings; unchanged files skip the git read. */
function measure(project: ProjectReader, rel: string, ctx: InsightContext): Measured | undefined {
  const s = project.settings(rel);
  if (ctx.changed && !ctx.changed.has(rel)) {
    const m = project.metrics(rel);
    if (!m) return undefined;
    const context = project.contextBreakdown(rel);
    return { m, base: m, context, findings: evaluateFile(m, m, s, context), s };
  }
  const { metrics: m, base, context, findings } = project.evaluate(rel, ctx.baseRef);
  return m && context && { m, base, context, findings, s };
}

function summaryOf(rel: string, x: Measured, project: ProjectReader, ctx: InsightContext): FileSummary {
  const { m, base, context, findings, s } = x;
  const churn = ctx.churn.get(rel) ?? emptyChurn(13);
  const ca = ctx.dependents.get(rel)?.size ?? 0;
  const worst = [...m.functions].sort(
    (a, b) => b.cognitiveComplexity - a.cognitiveComplexity,
  )[0];
  return {
    path: rel,
    ...decide({ metrics: m, findings, churn, ca, context, config: project.config, settings: s }),
    ...fileValues(m, s, context),
    worstFunction: worst?.key,
    cognitiveBefore: base ? worstOf(base, "cognitiveComplexity") : undefined,
    fileLines: m.fileLines,
    churn,
    coupling: coupling(ca, m.imports),
    limits: s.limits,
    allowMarker: s.allowComment.marker,
    problems: findings.filter(isProblem).map(toItem),
    notes: findings.filter((f) => !isProblem(f)).map(toItem),
  };
}

export function summarize(project: ProjectReader, rel: string, ctx: InsightContext): FileSummary | undefined {
  const x = measure(project, rel, ctx);
  return x && summaryOf(rel, x, project, ctx);
}

/** Calls between functions of the same file, matched by bare name ("helper" or "this.helper"). */
const callsTo = (caller: FunctionMetrics, callee: FunctionMetrics) =>
  caller !== callee && caller.calls.some((c) => c === callee.simpleName || c === `this.${callee.simpleName}`);

function functionDetail(
  fn: FunctionMetrics,
  all: FunctionMetrics[],
  prev: FunctionMetrics | undefined,
  s: FileSettings,
): FunctionDetail {
  return {
    key: fn.key,
    line: fn.line,
    endLine: fn.endLine,
    ...functionValues(fn),
    before: prev && functionValues(prev),
    allowReason: fn.allowReason,
    over: functionOverLimits(fn, s.limits).length > 0,
    hotspots: fn.increments,
    calls: all.filter((o) => callsTo(fn, o)).map((o) => o.key),
    calledBy: all.filter((o) => callsTo(o, fn)).map((o) => o.key),
    advice: functionAdvice(fn, s),
  };
}

export function detail(
  project: ProjectReader,
  rel: string,
  ctx: InsightContext,
): FileDetail | undefined {
  const x = measure(project, rel, ctx);
  if (!x) return undefined;
  const { m, base, context, s } = x;
  const summary = summaryOf(rel, x, project, ctx);
  const before = new Map((base?.functions ?? []).map((f) => [f.key, f]));
  const internal = m.relativeImports
    .map((spec) => project.resolveImport(rel, spec))
    .filter((p): p is string => !!p);
  const functions = m.functions.map((f) =>
    functionDetail(f, m.functions, before.get(f.key), s),
  );
  functions.sort(
    (a, b) => Number(b.over) - Number(a.over) || b.cognitiveComplexity - a.cognitiveComplexity,
  );
  return {
    ...summary,
    fileTokens: m.fileTokens,
    before: base && fileValues(base, s, context),
    context: {
      own: context.own,
      fromImports: context.fromImports,
      imports: context.imports.slice(0, 20),
      ignored: context.ignored.slice(0, 20),
      importsAdvice: summary.overLimits.includes("contextTokens") ? importsDominateHint(m, context) : undefined,
    },
    dependents: [...(ctx.dependents.get(rel) ?? [])].sort(),
    internalImports: internal,
    externalImports: m.imports - internal.length,
    functions,
    split: suggestSplit(m, s),
  };
}
