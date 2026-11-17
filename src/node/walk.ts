// File listing when git is unavailable (no git, or VS Code Restricted Mode).

import * as fs from "fs";
import * as path from "path";

function readDir(root: string, dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Files under `root` (repo-relative), skipping dot folders and node_modules, up to `max`. */
export function walk(root: string, max: number): string[] {
  const out: string[] = [];
  const stack = [""];
  while (stack.length && out.length < max) {
    const dir = stack.pop() as string;
    const entries = readDir(root, dir).filter((e) => !e.name.startsWith(".") && e.name !== "node_modules");
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) stack.push(rel);
      else if (e.isFile()) out.push(rel);
    }
  }
  return out;
}
