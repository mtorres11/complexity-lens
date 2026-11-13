// Status bar summary of the file in the editor: highest complexity and estimated tokens.

import * as vscode from "vscode";
import type { FileMetrics } from "../core/analyze";
import { Limits, settingsFor } from "../core/config";
import type { Project } from "../core/project";

const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

function texts(m: FileMetrics, limits: Limits): { text: string; tooltip: string } {
  const worst = Math.max(0, ...m.functions.map((f) => f.cognitiveComplexity));
  const limit = limits.cognitiveComplexity;
  const over = limit !== null && worst > limit;
  return {
    text: `$(pulse) ${worst}${over ? " $(warning)" : ""} · ≈${tokens(m.fileTokens)} tok`,
    tooltip: `Complexity Lens\nHighest function complexity: ${worst}${limit !== null ? ` (limit ${limit})` : ""}\nFile: ${m.fileLines} lines, ${m.imports} imports, ≈${m.fileTokens} tokens`,
  };
}

export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);

  constructor(private readonly projectFor: (uri: vscode.Uri) => Project | undefined) {
    this.item.command = "complexityLens.focus";
  }

  /** The project and repo-relative path of the editor's file, if it's measured. */
  private target(editor: vscode.TextEditor | undefined): { project: Project; rel: string } | undefined {
    if (!editor || !vscode.workspace.getConfiguration("complexityLens").get<boolean>("statusBar", true)) return undefined;
    const project = this.projectFor(editor.document.uri);
    const rel = project?.relative(editor.document.uri.fsPath);
    return project && rel && project.includes(rel) ? { project, rel } : undefined;
  }

  update(editor: vscode.TextEditor | undefined): void {
    const t = this.target(editor);
    const m = t && editor && t.project.metrics(t.rel, editor.document.getText());
    if (!t || !m) return this.item.hide();
    Object.assign(this.item, texts(m, settingsFor(t.project.config, t.rel).limits));
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
