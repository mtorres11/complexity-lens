// "Install Agent Hook": copies the CLI to ~/.complexity-lens/cli.js and adds two hook entries
// (PostToolUse and Stop) to the agent settings file the user chooses, after showing exactly what changes.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

const CLI_MARKER = "complexity-lens-cli";
export const shimDir = () => path.join(os.homedir(), ".complexity-lens");
export const shimPath = () => path.join(shimDir(), "cli.js");

// Guarded so teammates without the extension get a silent no-op instead of an error.
const command = (event: "post-edit" | "stop") =>
  `[ -f "$HOME/.complexity-lens/cli.js" ] && node "$HOME/.complexity-lens/cli.js" hook ${event} || true`;

type HookEntry = {
  matcher?: string;
  hooks: { type: "command"; command: string; timeout: number }[];
};

export const HOOKS: Record<"PostToolUse" | "Stop", HookEntry> = {
  PostToolUse: {
    matcher: "Write|Edit|MultiEdit",
    hooks: [{ type: "command", command: command("post-edit"), timeout: 30 }],
  },
  Stop: { hooks: [{ type: "command", command: command("stop"), timeout: 60 }] },
};

/** Keeps ~/.complexity-lens/cli.js in sync with the installed extension (only our own file). */
export function refreshShim(
  extensionPath: string,
  createIfMissing: boolean,
): void {
  const target = shimPath();
  const exists = fs.existsSync(target);
  if (!exists && !createIfMissing) return;
  if (exists) {
    const head = fs.readFileSync(target, "utf8").slice(0, 200);
    if (!head.includes(CLI_MARKER))
      throw new Error(
        `${target} exists and was not created by Complexity Lens; not overwriting it.`,
      );
  }
  const source = fs.readFileSync(path.join(extensionPath, "dist", "cli.js"));
  if (exists && fs.readFileSync(target).equals(source)) return;
  fs.mkdirSync(shimDir(), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, source, { mode: 0o644 });
  fs.renameSync(tmp, target);
}

function hasCommand(list: unknown, cmd: string): boolean {
  return (
    Array.isArray(list) &&
    list.some(
      (e) =>
        Array.isArray(e?.hooks) &&
        e.hooks.some((h: { command?: unknown }) => h?.command === cmd),
    )
  );
}

export function mergeHooks(settings: Record<string, unknown>): {
  merged: Record<string, unknown>;
  added: string[];
} {
  const merged = structuredClone(settings);
  const hooks = (
    typeof merged.hooks === "object" && merged.hooks !== null
      ? merged.hooks
      : {}
  ) as Record<string, unknown>;
  const added: string[] = [];
  for (const [event, entry] of Object.entries(HOOKS)) {
    const list = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    if (hasCommand(list, entry.hooks[0].command)) continue;
    hooks[event] = [...list, entry];
    added.push(event);
  }
  merged.hooks = hooks;
  return { merged, added };
}

/** A repo-relative .json path that stays inside the repo, or an error message. */
export function validateSettingsPath(value: string): string | undefined {
  const v = value.trim().replace(/\\/g, "/");
  if (!v) return "Enter the path of your agent's hook settings file, relative to the repo root";
  if (path.isAbsolute(v) || v.split("/").includes("..")) return "Use a path inside the repo (no leading / and no ..)";
  if (!/\.json$/i.test(v)) return "The settings file must be a .json file";
  return undefined;
}

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
