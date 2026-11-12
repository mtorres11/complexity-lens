// Builds the rows the sidebar shows. Runs in small batches so the editor stays responsive.

import { settingsFor } from "../core/config";
import { describe, Finding, isProblem } from "../core/evaluate";
import { Project } from "../core/project";

export type Scope = "changed" | "repo" | "current";
export type Sort = "aiCost" | "complexity" | "hotspot" | "name";

export interface Row {
  path: string;
  maxComplexity: number;
  maxComplexityBefore?: number;
  worstFunction?: string;
  lines: number;
  imports: number;
  aiCost: number;
  commits: number;
  hotspot: number;
  limits: {
    complexity: number | null;
    lines: number | null;
    imports: number | null;
    tokens: number | null;
  };
  problems: { line: number; text: string; status: Finding["status"] }[];
  notes: { line: number; text: string; status: Finding["status"] }[];
}

export interface Report {
  scope: Scope;
  sort: Sort;
  rows: Row[];
  totalTokens: number;
  problemCount: number;
  truncated: boolean;
}

const yieldToEditor = () => new Promise<void>((r) => setImmediate(r));

function rowFor(
  project: Project,
  rel: string,
  commits: Map<string, number>,
): Row | undefined {
  const { metrics, findings } = project.evaluate(rel);
  if (!metrics) return undefined;
  const s = settingsFor(project.config, rel);
  const worst = [...metrics.functions].sort(
    (a, b) => b.cognitiveComplexity - a.cognitiveComplexity,
  )[0];
  const before = project.baselineMetrics(rel);
  const beforeMax = before
    ? Math.max(0, ...before.functions.map((f) => f.cognitiveComplexity))
    : undefined;
  const maxComplexity = worst?.cognitiveComplexity ?? 0;
  const count = commits.get(rel) ?? 0;
  const toItem = (f: Finding) => ({
    line: f.line,
    text: describe(f),
    status: f.status,
  });
  return {
    path: rel,
    maxComplexity,
    maxComplexityBefore: beforeMax,
    worstFunction: worst?.key,
    lines: metrics.fileLines,
    imports: metrics.imports,
    aiCost: project.aiCost(rel),
    commits: count,
    hotspot: maxComplexity * count,
    limits: {
      complexity: s.limits.cognitiveComplexity,
      lines: s.limits.fileLines,
      imports: s.limits.imports,
      tokens: s.limits.fileTokens,
    },
    problems: findings.filter(isProblem).map(toItem),
    notes: findings.filter((f) => !isProblem(f)).map(toItem),
  };
}

const SORTERS: Record<Sort, (a: Row, b: Row) => number> = {
  aiCost: (a, b) => b.aiCost - a.aiCost,
  complexity: (a, b) => b.maxComplexity - a.maxComplexity,
  hotspot: (a, b) => b.hotspot - a.hotspot || b.maxComplexity - a.maxComplexity,
  name: (a, b) => a.path.localeCompare(b.path),
};

export interface ReportOptions {
  scope: Scope;
  sort: Sort;
  maxFiles: number;
  currentFile?: string;
  onProgress: (done: number, total: number) => void;
  isCancelled: () => boolean;
}

function selectFiles(project: Project, o: ReportOptions): string[] {
  if (o.scope === "current") return o.currentFile && project.includes(o.currentFile) ? [o.currentFile] : [];
  return project.files(o.scope === "repo" ? "all" : "changed");
}

export async function buildReport(project: Project, o: ReportOptions): Promise<Report | undefined> {
  const all = selectFiles(project, o);
  const files = all.slice(0, o.maxFiles);
  const commits = o.sort === "hotspot" || o.scope === "repo" ? project.hotspotCounts() : new Map<string, number>();
  const rows: Row[] = [];
  for (let i = 0; i < files.length; i++) {
    if (o.isCancelled()) return undefined;
    const row = rowFor(project, files[i], commits);
    if (row) rows.push(row);
    if (i % 25 === 24) {
      o.onProgress(i + 1, files.length);
      await yieldToEditor();
    }
  }
  rows.sort(SORTERS[o.sort]);
  return {
    scope: o.scope,
    sort: o.sort,
    rows,
    totalTokens: rows.reduce((n, r) => n + r.aiCost, 0),
    problemCount: rows.reduce((n, r) => n + r.problems.length, 0),
    truncated: all.length > files.length,
  };
}
