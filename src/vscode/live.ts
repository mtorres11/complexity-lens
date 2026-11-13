import * as vscode from "vscode";
import type { Project } from "../core/project";
import { LANGUAGES } from "./lens";

/** How long typing must pause before the sidebar and status bar catch up with unsaved edits. */
const LIVE_DELAY_MS = 600;

export interface LiveTargets {
  projectFor(uri: vscode.Uri): Project | undefined;
  /** Redraw the status bar for the active editor. */
  updateStatus(): void;
  /** Redraw the sidebar after a delay. */
  refreshSidebar(delayMs: number): void;
}

function target(
  t: LiveTargets,
  doc: vscode.TextDocument,
): { project: Project; rel: string } | undefined {
  if (doc.uri.scheme !== "file") return undefined;
  const project = t.projectFor(doc.uri);
  const rel = project?.relative(doc.uri.fsPath);
  return project && rel ? { project, rel } : undefined;
}

/** Forget a file's unsaved text (after save or close), so the file on disk is used again. */
export function clearUnsaved(t: LiveTargets, doc: vscode.TextDocument): void {
  const hit = target(t, doc);
  hit?.project.setOverlay(hit.rel, undefined);
}

/**
 * Keeps every view in step with what is on screen: while you type, the unsaved text of
 * TS/JS files is measured instead of the saved file, shortly after typing pauses.
 */
export function watchUnsaved(t: LiveTargets): vscode.Disposable {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const apply = (doc: vscode.TextDocument): void => {
    const hit = target(t, doc);
    if (!hit || !LANGUAGES.includes(doc.languageId)) return;
    hit.project.setOverlay(hit.rel, doc.isDirty ? doc.getText() : undefined);
    if (doc === vscode.window.activeTextEditor?.document) t.updateStatus();
    t.refreshSidebar(0);
  };
  const subs = [
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!e.contentChanges.length) return;
      clearTimeout(timer);
      timer = setTimeout(() => apply(e.document), LIVE_DELAY_MS);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => clearUnsaved(t, doc)),
  ];
  return {
    dispose: () => (clearTimeout(timer), subs.forEach((s) => s.dispose())),
  };
}
