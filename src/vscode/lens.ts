// Inline scores above functions (CodeLens) and the status bar summary.

import * as vscode from "vscode";
import { settingsFor } from "../core/config";
import type { FunctionMetrics } from "../core/analyze";
import type { Project } from "../core/project";

export const LANGUAGES = [
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
];

const cfg = () => vscode.workspace.getConfiguration("complexityLens");

function label(
  fn: FunctionMetrics,
  limits: ReturnType<typeof settingsFor>["limits"],
): string {
  const over = (v: number, l: number | null) =>
    l !== null && v > l ? " ⚠" : "";
  const parts = [
    `complexity ${fn.cognitiveComplexity}${over(fn.cognitiveComplexity, limits.cognitiveComplexity)}`,
    `${fn.functionLines} lines${over(fn.functionLines, limits.functionLines)}`,
    `nesting ${fn.nestingDepth}${over(fn.nestingDepth, limits.nestingDepth)}`,
  ];
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
    const limits = settingsFor(project.config, rel).limits;
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

export function explain(
  fn: FunctionMetrics,
  limits: ReturnType<typeof settingsFor>["limits"],
): void {
  const row = (name: string, v: number, l: number | null) =>
    `${name}: ${v}${l === null ? "" : ` (limit ${l})`}`;
  vscode.window.showInformationMessage(`${fn.key}`, {
    modal: true,
    detail: [
      row(
        "Cognitive complexity",
        fn.cognitiveComplexity,
        limits.cognitiveComplexity,
      ),
      row("Lines", fn.functionLines, limits.functionLines),
      row("Nesting depth", fn.nestingDepth, limits.nestingDepth),
      row("Parameters", fn.parameters, limits.parameters),
      fn.allowReason !== undefined
        ? `Accepted by comment${fn.allowReason ? `: ${fn.allowReason}` : ""}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    90,
  );

  constructor(
    private readonly projectFor: (uri: vscode.Uri) => Project | undefined,
  ) {
    this.item.command = "complexityLens.focus";
  }

  update(editor: vscode.TextEditor | undefined): void {
    const project = editor && this.projectFor(editor.document.uri);
    const rel = project?.relative(editor?.document.uri.fsPath ?? "");
    if (
      !cfg().get<boolean>("statusBar", true) ||
      !editor ||
      !project ||
      !rel ||
      !project.includes(rel)
    ) {
      this.item.hide();
      return;
    }
    const m = project.metrics(rel, editor.document.getText());
    if (!m) return this.item.hide();
    const limits = settingsFor(project.config, rel).limits;
    const worst = Math.max(0, ...m.functions.map((f) => f.cognitiveComplexity));
    const over =
      limits.cognitiveComplexity !== null && worst > limits.cognitiveComplexity;
    const tokens =
      m.fileTokens >= 1000
        ? `${(m.fileTokens / 1000).toFixed(1)}k`
        : `${m.fileTokens}`;
    this.item.text = `$(pulse) ${worst}${over ? " $(warning)" : ""} · ≈${tokens} tok`;
    this.item.tooltip = `Complexity Lens\nHighest function complexity: ${worst}${limits.cognitiveComplexity !== null ? ` (limit ${limits.cognitiveComplexity})` : ""}\nFile: ${m.fileLines} lines, ${m.imports} imports, ≈${m.fileTokens} tokens`;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
