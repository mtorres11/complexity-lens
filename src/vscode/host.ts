// The VS Code side of the panel: delivers what the panel controller asks for (messages,
// state, settings, clipboard, files, prompts, edits, notifications, commands).

import * as path from "path";
import * as vscode from "vscode";
import type { HostCommand, HostPort } from "../app/host";
import { choose, review, writeFiles } from "./preview";

const SECTION = "complexityLens";
const COPY = "Copy to clipboard";
const SAVE = "Save as Markdown file…";

const COMMANDS: Record<Exclude<HostCommand, "openRepo">, string> = {
  openConfig: "complexityLens.openConfig",
  installHook: "complexityLens.installHook",
};

const NOTIFY: Record<"info" | "warning" | "error", (text: string) => Thenable<unknown>> = {
  info: (text) => vscode.window.showInformationMessage(text),
  warning: (text) => vscode.window.showWarningMessage(text),
  error: (text) => vscode.window.showErrorMessage(text),
};

const settings = () => vscode.workspace.getConfiguration(SECTION);
const caretAt = (line: number) => new vscode.Range(line - 1, 0, line - 1, 0);

async function copy(text: string, what: string): Promise<void> {
  await vscode.env.clipboard.writeText(text);
  const hint = /prompt/.test(what) ? " Paste it into your AI agent." : "";
  void vscode.window.showInformationMessage(`Complexity Lens: ${what} copied to the clipboard.${hint}`);
}

async function saveText(folder: string, text: string, suggestedName: string, what: string): Promise<void> {
  const pick = await vscode.window.showQuickPick([COPY, SAVE], { title: `${what}: where to?` });
  if (pick === COPY) return copy(text, what);
  if (pick !== SAVE) return;
  const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(folder, suggestedName)), filters: { Markdown: ["md"] }, title: `Save ${what}` });
  if (!uri) return;
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, "utf8"));
  await vscode.window.showTextDocument(uri, { preview: true });
}

async function insertLine(absPath: string, line: number, text: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
  const target = doc.lineAt(line - 1);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(doc.uri, new vscode.Position(line - 1, 0), `${target.text.slice(0, target.firstNonWhitespaceCharacterIndex)}${text}\n`);
  await vscode.workspace.applyEdit(edit);
  await vscode.window.showTextDocument(doc, { selection: caretAt(line) });
}

/** The parts that don't depend on the view or the repo. */
const EDITOR: Omit<HostPort, "post" | "visible" | "getState" | "setState" | "saveText" | "run"> = {
  getSetting: (key, fallback) => settings().get(key, fallback),
  setSetting: async (key, value) => settings().update(key, value, vscode.ConfigurationTarget.Global),
  openFile: async (absPath, line) => {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(absPath)), { selection: caretAt(line) });
  },
  copy,
  prompt: async (o) => vscode.window.showInputBox({ title: o.title, prompt: o.prompt, validateInput: o.validate }),
  insertLine,
  notify: (level, text) => void NOTIFY[level](text),
  withProgress: async (title, run) => vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, run),
  choose,
  review,
  writeFiles,
};

export interface HostDeps {
  ctx: vscode.ExtensionContext;
  view: () => vscode.WebviewView | undefined;
  /** Folder suggested when saving files (the active repo root). */
  root: () => string | undefined;
  /** The https repository URL from the extension's own package.json, or "". */
  repoUrl: string;
}

export function createHost(d: HostDeps): HostPort {
  return {
    ...EDITOR,
    post: (message) => void d.view()?.webview.postMessage(message),
    visible: () => !!d.view()?.visible,
    getState: (key, fallback) => d.ctx.workspaceState.get(key, fallback),
    setState: async (key, value) => d.ctx.workspaceState.update(key, value),
    saveText: (text, name, what) => saveText(d.root() ?? "", text, name, what),
    // Only the repo URL from the extension's own package.json, never a URL from the panel.
    run: (command) => void (command === "openRepo" ? d.repoUrl && vscode.env.openExternal(vscode.Uri.parse(d.repoUrl)) : vscode.commands.executeCommand(COMMANDS[command])),
  };
}
