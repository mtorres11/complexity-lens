// View models for the screens: file summaries (report, lists), file detail, function detail.
// Plain JSON so the webview, the CLI and future integrations can all use them.

import type { FileMetrics, FunctionMetrics, Increment } from "./analyze";
import { functionAdvice, SplitSuggestion, suggestSplit } from "./advice";
import { Churn, emptyChurn } from "./churn";
import { FileSettings, Limits, settingsFor } from "./config";
import { Coupling, coupling, DependentsIndex } from "./dependents";
import { describe, evaluateFile, Finding, isProblem, judgedLcom } from "./evaluate";
import type { Project } from "./project";
import { decide, Decision } from "./verdict";

export interface Item {
  line: number;
  text: string;
  status: Finding["status"];
  fn?: string;
}

export interface FileSummary extends Decision {
  path: string;
  cognitive: number;
  cyclomatic: number;
  nesting: number;
  worstFunction?: string;
  cognitiveBefore?: number;
  lines: number;
  lcom: number;
  contextTokens: number;
  churn: Churn;
  coupling: Coupling;
  limits: Limits;
  problems: Item[];
  notes: Item[];
}

export interface FunctionDetail {
  key: string;
  line: number;
  endLine: number;
  cognitive: number;
  cyclomatic: number;
  nesting: number;
  lines: number;
  parameters: number;
  before?: {
    cognitive: number;
    cyclomatic: number;
    nesting: number;
    lines: number;
    parameters: number;
  };
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
  before?: {
    cognitive: number;
    cyclomatic: number;
    nesting: number;
    lcom: number;
    contextTokens: number;
  };
  context: {
    own: number;
    fromImports: number;
    imports: { path: string; tokens: number }[];
  };
  dependents: string[];
  internalImports: string[];
  externalImports: number;
  functions: FunctionDetail[];
  split?: SplitSuggestion;
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

const worstOf = (
  m: FileMetrics,
  k: "cognitiveComplexity" | "cyclomaticComplexity" | "nestingDepth",
) => Math.max(0, ...m.functions.map((f) => f[k]));
const toItem = (f: Finding): Item => ({
  line: f.line,
  text: describe(f),
  status: f.status,
  fn: f.fn,
});

/** Current metrics, findings and baseline; unchanged files skip the git read. */
function measured(project: Project, rel: string, ctx: InsightContext): { m?: FileMetrics; findings: Finding[]; base?: FileMetrics } {
  if (ctx.changed && !ctx.changed.has(rel)) {
    const m = project.metrics(rel);
    if (!m) return { findings: [] };
    m.contextTokens = project.aiCost(rel);
    return { m, findings: evaluateFile(m, m, settingsFor(project.config, rel)), base: m };
  }
  const { metrics: m, findings } = project.evaluate(rel, ctx.baseRef);
  return { m, findings, base: m && project.baselineMetrics(rel, ctx.baseRef) };
}

export function summarize(project: Project, rel: string, ctx: InsightContext): FileSummary | undefined {
  const { m, findings, base } = measured(project, rel, ctx);
  if (!m) return undefined;
  const s = settingsFor(project.config, rel);
  const churn = ctx.churn.get(rel) ?? emptyChurn(13);
  const ca = ctx.dependents.get(rel)?.size ?? 0;
  const worst = [...m.functions].sort(
    (a, b) => b.cognitiveComplexity - a.cognitiveComplexity,
  )[0];
  return {
    path: rel,
    ...decide({
      metrics: m,
      findings,
      churn,
      ca,
      config: project.config,
      settings: s,
    }),
    cognitive: worstOf(m, "cognitiveComplexity"),
    cyclomatic: worstOf(m, "cyclomaticComplexity"),
    nesting: worstOf(m, "nestingDepth"),
    worstFunction: worst?.key,
    cognitiveBefore: base ? worstOf(base, "cognitiveComplexity") : undefined,
    lines: m.fileLines,
    lcom: judgedLcom(m, s),
    contextTokens: m.contextTokens ?? m.fileTokens,
    churn,
    coupling: coupling(ca, m.imports),
    limits: s.limits,
    problems: findings.filter(isProblem).map(toItem),
    notes: findings.filter((f) => !isProblem(f)).map(toItem),
  };
}

function functionDetail(
  fn: FunctionMetrics,
  all: FunctionMetrics[],
  prev: FunctionMetrics | undefined,
  s: FileSettings,
): FunctionDetail {
  const L = s.limits;
  const over = (v: number, l: number | null) => l !== null && v > l;
  const simple = (key: string) => key.replace(/^.*\./, "").replace(/#\d+$/, "");
  const name = simple(fn.key);
  const calledBy = all
    .filter(
      (o) =>
        o !== fn && o.calls.some((c) => c === name || c === `this.${name}`),
    )
    .map((o) => o.key);
  const calls = all
    .filter(
      (o) =>
        o !== fn &&
        fn.calls.some(
          (c) => c === simple(o.key) || c === `this.${simple(o.key)}`,
        ),
    )
    .map((o) => o.key);
  return {
    key: fn.key,
    line: fn.line,
    endLine: fn.endLine,
    cognitive: fn.cognitiveComplexity,
    cyclomatic: fn.cyclomaticComplexity,
    nesting: fn.nestingDepth,
    lines: fn.functionLines,
    parameters: fn.parameters,
    before: prev && {
      cognitive: prev.cognitiveComplexity,
      cyclomatic: prev.cyclomaticComplexity,
      nesting: prev.nestingDepth,
      lines: prev.functionLines,
      parameters: prev.parameters,
    },
    allowReason: fn.allowReason,
    over:
      over(fn.cognitiveComplexity, L.cognitiveComplexity) ||
      over(fn.cyclomaticComplexity, L.cyclomaticComplexity) ||
      over(fn.nestingDepth, L.nestingDepth) ||
      over(fn.functionLines, L.functionLines) ||
      over(fn.parameters, L.parameters),
    hotspots: fn.increments,
    calls,
    calledBy,
    advice: functionAdvice(fn, s),
  };
}

export function detail(
  project: Project,
  rel: string,
  ctx: InsightContext,
): FileDetail | undefined {
  const summary = summarize(project, rel, ctx);
  const m = project.metrics(rel);
  if (!summary || !m) return undefined;
  const s = settingsFor(project.config, rel);
  const base = project.baselineMetrics(rel, ctx.baseRef);
  const before = new Map((base?.functions ?? []).map((f) => [f.key, f]));
  const ctxLoad = project.contextBreakdown(rel);
  m.contextTokens = ctxLoad.total;
  const internal = m.relativeImports
    .map((spec) => project.resolveImport(rel, spec))
    .filter((p): p is string => !!p);
  const functions = m.functions.map((f) =>
    functionDetail(f, m.functions, before.get(f.key), s),
  );
  functions.sort(
    (a, b) => Number(b.over) - Number(a.over) || b.cognitive - a.cognitive,
  );
  return {
    ...summary,
    fileTokens: m.fileTokens,
    before: base && {
      cognitive: worstOf(base, "cognitiveComplexity"),
      cyclomatic: worstOf(base, "cyclomaticComplexity"),
      nesting: worstOf(base, "nestingDepth"),
      lcom: judgedLcom(base, s),
      contextTokens: base.fileTokens + ctxLoad.fromImports,
    },
    context: {
      own: ctxLoad.own,
      fromImports: ctxLoad.fromImports,
      imports: ctxLoad.imports.slice(0, 20),
    },
    dependents: [...(ctx.dependents.get(rel) ?? [])].sort(),
    internalImports: internal,
    externalImports: m.imports - internal.length,
    functions,
    split: suggestSplit(m, s),
  };
}
