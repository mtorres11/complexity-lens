// Agent hook handlers for the PostToolUse and Stop command-hook events.
// Input arrives as JSON on stdin; the response is JSON on stdout.
// The hook "fails open": if anything goes wrong it prints nothing and exits 0, so a
// broken config or an unexpected input never blocks the agent.

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Finding, isProblem } from "../core/evaluate";
import { settingsFor } from "../core/config";
import * as git from "../core/git";
import { Project } from "../core/project";
import { agentMessage } from "./format";

const EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const MAX_STDIN = 1024 * 1024;

type HookInput = {
  session_id?: unknown;
  cwd?: unknown;
  tool_name?: unknown;
  tool_input?: { file_path?: unknown };
  stop_hook_active?: unknown;
};

export async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) {
    data += chunk;
    if (data.length > MAX_STDIN) throw new Error("hook input too large");
  }
  return data;
}

function projectFor(input: HookInput): Project | undefined {
  const cwd =
    typeof input.cwd === "string" && path.isAbsolute(input.cwd)
      ? input.cwd
      : process.cwd();
  const root = git.repoRoot(cwd) ?? cwd;
  return new Project(root, { useGit: true });
}

/** PostToolUse: check the file the agent just edited. */
export function postEdit(input: HookInput): object | undefined {
  if (typeof input.tool_name !== "string" || !EDIT_TOOLS.has(input.tool_name))
    return undefined;
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== "string" || !path.isAbsolute(filePath))
    return undefined;
  const project = projectFor(input);
  if (!project) return undefined;
  const rel = project.relative(filePath);
  if (!rel || !project.includes(rel)) return undefined;

  const mode = settingsFor(project.config, rel).hook.afterEdit;
  if (mode === "off") return undefined;
  const { findings } = project.evaluate(rel);
  const problems = findings.filter(isProblem);
  if (!problems.length) return undefined;

  const msg = agentMessage(
    problems,
    `Complexity Lens: ${rel}`,
    mode === "nudge"
      ? `Simplify before continuing, or add "// ${settingsFor(project.config, rel).allowComment.marker}: <reason>" above a function if this complexity is necessary.`
      : "(For information.)",
  );
  if (mode === "nudge") return { decision: "block", reason: msg };
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: msg,
    },
  };
}

function stateFile(project: Project, sessionId: string): string | undefined {
  try {
    const dir = path.join(git.gitDir(project.root), "complexity-lens");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id = crypto
      .createHash("sha256")
      .update(sessionId)
      .digest("hex")
      .slice(0, 32);
    return path.join(dir, `stop-${id}.json`);
  } catch {
    return undefined;
  }
}

function readCount(file: string | undefined): number {
  if (!file) return 0;
  try {
    const n = (JSON.parse(fs.readFileSync(file, "utf8")) as { count?: unknown })
      .count;
    return typeof n === "number" && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeCount(file: string | undefined, count: number): void {
  if (!file) return;
  try {
    if (count === 0) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, JSON.stringify({ count }), { mode: 0o600 });
  } catch {
    /* best effort */
  }
}

/** Stop: before the agent finishes, check every file changed since the last commit. */
export function onFinish(input: HookInput): object | undefined {
  const project = projectFor(input);
  if (!project || !git.repoRoot(project.root)) return undefined;
  const sessionId =
    typeof input.session_id === "string" ? input.session_id : "default";
  const state = stateFile(project, sessionId);

  const problems: Finding[] = [];
  let blocking = false;
  let maxRetries = 0;
  for (const rel of project.files("changed")) {
    const s = settingsFor(project.config, rel);
    if (s.hook.onFinish === "off") continue;
    const found = project.evaluate(rel).findings.filter(isProblem);
    if (!found.length) continue;
    problems.push(...found);
    if (s.hook.onFinish === "block") {
      blocking = true;
      maxRetries = Math.max(maxRetries, s.hook.maxRetries);
    }
  }
  if (!problems.length) {
    writeCount(state, 0);
    return undefined;
  }

  const retries = readCount(state);
  if (blocking && retries < maxRetries) {
    writeCount(state, retries + 1);
    return {
      decision: "block",
      reason: agentMessage(
        problems,
        `Complexity Lens: ${problems.length} problem(s) in files changed since the last commit.`,
        `Please simplify these before finishing. (Retry ${retries + 1} of ${maxRetries}; after that this is reported to the user instead.)`,
      ),
    };
  }
  writeCount(state, 0);
  return {
    systemMessage: agentMessage(
      problems,
      `Complexity Lens: ${problems.length} problem(s) left in changed files.`,
      blocking
        ? "The agent was asked to fix these and couldn't; please review them."
        : "",
    ).trimEnd(),
  };
}
