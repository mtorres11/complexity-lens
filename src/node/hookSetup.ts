// Agent hook setup shared by every host: the hook entries, merging them into a settings file,
// validating the settings path, and keeping the CLI copy in ~/.complexity-lens current.

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const CLI_MARKER = "complexity-lens-cli";
/** The CLI copy lives at ~/.complexity-lens/cli.js. */
const SHIM_DIR = ".complexity-lens";
const SHIM_FILE = "cli.js";
export const shimDir = () => path.join(os.homedir(), SHIM_DIR);
export const shimPath = () => path.join(shimDir(), SHIM_FILE);

// The same file through $HOME, so the settings work for every teammate. Guarded so teammates
// without the extension get a silent no-op instead of an error.
const SHELL_SHIM = `"$HOME/${SHIM_DIR}/${SHIM_FILE}"`;
const command = (event: "post-edit" | "stop") => `[ -f ${SHELL_SHIM} ] && node ${SHELL_SHIM} hook ${event} || true`;

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
