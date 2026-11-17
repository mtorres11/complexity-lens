// "Install Agent Hook": copies the CLI to ~/.complexity-lens/cli.js and adds two hook entries
// (PostToolUse and Stop) to the agent settings file the user chooses, after showing exactly what changes.

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { HOOKS, mergeHooks, refreshShim, validateSettingsPath } from "../node/hookSetup";

/** Which settings file to change: the personal setting, or ask (and optionally remember). */
async function resolveTarget(root: string): Promise<{ file: string; name: string } | undefined> {
  const cfg = vscode.workspace.getConfiguration("complexityLens");
  let rel = (cfg.get<string>("hookSettingsFile") ?? "").trim();
  if (!rel || validateSettingsPath(rel)) {
    const input = await vscode.window.showInputBox({
      title: "Complexity Lens: agent hook settings file",
      prompt: "Path of your agent's hook settings file, relative to the repo root. It must use the PostToolUse/Stop hook format.",
      placeHolder: "path/to/agent-settings.json",
      ignoreFocusOut: true,
      validateInput: validateSettingsPath,
    });
    if (!input) return undefined;
    rel = input.trim().replace(/\\/g, "/");
    const remember = await vscode.window.showQuickPick(["Remember for all repos", "Only this time"], { title: "Use this path next time?" });
    if (remember === "Remember for all repos") await cfg.update("hookSettingsFile", rel, vscode.ConfigurationTarget.Global);
  }
  const file = path.resolve(root, rel);
  if (path.relative(root, file).startsWith("..")) return undefined;
  return { file, name: rel };
}

/** Existing settings, {} if the file doesn't exist, or undefined if it isn't valid JSON. */
function readSettings(file: string): Record<string, unknown> | undefined {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function confirm(name: string, added: string[]): Promise<boolean> {
  const preview = JSON.stringify(Object.fromEntries(added.map((e) => [e, [HOOKS[e as keyof typeof HOOKS]]])), null, 2);
  const ok = await vscode.window.showWarningMessage(
    `Add the Complexity Lens agent hook to ${name}?`,
    {
      modal: true,
      detail:
        `It also copies the checker to ~/.complexity-lens/cli.js. Hooks added under "hooks":\n\n${preview}\n\n` +
        "The hook only reads files and git history; it never sends anything over the network.",
    },
    "Install",
  );
  return ok === "Install";
}

export async function installHook(root: string, extensionPath: string): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage("Complexity Lens: trust this workspace first (installing the hook is disabled in Restricted Mode).");
    return;
  }
  const target = await resolveTarget(root);
  if (!target) return;
  const current = readSettings(target.file);
  if (!current) {
    vscode.window.showErrorMessage(`Complexity Lens: ${target.file} is not a valid JSON object; fix it first (nothing was changed).`);
    return;
  }
  const { merged, added } = mergeHooks(current);
  if (!added.length) {
    refreshShim(extensionPath, true);
    vscode.window.showInformationMessage("Complexity Lens: the agent hook is already installed.");
    return;
  }
  if (!(await confirm(target.name, added))) return;
  refreshShim(extensionPath, true);
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  fs.writeFileSync(target.file, JSON.stringify(merged, null, 2) + "\n");
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(target.file), { preview: true });
  vscode.window.showInformationMessage(`Complexity Lens: agent hook installed in ${target.name}. New agent sessions in this repo will use it.`);
}
