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

/** Module specifiers a file imports: import / export … from, side-effect imports, require() and import(). */
function importsOf(rel: string): string[] {
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const re = /^\s*(?:import|export)\s[^;"'=]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']|\b(?:require|import)\(\s*["']([^"']+)["']\s*\)/gm;
  return [...text.matchAll(re)].map((m) => m[1] ?? m[2] ?? m[3]);
}

test("only src/vscode and src/extension.ts import the vscode API", () => {
  const files = sources();
  assert.ok(files.length > 20, "sources were found");
  const offenders = files.filter((f) => !f.startsWith("src/vscode/") && f !== "src/extension.ts" && importsOf(f).includes("vscode"));
  assert.deepEqual(offenders, []);
});

/** Files under a folder of src whose imports break `ok`. */
const offending = (folder: string, ok: (spec: string) => boolean) =>
  sources()
    .filter((f) => f.startsWith(`src/${folder}/`))
    .flatMap((f) => importsOf(f).filter((spec) => !ok(spec)).map((spec) => `${f} → ${spec}`));

const NODE_BUILTINS = /^(node:)?(fs|path|os|crypto|child_process)$/;

test("core is pure: no Node built-ins and no imports from the node, app, host or UI layers", () => {
  assert.deepEqual(offending("core", (s) => !NODE_BUILTINS.test(s) && (s.startsWith("./") || s === "typescript")), []);
});

test("the webview only talks to core, the shared protocol and itself", () => {
  assert.deepEqual(offending("webview", (s) => s.startsWith("./") || s.startsWith("../core/") || s.startsWith("../shared/")), []);
});

test("shared, node and app never reach up into a host or the UI", () => {
  assert.deepEqual(offending("shared", (s) => s.startsWith("../core/")), []);
  assert.deepEqual(offending("node", (s) => !/^\.\.\/(app|cli|vscode|webview)\//.test(s)), []);
  assert.deepEqual(offending("app", (s) => !/^\.\.\/(cli|vscode|webview)\//.test(s)), []);
});
