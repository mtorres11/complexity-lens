// The sidebar webview view: serves the panel page and connects it to the panel controller.
// All data shown comes from the controller; the page only sends back small requests.

import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { Current, PanelController } from "../app/panel";
import type { HostWording } from "../shared/protocol";
import type { About } from "./about";
import { createHost } from "./host";

const WORDING: HostWording = {
  untrusted: "Restricted Mode: git features (changes, churn, comparisons) are off.",
  trustFirst: "Trust the workspace first",
  truncated: "Only the first files were analysed (see complexityLens.maxFiles).",
};

export class Sidebar implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private readonly panel: PanelController;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    current: () => Current,
    about: About,
  ) {
    const host = createHost({ ctx, view: () => this.view, root: () => current().project?.root, repoUrl: about.repoUrl });
    this.panel = new PanelController(host, current, {
      about: { author: about.author, version: about.version, hasRepo: !!about.repoUrl },
      wording: WORDING,
    });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, "media");
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = html(view.webview, media);
    view.webview.onDidReceiveMessage((m: unknown) => void this.panel.onMessage(m));
    view.onDidChangeVisibility(() => view.visible && this.panel.refreshSoon(0));
  }

  refreshSoon(delayMs = 400, invalidate = false): void {
    this.panel.refreshSoon(delayMs, invalidate);
  }
}

function html(webview: vscode.Webview, media: vscode.Uri): string {
  const nonce = randomBytes(24).toString("base64url");
  const css = webview.asWebviewUri(vscode.Uri.joinPath(media, "main.css"));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(media, "dist", "webview.js"));
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}"><title>Complexity Lens</title></head>
<body><div id="app"></div><script nonce="${nonce}" src="${js}"></script></body></html>`;
}
