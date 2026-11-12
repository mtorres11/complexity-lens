// The sidebar webview. All data shown comes from the extension; the webview only sends
// back simple, validated requests (change scope/sort, open a file at a line).

import { randomBytes } from "crypto";
import * as vscode from "vscode";
import type { Project } from "../core/project";
import { buildReport, Report, Scope, Sort } from "./report";

const SCOPES: Scope[] = ["changed", "repo", "current"];
const SORTS: Sort[] = ["aiCost", "complexity", "hotspot", "name"];

export class Sidebar implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private report?: Report;
  private generation = 0;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly current: () => {
      project?: Project;
      rel?: string;
      errors: string[];
      trusted: boolean;
    },
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = this.html(view.webview, media);
    view.webview.onDidReceiveMessage((m) => this.onMessage(m));
    view.onDidChangeVisibility(() => view.visible && this.refreshSoon(0));
  }

  /** Debounced refresh (e.g. after saves). */
  refreshSoon(delayMs = 400): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), delayMs);
  }

  private settings() {
    const c = vscode.workspace.getConfiguration("complexityLens");
    const scope = c.get<string>("scope", "changed");
    const sort = c.get<string>("sort", "aiCost");
    return {
      scope: (SCOPES as string[]).includes(scope)
        ? (scope as Scope)
        : "changed",
      sort: (SORTS as string[]).includes(sort) ? (sort as Sort) : "aiCost",
      maxFiles: Math.min(20000, Math.max(100, c.get<number>("maxFiles", 3000))),
    };
  }

  async refresh(): Promise<void> {
    if (!this.view?.visible) return;
    const gen = ++this.generation;
    const { project, rel, errors, trusted } = this.current();
    const s = this.settings();
    const base = {
      type: "update",
      scope: s.scope,
      sort: s.sort,
      configErrors: errors,
      trusted,
    };
    if (!project) {
      void this.view.webview.postMessage({
        ...base,
        empty: "Open a folder to see its complexity.",
      });
      return;
    }
    void this.view.webview.postMessage({ ...base, loading: true });
    try {
      const report = await buildReport(project, {
        scope: s.scope,
        sort: s.sort,
        maxFiles: s.maxFiles,
        currentFile: rel,
        onProgress: (done, total) => {
          if (gen === this.generation) void this.view?.webview.postMessage({ type: "progress", done, total });
        },
        isCancelled: () => gen !== this.generation,
      });
      if (!report || gen !== this.generation) return;
      this.report = report;
      void this.view.webview.postMessage({ ...base, report });
    } catch (e) {
      if (gen === this.generation)
        void this.view.webview.postMessage({
          ...base,
          error: (e as Error).message,
        });
    }
  }

  private async onMessage(m: {
    type?: unknown;
    value?: unknown;
    path?: unknown;
    line?: unknown;
  }): Promise<void> {
    const c = vscode.workspace.getConfiguration("complexityLens");
    switch (m.type) {
      case "ready":
      case "refresh":
        return this.refresh();
      case "scope":
        if ((SCOPES as unknown[]).includes(m.value))
          await c.update("scope", m.value, vscode.ConfigurationTarget.Global);
        return;
      case "sort":
        if ((SORTS as unknown[]).includes(m.value))
          await c.update("sort", m.value, vscode.ConfigurationTarget.Global);
        return;
      case "open":
        return this.open(m.path, m.line);
      case "openConfig":
        return void vscode.commands.executeCommand("complexityLens.openConfig");
      case "installHook":
        return void vscode.commands.executeCommand(
          "complexityLens.installHook",
        );
    }
  }

  /** Opens a file from the current report only; never an arbitrary path from the webview. */
  private async open(p: unknown, line: unknown): Promise<void> {
    const { project } = this.current();
    const row = this.report?.rows.find((r) => r.path === p);
    const abs = row && project?.absolute(row.path);
    if (!abs) return;
    const n =
      typeof line === "number" && Number.isInteger(line) && line > 0
        ? line - 1
        : 0;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
    await vscode.window.showTextDocument(doc, {
      selection: new vscode.Range(n, 0, n, 0),
    });
  }

  private html(webview: vscode.Webview, media: vscode.Uri): string {
    const nonce = randomBytes(24).toString("base64url");
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, "main.css"));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, "main.js"));
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}"><title>Complexity Lens</title></head>
<body><div id="app"></div><script nonce="${nonce}" src="${js}"></script></body></html>`;
  }
}
