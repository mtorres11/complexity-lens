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

class GitError extends Error {}

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

/** Full commit id a ref points at, or undefined when it does not resolve (or there are no commits). */
export function resolveCommit(root: string, ref: string): string | undefined {
  if (!isSafeRef(ref)) return undefined;
  try {
    return git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Every file of a commit with its blob id, from one `git ls-tree` call. */
export function treeBlobs(root: string, commit: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!/^[0-9a-f]{40,64}$/.test(commit)) return out;
  for (const rec of git(root, ["ls-tree", "-r", "-z", "--full-tree", commit]).split("\0")) {
    const tab = rec.indexOf("\t");
    const [, type, blob] = rec.slice(0, tab).split(" ");
    if (tab > 0 && type === "blob") out.set(rec.slice(tab + 1), blob);
  }
  return out;
}

/** Content of a blob by id. No filters are applied. */
export function blobText(root: string, blob: string): string | undefined {
  if (!/^[0-9a-f]{40,64}$/.test(blob)) return undefined;
  try {
    return git(root, ["cat-file", "blob", blob], 8 * 1024 * 1024);
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

/**
 * Raw `git log --numstat` for the last `days` days: a header line per commit
 * ("\x01<unix time>\t<author email>") followed by "added\tdeleted\tpath" lines.
 */
export function logNumstat(root: string, days: number): string {
  if (!hasCommit(root, "HEAD")) return "";
  return git(root, ["log", `--since=${Math.max(1, Math.floor(days))}.days`, "--numstat", "--format=%x01%at%x09%aE", "--no-renames"]);
}

/** Local and remote branch names (for the "Compared with" list), capped. */
export function listBranches(root: string, max = 200): string[] {
  if (!hasCommit(root, "HEAD")) return [];
  const out = git(root, ["for-each-ref", "--format=%(refname:short)", `--count=${max}`, "refs/heads", "refs/remotes"]);
  return lines(out).filter((r) => isSafeRef(r) && !r.endsWith("/HEAD"));
}
