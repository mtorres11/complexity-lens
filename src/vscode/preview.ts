// Shows a proposed fix with nothing written: read-only "current" and "fixed" documents in VS Code's
// diff editor, a toggle between the two, and Apply / Try again / Discard in a notification and in
// the editor title bar. Closing every preview tab counts as Discard.

import * as path from "path";
import * as vscode from "vscode";
import type { ReviewDecision, ReviewFile } from "../app/host";

export const PREVIEW_SCHEME = "complexity-lens-preview";
type Side = "current" | "fixed";

const texts = new Map<string, string>();
let round = 0;
let decide: ((d: ReviewDecision) => void) | undefined;

/** "src/pricing (fixed).ts": keeps the extension, so syntax colours and icons are right. */
function previewUri(rel: string, side: Side, n: number): vscode.Uri {
  const ext = path.posix.extname(rel);
  return vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: `/${rel.slice(0, rel.length - ext.length)} (${side})${ext}`, query: `round=${n}` });
}

/** The same file's other side: current ↔ fixed. */
function otherSide(uri: vscode.Uri): vscode.Uri {
  const swapped = uri.path.replace(/ \((current|fixed)\)(\.[^./]*)?$/, (_m, side: Side, ext = "") => ` (${side === "fixed" ? "current" : "fixed"})${ext}`);
  return uri.with({ path: swapped });
}

/** Every URI a tab shows (plain, diff and multi-file diff tabs). */
function tabUris(tab: vscode.Tab): (vscode.Uri | undefined)[] {
  const input = tab.input as { uri?: vscode.Uri; original?: vscode.Uri; modified?: vscode.Uri; textDiffs?: { modified: vscode.Uri }[] } | undefined;
  return [input?.uri, input?.original, input?.modified, ...(input?.textDiffs ?? []).map((d) => d.modified)];
}
const isPreviewTab = (tab: vscode.Tab) => tabUris(tab).some((u) => u?.scheme === PREVIEW_SCHEME);
const previewTabs = () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter(isPreviewTab);

/** Ends the open review (if any) with `d`, closes its tabs and forgets its texts. */
function finish(d: ReviewDecision): void {
  const resolve = decide;
  decide = undefined;
  if (!resolve) return;
  texts.clear();
  void vscode.window.tabGroups.close(previewTabs());
  resolve(d);
}

export async function review(files: ReviewFile[], summary: string): Promise<ReviewDecision> {
  finish("discard");
  const n = ++round;
  const pairs = files.map((f) => {
    const left = previewUri(f.rel, "current", n);
    const right = previewUri(f.rel, "fixed", n);
    texts.set(left.toString(), f.before ?? "");
    texts.set(right.toString(), f.after);
    return { f, left, right };
  });
  const decision = new Promise<ReviewDecision>((resolve) => (decide = resolve));
  if (pairs.length === 1) {
    await vscode.commands.executeCommand("vscode.diff", pairs[0].left, pairs[0].right, `${pairs[0].f.rel}: current ↔ fixed (preview)`);
  } else {
    await vscode.commands.executeCommand("vscode.changes", `Preview fix: ${pairs.length} files`, pairs.map((p) => [vscode.Uri.file(p.f.absPath), p.left, p.right]));
  }
  void vscode.window
    .showInformationMessage(`Complexity Lens: ${summary.split("\n").join(" ")}`, "Apply", "Try again", "Discard")
    .then((pick) => pick && finish(pick === "Apply" ? "apply" : pick === "Try again" ? "retry" : "discard"));
  return decision;
}

export async function writeFiles(files: { absPath: string; content: string }[]): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  for (const f of files) {
    const uri = vscode.Uri.file(f.absPath);
    const doc = await vscode.workspace.openTextDocument(uri).then(
      (d) => d,
      () => undefined,
    );
    if (doc) edit.replace(uri, doc.validateRange(new vscode.Range(0, 0, doc.lineCount, 0)), f.content);
    else {
      edit.createFile(uri, { ignoreIfExists: false });
      edit.insert(uri, new vscode.Position(0, 0), f.content);
    }
  }
  if (!(await vscode.workspace.applyEdit(edit))) throw new Error("VS Code could not apply the changes.");
  for (const f of files) await (await vscode.workspace.openTextDocument(vscode.Uri.file(f.absPath))).save();
  if (files[0]) await vscode.window.showTextDocument(vscode.Uri.file(files[0].absPath));
}

export async function choose<T extends string>(title: string, options: { id: T; label: string; detail: string }[]): Promise<T | undefined> {
  return (await vscode.window.showQuickPick(options, { title }))?.id;
}

/** The read-only documents, the title-bar commands, and Discard when the last preview tab closes. */
export function registerPreview(): vscode.Disposable[] {
  const decision = (d: ReviewDecision) => () => finish(d);
  return [
    vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, { provideTextDocumentContent: (uri) => texts.get(uri.toString()) ?? "" }),
    vscode.commands.registerCommand("complexityLens.previewApply", decision("apply")),
    vscode.commands.registerCommand("complexityLens.previewRetry", decision("retry")),
    vscode.commands.registerCommand("complexityLens.previewDiscard", decision("discard")),
    vscode.commands.registerCommand("complexityLens.previewToggle", async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (uri?.scheme === PREVIEW_SCHEME) await vscode.window.showTextDocument(otherSide(uri), { preview: true });
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => decide && !previewTabs().length && finish("discard")),
  ];
}
