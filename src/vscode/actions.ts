// What the action buttons do. Text is always built here from the extension's own data;
// the webview only says which file/function and which action.

import * as path from "path";
import * as vscode from "vscode";
import * as text from "../core/actions";
import type { FileDetail } from "../core/insights";
import type { Project } from "../core/project";
import type { ActionKind, BatchKind } from "./protocol";

async function copy(value: string, what: string): Promise<void> {
  await vscode.env.clipboard.writeText(value);
  vscode.window.setStatusBarMessage(
    `$(check) Complexity Lens: ${what} copied`,
    3000,
  );
}

/** Ticket drafts can be copied, or saved as a Markdown file the user picks. */
async function deliverMarkdown(
  project: Project,
  value: string,
  suggestedName: string,
  what: string,
): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    ["Copy to clipboard", "Save as Markdown file…"],
    { title: `${what}: where to?` },
  );
  if (pick === "Copy to clipboard") return copy(value, what);
  if (pick !== "Save as Markdown file…") return;
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(project.root, suggestedName)),
    filters: { Markdown: ["md"] },
    title: `Save ${what}`,
  });
  if (!uri) return;
  await vscode.workspace.fs.writeFile(uri, Buffer.from(value, "utf8"));
  await vscode.window.showTextDocument(uri, { preview: true });
}

const slug = (p: string) =>
  (p.split("/").pop() ?? "file")
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-");

/** Adds "// <marker>: <reason>" above a function after asking for the reason. */
async function accept(
  project: Project,
  d: FileDetail,
  fnKey: string | undefined,
): Promise<void> {
  const fn =
    d.functions.find((f) => f.key === fnKey) ?? d.functions.find((f) => f.over);
  if (!fn)
    return void vscode.window.showInformationMessage(
      "Complexity Lens: nothing to accept in this file.",
    );
  const marker = project.config.allowComment.marker;
  const reason = await vscode.window.showInputBox({
    title: `Accept ${fn.key} as it is`,
    prompt: `Why is this complexity necessary? It's added as "// ${marker}: <reason>" above the function.`,
    validateInput: (v) =>
      v.trim().length >= 3
        ? undefined
        : "Give a short reason (at least 3 characters)",
  });
  if (!reason) return;
  const abs = project.absolute(d.path);
  if (!abs) return;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
  const line = doc.lineAt(fn.line - 1);
  const indent = line.text.slice(0, line.firstNonWhitespaceCharacterIndex);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(
    doc.uri,
    new vscode.Position(fn.line - 1, 0),
    `${indent}// ${marker}: ${reason.trim().replace(/\s+/g, " ")}\n`,
  );
  await vscode.workspace.applyEdit(edit);
  await vscode.window.showTextDocument(doc, {
    selection: new vscode.Range(fn.line - 1, 0, fn.line - 1, 0),
  });
}

export interface ActionDeps {
  project: Project;
  detail: (rel: string) => Promise<FileDetail | undefined>;
  ignored: () => string[];
  setIgnored: (list: string[]) => Promise<void>;
}

export async function runAction(
  deps: ActionDeps,
  kind: ActionKind,
  rel: string,
  fnKey?: string,
): Promise<void> {
  if (kind === "ignore" || kind === "unignore") {
    const list = new Set(deps.ignored());
    if (kind === "ignore") list.add(rel);
    else list.delete(rel);
    return deps.setIgnored([...list].sort());
  }
  const d = await deps.detail(rel);
  if (!d) return;
  const fn = d.functions.find((f) => f.key === fnKey);
  if (kind === "fixPrompt")
    return copy(
      fn ? text.functionFixPrompt(d, fn) : text.fileFixPrompt(d),
      "fix prompt",
    );
  if (kind === "chore") return copy(text.chore(d, fn), "chore");
  if (kind === "ticket")
    return deliverMarkdown(
      deps.project,
      text.ticketDraft(d),
      `${slug(d.path)}-complexity.md`,
      "Ticket draft",
    );
  if (kind === "accept") return accept(deps.project, d, fnKey);
}

export interface BatchDeps extends ActionDeps {
  changeItems: () => Promise<import("../core/insights").FileSummary[]>;
  topFix: () => Promise<import("../core/insights").FileSummary[]>;
}

export async function runBatch(
  deps: BatchDeps,
  kind: BatchKind,
): Promise<void> {
  if (kind === "fixAll")
    return copy(
      text.fixAllPrompt(
        (await deps.changeItems()).filter((s) => s.problems.length),
      ),
      "fix-all prompt",
    );
  if (kind === "prSummary")
    return copy(text.prSummary(await deps.changeItems()), "PR summary");
  if (kind === "choreList")
    return copy(text.choreList(await deps.topFix()), "chore list");
  const top = await deps.topFix();
  const drafts: string[] = [];
  for (const s of top) {
    const d = await deps.detail(s.path);
    if (d) drafts.push(text.ticketDraft(d));
  }
  if (!drafts.length)
    return void vscode.window.showInformationMessage(
      "Complexity Lens: nothing to fix right now.",
    );
  await deliverMarkdown(
    deps.project,
    drafts.join("\n\n---\n\n"),
    "complexity-tickets.md",
    `${drafts.length} ticket drafts`,
  );
}

