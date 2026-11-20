// Runs Claude Code headless for "Preview fix": the prompt goes in on stdin, the answer comes back
// as text. Only read-only tools are available, so it can look at the repo but never change it.

import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const TIMEOUT_MS = 5 * 60_000;
const ARGS = ["-p", "--output-format", "text", "--tools", "Read,Grep,Glob", "--permission-mode", "dontAsk"];

/** The newest `claude` bundled with the Claude Code VS Code extension, if it is installed. */
function bundledClaude(home = os.homedir()): string | undefined {
  const dir = path.join(home, ".vscode", "extensions");
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.startsWith("anthropic.claude-code-"));
  } catch {
    return undefined;
  }
  const bins = names
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((n) => path.join(dir, n, "resources", "native-binary", process.platform === "win32" ? "claude.exe" : "claude"));
  return bins.find((b) => fs.existsSync(b));
}

/** The command to run: the setting, else `claude` on the PATH, else the bundled one. */
export function claudeCommand(setting: string, onPath: (cmd: string) => boolean, home?: string): string | undefined {
  if (setting.trim()) return setting.trim();
  return onPath("claude") ? "claude" : bundledClaude(home);
}

const isOnPath = (cmd: string): boolean =>
  (process.env.PATH ?? "").split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, process.platform === "win32" ? `${cmd}.exe` : cmd)));

/** Claude's answer to `prompt`, run in the repo folder. Rejects with a message the user can act on. */
export function askClaude(prompt: string, cwd: string, setting: string, run: typeof execFile = execFile): Promise<string> {
  const cmd = claudeCommand(setting, isOnPath);
  if (!cmd) return Promise.reject(new Error('Claude Code was not found. Install it, or set "complexityLens.claudePath" to the claude command.'));
  return new Promise((resolve, reject) => {
    const child = run(cmd, ARGS, { cwd, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr).trim().split("\n").slice(-3).join(" ") || err.message));
      else resolve(String(stdout));
    });
    child.stdin?.end(prompt);
  });
}
