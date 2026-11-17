// Inline scores above functions (CodeLens), and the details shown when one is clicked.

import * as vscode from "vscode";
import type { Limits } from "../core/config";
import { FUNCTION_METRICS, isOver, METRIC } from "../core/limits";
import type { FunctionMetrics } from "../core/analyze";
import type { Project } from "../node/project";

export const LANGUAGES = [
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
];

const cfg = () => vscode.workspace.getConfiguration("complexityLens");

/** The metrics shown inline, e.g. "cognitive 12 · lines 40 ⚠ · nesting 3". */
const INLINE = [METRIC.cognitiveComplexity, METRIC.functionLines, METRIC.nestingDepth];

function label(fn: FunctionMetrics, limits: Limits): string {
  const parts = INLINE.map((m) => `${m.short} ${fn[m.key]}${isOver(fn[m.key], limits[m.key]) ? " ⚠" : ""}`);
  if (fn.allowReason !== undefined) parts.push("accepted");
  return parts.join(" · ");
}

export class ComplexityCodeLens implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  constructor(
    private readonly projectFor: (uri: vscode.Uri) => Project | undefined,
  ) {}

  refresh(): void {
    this.changed.fire();
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!cfg().get<boolean>("inlineScores", true)) return [];
    const project = this.projectFor(doc.uri);
    const rel = project?.relative(doc.uri.fsPath);
    if (!project || !rel || !project.includes(rel)) return [];
    const metrics = project.metrics(rel, doc.getText());
    if (!metrics) return [];
    const limits = project.settings(rel).limits;
    return metrics.functions.map((fn) => {
      const range = new vscode.Range(fn.line - 1, 0, fn.line - 1, 0);
      return new vscode.CodeLens(range, {
        title: label(fn, limits),
        command: "complexityLens.explain",
        arguments: [fn, limits],
        tooltip: "Complexity Lens: click for details",
      });
    });
  }
}

export function explain(fn: FunctionMetrics, limits: Limits): void {
  const rows = FUNCTION_METRICS.map((m) => `${m.title}: ${fn[m.key]}${limits[m.key] === null ? "" : ` (limit ${limits[m.key]})`}`);
  if (fn.allowReason !== undefined) rows.push(`Accepted by comment${fn.allowReason ? `: ${fn.allowReason}` : ""}`);
  vscode.window.showInformationMessage(fn.key, { modal: true, detail: rows.join("\n") });
}
