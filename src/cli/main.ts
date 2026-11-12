// complexity-lens command line: check | hook post-edit | hook stop | init | help

import * as fs from "fs";
import * as path from "path";
import { CiMode, Policy, PresetName } from "../core/config";
import { Finding, isProblem } from "../core/evaluate";
import * as git from "../core/git";
import { CONFIG_FILE, Project } from "../core/project";
import { configTemplate } from "../core/template";
import * as format from "./format";
import { onFinish, postEdit, readStdin } from "./hook";

const HELP = `Complexity Lens: code complexity and AI reading cost.

Usage:
  complexity-lens check [--base <ref>] [--all] [--policy ratchet|absolute] [--format text|github|json] [--mode <ciMode>] [files...]
      Check changed files (default: since the last commit; with --base, since the branch
      forked from <ref>), all included files (--all), or the files listed.
      --policy absolute audits existing code too (the repo config's policy is ignored).
      Exit code: 0 = pass, 1 = failed (per ci.mode), 2 = usage or config error.
  complexity-lens hook post-edit     Agent hook: run after each file edit (reads JSON on stdin)
  complexity-lens hook stop          Agent hook: run when the agent tries to finish
  complexity-lens init [--preset relaxed|recommended|strict]
      Create ${CONFIG_FILE} with every option explained.

ci modes: off, warn, failOnRegression, failOverLimit
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

function flag(
  args: Args,
  name: string,
  allowed?: readonly string[],
): string | undefined {
  const v = args.flags.get(name);
  if (v === undefined) return undefined;
  if (v === true) throw new UsageError(`${name} needs a value`);
  if (allowed && !allowed.includes(v))
    throw new UsageError(`${name} must be one of: ${allowed.join(", ")}`);
  return v;
}

function openProject(args: Args): Project {
  const cwd = path.resolve(flag(args, "--cwd") ?? process.cwd());
  return new Project(git.repoRoot(cwd) ?? cwd);
}

function exitCodeFor(mode: CiMode, findings: Finding[]): number {
  const problems = findings.filter(isProblem);
  if (mode === "failOverLimit") return problems.length ? 1 : 0;
  if (mode === "failOnRegression")
    return problems.some((f) => f.status !== "over") ? 1 : 0;
  return 0;
}

/** Prints config problems; returns false when the config has errors. */
function reportConfig(project: Project): boolean {
  for (const w of project.loaded.warnings) process.stderr.write(`warning: ${w}\n`);
  for (const e of project.loaded.errors) process.stderr.write(`config error: ${e}\n`);
  return project.loaded.errors.length === 0;
}

function checkOptions(args: Args, project: Project) {
  const base = flag(args, "--base") ?? "HEAD";
  if (!git.isSafeRef(base)) throw new UsageError(`--base: "${base}" is not a valid git ref`);
  const policy = flag(args, "--policy", ["ratchet", "absolute"]) as Policy | undefined;
  if (policy) {
    // One-off audit: judge everything with this policy, ignoring the repo's choice.
    project.config.policy = policy;
    for (const o of project.config.overrides) o.policy = policy;
  }
  return {
    base,
    fmt: flag(args, "--format", ["text", "github", "json"]) ?? "text",
    mode: (flag(args, "--mode", ["off", "warn", "failOnRegression", "failOverLimit"]) ?? project.config.ci.mode) as CiMode,
  };
}

function filesToCheck(args: Args, project: Project, base: string): string[] {
  if (!args.positional.length) return project.files(args.flags.has("--all") ? "all" : "changed", base);
  return args.positional
    .map((f) => project.relative(path.resolve(f)))
    .filter((f): f is string => f !== undefined && project.includes(f));
}

function render(fmt: string, findings: Finding[], failed: boolean): string {
  if (fmt === "json") return format.json(findings);
  if (fmt === "github") return format.github(findings, failed ? "error" : "warning");
  return format.text(findings);
}

function check(args: Args): number {
  const project = openProject(args);
  if (!reportConfig(project)) return 2;
  const { base, fmt, mode } = checkOptions(args, project);
  if (mode === "off") return 0;
  const baseRef = base === "HEAD" ? "HEAD" : git.mergeBase(project.root, base);
  const findings = filesToCheck(args, project, base).flatMap((f) => project.evaluate(f, baseRef).findings);
  const code = exitCodeFor(mode, findings);
  const out = render(fmt, findings, code !== 0);
  if (out) process.stdout.write(out + "\n");
  return code;
}

function init(args: Args): number {
  const preset = (flag(args, "--preset", [
    "relaxed",
    "recommended",
    "strict",
  ]) ?? "recommended") as PresetName;
  const project = openProject(args);
  const file = path.join(project.root, CONFIG_FILE);
  if (fs.existsSync(file)) {
    process.stderr.write(`${CONFIG_FILE} already exists; not overwritten.\n`);
    return 2;
  }
  fs.writeFileSync(file, configTemplate(preset), { flag: "wx" });
  process.stdout.write(`Created ${file} (preset: ${preset}).\n`);
  return 0;
}

async function hook(args: Args): Promise<number> {
  const event = args.positional[1];
  if (event !== "post-edit" && event !== "stop")
    throw new UsageError('hook needs "post-edit" or "stop"');
  try {
    const raw = await readStdin();
    const input = raw.trim() ? JSON.parse(raw) : {};
    const result = event === "post-edit" ? postEdit(input) : onFinish(input);
    if (result) process.stdout.write(JSON.stringify(result));
  } catch {
    // Fail open: never block the agent because of a problem in the hook itself.
  }
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const cmd = args.positional[0];
  if (!cmd || cmd === "help" || args.flags.has("--help")) {
    process.stdout.write(HELP);
    return 0;
  }
  if (cmd === "check")
    return check({ ...args, positional: args.positional.slice(1) });
  if (cmd === "hook") return hook(args);
  if (cmd === "init") return init(args);
  throw new UsageError(`unknown command "${cmd}"`);
}

// Set exitCode instead of calling process.exit(), so large outputs to a pipe are fully flushed.
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    process.stderr.write(
      `complexity-lens: ${(e as Error).message}\n${e instanceof UsageError ? "Run 'complexity-lens help'.\n" : ""}`,
    );
    process.exitCode = 2;
  },
);
