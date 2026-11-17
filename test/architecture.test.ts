// Layering rules, checked on the sources: only the VS Code adapter may import the vscode API.
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");

/** Every .ts file under src, as a repo-relative path with forward slashes. */
function sources(dir = SRC): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) return sources(abs);
    return e.name.endsWith(".ts") ? [path.relative(ROOT, abs).split(path.sep).join("/")] : [];
  });
}

/** Module specifiers a file imports (import / export from / require). */
function importsOf(rel: string): string[] {
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  return [...text.matchAll(/(?:\bfrom\s*|\brequire\(\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((m) => m[1]);
}

test("only src/vscode and src/extension.ts import the vscode API", () => {
  const files = sources();
  assert.ok(files.length > 20, "sources were found");
  const offenders = files.filter((f) => !f.startsWith("src/vscode/") && f !== "src/extension.ts" && importsOf(f).includes("vscode"));
  assert.deepEqual(offenders, []);
});
