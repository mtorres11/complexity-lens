// Complexity Lens VS Code extension entry point.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { PresetName } from "./core/config";
import * as git from "./core/git";
import { CONFIG_FILE, Project } from "./core/project";
import { configTemplate } from "./core/template";
import { installHook, refreshShim } from "./vscode/hookInstaller";
import { ComplexityCodeLens, explain, LANGUAGES } from "./vscode/lens";
import { aboutFrom } from "./vscode/about";
import { Sidebar } from "./vscode/sidebar";
import { StatusBar } from "./vscode/statusBar";

class Workspace {
  private projects = new Map<string, Project>();

  /** Repo root for a file: its git top level (when trusted), else its workspace folder. */
  private rootFor(uri: vscode.Uri): string | undefined {
    const folder =
      vscode.workspace.getWorkspaceFolder(uri) ??
      vscode.workspace.workspaceFolders?.[0];
    if (!folder || folder.uri.scheme !== "file") return undefined;
    if (!vscode.workspace.isTrusted) return folder.uri.fsPath;
    return (
      git.repoRoot(path.dirname(uri.fsPath)) ??
      git.repoRoot(folder.uri.fsPath) ??
      folder.uri.fsPath
    );
  }

  projectFor(uri: vscode.Uri | undefined): Project | undefined {
    const target = uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!target) return undefined;
    const root = this.rootFor(target);
    if (!root) return undefined;
    let p = this.projects.get(root);
    if (!p) {
      p = new Project(root, { useGit: vscode.workspace.isTrusted });
      this.projects.set(root, p);
    }
    return p;
  }

  reset(): void {
    this.projects.clear();
  }
}

type Ui = { sidebar: Sidebar; lens: ComplexityCodeLens; status: StatusBar };

function createUi(context: vscode.ExtensionContext, ws: Workspace): Ui {
  const activeUri = () => vscode.window.activeTextEditor?.document.uri;
  const current = () => {
    const project = ws.projectFor(activeUri());
    const uri = activeUri();
    return {
      project,
      rel: uri && project?.relative(uri.fsPath),
      errors: project ? [...project.loaded.errors, ...project.loaded.warnings] : [],
      trusted: vscode.workspace.isTrusted,
    };
  };
  return {
    sidebar: new Sidebar(context, current, aboutFrom(context.extension.packageJSON)),
    lens: new ComplexityCodeLens((u) => ws.projectFor(u)),
    status: new StatusBar((u) => ws.projectFor(u)),
  };
}

function registerListeners(context: vscode.ExtensionContext, ui: Ui, refreshAll: (reload?: boolean) => void): void {
  const watcher = vscode.workspace.createFileSystemWatcher(`**/${CONFIG_FILE}`);
  context.subscriptions.push(
    watcher,
    watcher.onDidChange(() => refreshAll(true)),
    watcher.onDidCreate(() => refreshAll(true)),
    watcher.onDidDelete(() => refreshAll(true)),
    vscode.workspace.onDidSaveTextDocument(() => refreshAll()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => refreshAll(true)),
    vscode.window.onDidChangeActiveTextEditor((e) => {
      ui.status.update(e);
      ui.sidebar.refreshSoon(150);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("complexityLens") && refreshAll()),
  );
}

function registerCommands(context: vscode.ExtensionContext, ws: Workspace, refreshAll: (reload?: boolean) => void): void {
  const activeProject = () => ws.projectFor(vscode.window.activeTextEditor?.document.uri);
  const reg = (id: string, fn: (...args: never[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg("complexityLens.refresh", () => refreshAll(true));
  reg("complexityLens.explain", explain);
  reg("complexityLens.focus", () => vscode.commands.executeCommand("complexityLens.view.focus"));
  reg("complexityLens.openSettings", () => vscode.commands.executeCommand("workbench.action.openSettings", "@ext:mtorres11.complexity-lens"));
  reg("complexityLens.openConfig", () => openOrCreateConfig(activeProject()));
  reg("complexityLens.installHook", async () => {
    const project = activeProject();
    if (!project) return void vscode.window.showWarningMessage("Complexity Lens: open a folder first.");
    try {
      await installHook(project.root, context.extensionPath);
    } catch (e) {
      vscode.window.showErrorMessage(`Complexity Lens: ${(e as Error).message}`);
    }
  });
}

export function activate(context: vscode.ExtensionContext): void {
  const ws = new Workspace();
  const ui = createUi(context, ws);
  const refreshAll = (reload = false) => {
    if (reload) ws.reset();
    ui.lens.refresh();
    ui.status.update(vscode.window.activeTextEditor);
    ui.sidebar.refreshSoon(400, reload);
  };
  // Keep ~/.complexity-lens/cli.js current if the hook was installed before (never creates it).
  try {
    refreshShim(context.extensionPath, false);
  } catch {
    /* a foreign file is left untouched */
  }
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("complexityLens.view", ui.sidebar, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.languages.registerCodeLensProvider(LANGUAGES.map((language) => ({ language, scheme: "file" })), ui.lens),
    ui.status,
  );
  registerListeners(context, ui, refreshAll);
  registerCommands(context, ws, refreshAll);
  ui.status.update(vscode.window.activeTextEditor);
}

async function openOrCreateConfig(project: Project | undefined): Promise<void> {
  if (!project)
    return void vscode.window.showWarningMessage(
      "Complexity Lens: open a folder first.",
    );
  const file = path.join(project.root, CONFIG_FILE);
  if (!fs.existsSync(file)) {
    const pick = await vscode.window.showQuickPick(
      [
        {
          label: "recommended",
          description:
            "Balanced: nudge after edits, block on finish (ratchet), CI warns",
        },
        {
          label: "relaxed",
          description:
            "Inform only, higher limits: try it on a big existing codebase",
        },
        {
          label: "strict",
          description:
            "Lower limits, absolute policy, CI fails: for new projects",
        },
      ],
      { title: `Create ${CONFIG_FILE} with which preset?` },
    );
    if (!pick) return;
    fs.writeFileSync(file, configTemplate(pick.label as PresetName), {
      flag: "wx",
    });
  }
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(file),
  );
}

export function deactivate(): void {
  /* nothing to clean up */
}
