// complexity-lens command line: check | hook post-edit | hook stop | init | help

import * as path from "path";
import { CI_MODES, CiMode, POLICIES, PRESET_NAMES } from "../core/config";
import { Finding, isProblem } from "../core/evaluate";
import * as git from "../core/git";
import { CONFIG_FILE, Project } from "../core/project";
import { createConfigFile } from "../node/configFile";
import * as format from "./format";
import { onFinish, postEdit } from "./hook";

/** Where the CLI reads and writes; the real process in bin.ts, buffers in tests. */
export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  stdin(): Promise<string>;
}

const FORMATS = ["text", "github", "json"] as const;

const HELP = `Complexity Lens: code complexity and AI reading cost.

Usage:
  complexity-lens check [--base <ref>] [--all] [--policy ${POLICIES.join("|")}] [--format ${FORMATS.join("|")}] [--mode <ciMode>] [files...]
      Check changed files (default: since the last commit; with --base, since the branch
      forked from <ref>), all included files (--all), or the files listed.
      --policy absolute audits existing code too (the repo config's policy is ignored).
      Exit code: 0 = pass, 1 = failed (per ci.mode), 2 = usage or config error.
  complexity-lens hook post-edit     Agent hook: run after each file edit (reads JSON on stdin)
  complexity-lens hook stop          Agent hook: run when the agent tries to finish
  complexity-lens init [--preset ${PRESET_NAMES.join("|")}]
      Create ${CONFIG_FILE} with every option explained.

ci modes: ${CI_MODES.join(", ")}
`;

interface Args {
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const valued = new Set(["--base", "--format", "--mode", "--preset", "--cwd", "--policy"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (valued.has(a)) {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${a} needs a value`);
      flags.set(a, v);
    } else if (a.startsWith("--")) flags.set(a, true);
    else positional.push(a);
  }
  return { positional, flags };
}

class UsageError extends Error {}

function flag(args: Args, name: string): string | undefined {
  const v = args.flags.get(name);
  if (v === true) throw new UsageError(`${name} needs a value`);
  return v;
}

/** A flag that must be one of `allowed`. */
function choice<T extends string>(args: Args, name: string, allowed: readonly T[]): T | undefined {
  const v = flag(args, name);
  if (v !== undefined && !(allowed as readonly string[]).includes(v))
    throw new UsageError(`${name} must be one of: ${allowed.join(", ")}`);
  return v as T | undefined;
}

function openProject(args: Args, policy?: (typeof POLICIES)[number]): Project {
  const cwd = path.resolve(flag(args, "--cwd") ?? process.cwd());
  return new Project(git.repoRoot(cwd) ?? cwd, { useGit: true, policy });
}

function exitCodeFor(mode: CiMode, findings: Finding[]): number {
  const problems = findings.filter(isProblem);
  if (mode === "failOverLimit") return problems.length ? 1 : 0;
  if (mode === "failOnRegression")
    return problems.some((f) => f.status !== "over") ? 1 : 0;
  return 0;
}

/** Prints config problems; returns false when the config has errors. */
function reportConfig(project: Project, io: Io): boolean {
  for (const w of project.loaded.warnings) io.stderr(`warning: ${w}\n`);
  for (const e of project.loaded.errors) io.stderr(`config error: ${e}\n`);
  return project.loaded.errors.length === 0;
}

function checkOptions(args: Args, project: Project) {
  const base = flag(args, "--base") ?? "HEAD";
  if (!git.isSafeRef(base)) throw new UsageError(`--base: "${base}" is not a valid git ref`);
  return {
    base,
    fmt: choice(args, "--format", FORMATS) ?? "text",
    mode: choice(args, "--mode", CI_MODES) ?? project.config.ci.mode,
  };
}

function filesToCheck(args: Args, project: Project, baseRef: string): string[] {
  if (!args.positional.length) return project.files(args.flags.has("--all") ? "all" : "changed", baseRef);
  return args.positional
    .map((f) => project.relative(path.resolve(f)))
    .filter((f): f is string => f !== undefined && project.includes(f));
}

function render(fmt: (typeof FORMATS)[number], findings: Finding[], failed: boolean): string {
  if (fmt === "json") return format.json(findings);
  if (fmt === "github") return format.github(findings, failed ? "error" : "warning");
  return format.text(findings);
}

function check(args: Args, io: Io): number {
  // --policy is a one-off audit: every file is judged with it, ignoring the repo's choice.
  const project = openProject(args, choice(args, "--policy", POLICIES));
  if (!reportConfig(project, io)) return 2;
  const { base, fmt, mode } = checkOptions(args, project);
  if (mode === "off") return 0;
  const baseRef = project.baseRefFor(base);
  const findings = filesToCheck(args, project, baseRef).flatMap((f) => project.evaluate(f, baseRef).findings);
  const code = exitCodeFor(mode, findings);
  const out = render(fmt, findings, code !== 0);
  if (out) io.stdout(out + "\n");
  return code;
}

function init(args: Args, io: Io): number {
  const preset = choice(args, "--preset", PRESET_NAMES) ?? "recommended";
  try {
    io.stdout(`Created ${createConfigFile(openProject(args).root, preset)} (preset: ${preset}).\n`);
    return 0;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    io.stderr(`${CONFIG_FILE} already exists; not overwritten.\n`);
    return 2;
  }
}

async function hook(args: Args, io: Io): Promise<number> {
  const event = args.positional[1];
  if (event !== "post-edit" && event !== "stop")
    throw new UsageError('hook needs "post-edit" or "stop"');
  try {
    const raw = await io.stdin();
    const input = raw.trim() ? JSON.parse(raw) : {};
    const result = event === "post-edit" ? postEdit(input) : onFinish(input);
    if (result) io.stdout(JSON.stringify(result));
  } catch {
    // Fail open: never block the agent because of a problem in the hook itself.
  }
  return 0;
}

async function dispatch(argv: string[], io: Io): Promise<number> {
  const args = parseArgs(argv);
  const cmd = args.positional[0];
  if (!cmd || cmd === "help" || args.flags.has("--help")) {
    io.stdout(HELP);
    return 0;
  }
  if (cmd === "check")
    return check({ ...args, positional: args.positional.slice(1) }, io);
  if (cmd === "hook") return hook(args, io);
  if (cmd === "init") return init(args, io);
  throw new UsageError(`unknown command "${cmd}"`);
}

/** Runs one command and returns its exit code: 0 = pass, 1 = failed (per ci.mode), 2 = usage or config error. */
export async function run(argv: string[], io: Io): Promise<number> {
  try {
    return await dispatch(argv, io);
  } catch (e) {
    io.stderr(`complexity-lens: ${(e as Error).message}\n${e instanceof UsageError ? "Run 'complexity-lens help'.\n" : ""}`);
    return 2;
  }
}
