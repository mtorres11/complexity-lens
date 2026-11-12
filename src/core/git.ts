// Read-only git access. Every call:
//  - runs `git` directly (execFile, never a shell) with arguments as an array,
//  - disables repo-configurable hooks into command execution (fsmonitor, hooks path,
//    external diff, text conversion, pagers) so a cloned repository cannot make
//    Complexity Lens run its commands,
//  - avoids optional locks, so it never writes to the repository,
//  - has a timeout and an output cap.

import { execFileSync } from "child_process";

const SAFE_FLAGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "diff.external=",
  "-c",
  "core.pager=cat",
  "--no-pager",
  "--no-optional-locks",
];

const REF_RE = /^(?!-)[A-Za-z0-9._\/@~^{}-]{1,200}$/;

export class GitError extends Error {}

export function isSafeRef(ref: string): boolean {
  return REF_RE.test(ref) && !ref.includes("..");
}

function git(
  cwd: string,
  args: string[],
  maxBuffer = 64 * 1024 * 1024,
): string {
  try {
    return execFileSync("git", [...SAFE_FLAGS, ...args], {
      cwd,
      encoding: "utf8",
      maxBuffer,
      timeout: 30_000,
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
      },
      windowsHide: true,
    });
  } catch (e) {
    throw new GitError((e as Error).message.split("\n")[0]);
  }
}

export function repoRoot(cwd: string): string | undefined {
  try {
    return git(cwd, ["rev-parse", "--show-toplevel"]).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function gitDir(root: string): string {
  return git(root, ["rev-parse", "--absolute-git-dir"]).trim();
}

export function hasCommit(root: string, ref: string): boolean {
  if (!isSafeRef(ref)) return false;
  try {
    git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** Content of a file at a ref, or undefined if it does not exist there. No filters are applied. */
export function fileAt(
  root: string,
  ref: string,
  relPath: string,
): string | undefined {
  if (!isSafeRef(ref)) throw new GitError(`Unsafe git ref: ${ref}`);
  try {
    return git(
      root,
      ["cat-file", "blob", `${ref}:${relPath}`],
      8 * 1024 * 1024,
    );
  } catch {
    return undefined;
  }
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Tracked and untracked (not ignored) files. */
export function listFiles(root: string): string[] {
  return lines(
    git(root, [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ]).replace(/\0/g, "\n"),
  );
}

/**
 * Files changed relative to `base`.
 * - base "HEAD": uncommitted changes plus new untracked files (what an agent just touched).
 * - any other ref: changes on this branch since it forked from `base` (merge base), plus
 *   uncommitted changes, which is what a pull request contains.
 */
export function changedFiles(root: string, base = "HEAD"): string[] {
  if (!isSafeRef(base)) throw new GitError(`Unsafe git ref: ${base}`);
  const out = new Set<string>();
  if (hasCommit(root, "HEAD")) {
    const range = base === "HEAD" ? ["HEAD"] : [mergeBase(root, base)];
    for (const f of lines(
      git(root, [
        "diff",
        "--name-only",
        "--diff-filter=ACMR",
        "--no-renames",
        ...range,
        "--",
      ]),
    ))
      out.add(f);
  }
  for (const f of lines(
    git(root, ["ls-files", "--others", "--exclude-standard"]),
  ))
    out.add(f);
  return [...out];
}

export function mergeBase(root: string, base: string): string {
  if (!isSafeRef(base)) throw new GitError(`Unsafe git ref: ${base}`);
  return git(root, ["merge-base", base, "HEAD"]).trim();
}

/** How many commits touched each file in the last `days` days. */
export function commitCounts(root: string, days: number): Map<string, number> {
  const counts = new Map<string, number>();
  if (!hasCommit(root, "HEAD")) return counts;
  const out = git(root, [
    "log",
    `--since=${Math.max(1, Math.floor(days))}.days`,
    "--name-only",
    "--format=",
    "--no-renames",
  ]);
  for (const f of lines(out)) counts.set(f, (counts.get(f) ?? 0) + 1);
  return counts;
}
