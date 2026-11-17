// Shared test fixtures: throwaway folders and git repositories.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** A new empty folder (real path, so it compares equal to git's output). */
export const tempDir = (prefix = "cl-"): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

/** Writes files given as repo-relative path → text, creating folders. */
export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
}

/** Runs git in `root` with a fixed identity; returns its output. */
export const git = (root: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** Writes the files and commits them. */
export function commit(root: string, files: Record<string, string>, message = "change"): void {
  writeFiles(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
}

/** A git repository on branch "main" with one commit of `files`. */
export function gitRepo(files: Record<string, string>): string {
  const root = tempDir("cl-git-");
  git(root, "init", "-q", "-b", "main");
  commit(root, files, "init");
  return root;
}

/** A plain folder with `files` (no git). */
export function folder(files: Record<string, string>): string {
  const root = tempDir("cl-dir-");
  writeFiles(root, files);
  return root;
}

export const SIMPLE = "export function f(x: number) {\n  return x + 1;\n}\n";

/** A function with cognitive complexity 15 + nesting 5 (over every preset). */
export const COMPLEX = `export function f(x: number) {
  if (x > 1) { if (x > 2) { if (x > 3) { if (x > 4) { if (x > 5) { return 5; } } } } }
  return x && x > 0 || x < -1 ? 1 : 0;
}\n`;
