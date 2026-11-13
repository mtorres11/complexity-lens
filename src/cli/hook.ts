// Agent hook handlers for the PostToolUse and Stop command-hook events.
// Input arrives as JSON on stdin; the response is JSON on stdout.
// The hook "fails open": if anything goes wrong it prints nothing and exits 0, so a
// broken config or an unexpected input never blocks the agent.
//
// Each agent session keeps a small state file inside .git/complexity-lens/: the files that
// session edited, and how many times the finish check sent it back. The finish check only
// judges the session's own files, so several agents can work in the same checkout.

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
const MAX_TRACKED_FILES = 2000;

type HookInput = {
  session_id?: unknown;
  cwd?: unknown;
  tool_name?: unknown;
  tool_input?: { file_path?: unknown };
  stop_hook_active?: unknown;
};

type SessionState = { count: number; files: string[] };

export async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) {
    data += chunk;
    if (data.length > MAX_STDIN) throw new Error("hook input too large");
  }
  return data;
}

function projectFor(input: HookInput): Project {
  const cwd =
    typeof input.cwd === "string" && path.isAbsolute(input.cwd)
      ? input.cwd
      : process.cwd();
  return new Project(git.repoRoot(cwd) ?? cwd, { useGit: true });
}

const sessionId = (input: HookInput) =>
  typeof input.session_id === "string" && input.session_id
    ? input.session_id
    : "default";

function stateFile(project: Project, id: string): string | undefined {
  try {
    const dir = path.join(git.gitDir(project.root), "complexity-lens");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return path.join(
      dir,
      `session-${crypto.createHash("sha256").update(id).digest("hex").slice(0, 32)}.json`,
    );
  } catch {
    return undefined;
  }
}

function readState(file: string | undefined): SessionState {
  if (!file) return { count: 0, files: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as {
      count?: unknown;
      files?: unknown;
    };
    const count =
      typeof raw.count === "number" && raw.count >= 0 ? raw.count : 0;
    const files = Array.isArray(raw.files)
      ? raw.files.filter((f): f is string => typeof f === "string")
      : [];
    return { count, files };
  } catch {
    return { count: 0, files: [] };
  }
}

function writeState(file: string | undefined, state: SessionState): void {
  if (!file) return;
  try {
    fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 });
  } catch {
    /* best effort */
  }
}

/** The repo-relative file an edit tool touched, if it's one Complexity Lens measures. */
function editedFile(input: HookInput, project: Project): string | undefined {
  if (typeof input.tool_name !== "string" || !EDIT_TOOLS.has(input.tool_name)) return undefined;
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return undefined;
  const rel = project.relative(filePath);
  return rel && project.includes(rel) ? rel : undefined;
}

/** Adds the file to this session's list (used by the finish check). */
function remember(project: Project, input: HookInput, rel: string): void {
  const file = stateFile(project, sessionId(input));
  const state = readState(file);
  if (!state.files.includes(rel) && state.files.length < MAX_TRACKED_FILES) writeState(file, { ...state, files: [...state.files, rel] });
}

/** PostToolUse: remember the file for this session, then check it. */
export function postEdit(input: HookInput): object | undefined {
  const project = projectFor(input);
  const rel = editedFile(input, project);
  if (!rel) return undefined;
  remember(project, input, rel);
  const s = settingsFor(project.config, rel);
  if (s.hook.afterEdit === "off") return undefined;
  const problems = project.evaluate(rel).findings.filter(isProblem);
  if (!problems.length) return undefined;
  const nudge = s.hook.afterEdit === "nudge";
  const footer = nudge ? `Simplify before continuing, or add "// ${s.allowComment.marker}: <reason>" above a function if this complexity is necessary.` : "(For information.)";
  const msg = agentMessage(problems, `Complexity Lens: ${rel}`, footer);
  return nudge ? { decision: "block", reason: msg } : { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: msg } };
}

/** Problems in the session's own files, and how strict the finish check should be. */
function sessionProblems(
  project: Project,
  files: string[],
): { problems: Finding[]; blocking: boolean; maxRetries: number } {
  const problems: Finding[] = [];
  let blocking = false;
  let maxRetries = 0;
  for (const rel of files) {
    const s = settingsFor(project.config, rel);
    if (s.hook.onFinish === "off" || !project.includes(rel)) continue;
    const found = project.evaluate(rel).findings.filter(isProblem);
    if (!found.length) continue;
    problems.push(...found);
    if (s.hook.onFinish === "block") {
      blocking = true;
      maxRetries = Math.max(maxRetries, s.hook.maxRetries);
    }
  }
  return { problems, blocking, maxRetries };
}

/** Stop: before the agent finishes, check the files this session edited. */
export function onFinish(input: HookInput): object | undefined {
  const project = projectFor(input);
  if (!git.repoRoot(project.root)) return undefined;
  const file = stateFile(project, sessionId(input));
  const state = readState(file);
  if (!state.files.length) return undefined;

  const { problems, blocking, maxRetries } = sessionProblems(
    project,
    state.files,
  );
  if (!problems.length) {
    writeState(file, { ...state, count: 0 });
    return undefined;
  }
  if (blocking && state.count < maxRetries) {
    writeState(file, { ...state, count: state.count + 1 });
    return {
      decision: "block",
      reason: agentMessage(
        problems,
        `Complexity Lens: ${problems.length} problem(s) in files you changed in this session.`,
        `Please simplify these before finishing. (Retry ${state.count + 1} of ${maxRetries}; after that this is reported to the user instead.)`,
      ),
    };
  }
  writeState(file, { ...state, count: 0 });
  const footer = blocking
    ? "The agent was asked to fix these and couldn't; please review them."
    : "";
  return {
    systemMessage: agentMessage(
      problems,
      `Complexity Lens: ${problems.length} problem(s) left in files changed in this session.`,
      footer,
    ).trimEnd(),
  };
}
