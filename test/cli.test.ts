// The command line: exit codes per CI mode, --policy, --base, argument errors, formats, init, hook.
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import * as format from "../src/cli/format";
import { run } from "../src/cli/main";
import type { Finding } from "../src/core/evaluate";
import { commit, COMPLEX, folder, git, gitRepo, SIMPLE } from "./helpers";

async function cli(args: string[], stdin = ""): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await run(args, { stdout: (t) => void (out += t), stderr: (t) => void (err += t), stdin: async () => stdin });
  return { code, out, err };
}

/** A repo whose last commit has a simple f(); the working copy makes it complex (a regression). */
function regressed(config?: object): string {
  const root = gitRepo({ "a.ts": SIMPLE, ...(config ? { "complexity-lens.json": JSON.stringify(config) } : {}) });
  fs.writeFileSync(path.join(root, "a.ts"), COMPLEX);
  return root;
}

test("help, unknown commands and argument errors", async () => {
  assert.match((await cli([])).out, /^Complexity Lens/);
  assert.match((await cli(["check", "--help"])).out, /Usage:/);
  const unknown = await cli(["frobnicate"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /unknown command "frobnicate"\nRun 'complexity-lens help'/);
  for (const [args, message] of [
    [["check", "--base"], /--base needs a value/],
    [["check", "--format", "xml"], /--format must be one of: text, github, json/],
    [["check", "--mode", "loud"], /--mode must be one of/],
    [["check", "--policy", "lenient"], /--policy must be one of: ratchet, absolute/],
    [["check", "--base", "a..b"], /is not a valid git ref/],
    [["init", "--preset", "huge"], /--preset must be one of/],
    [["hook", "later"], /hook needs "post-edit" or "stop"/],
  ] as [string[], RegExp][]) {
    const r = await cli(args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.err, message);
  }
});

test("exit codes per ci mode", async () => {
  const root = regressed();
  const check = (mode: string) => cli(["check", "--cwd", root, "--mode", mode]);
  assert.equal((await check("failOverLimit")).code, 1);
  assert.equal((await check("failOnRegression")).code, 1);
  const warn = await check("warn");
  assert.equal(warn.code, 0);
  assert.match(warn.out, /Complexity Lens: \d+ problem\(s\)\n  a\.ts\n    ✖ line 1  f: cognitive complexity 0 → /);
  assert.deepEqual(await check("off"), { code: 0, out: "", err: "" });
  assert.equal((await cli(["check", "--cwd", regressed({ ci: { mode: "failOverLimit" } })])).code, 1, "mode from the config");
});

test("--policy absolute audits unchanged code: over-limit code fails failOverLimit but not failOnRegression", async () => {
  const root = gitRepo({ "a.ts": COMPLEX });
  const audit = (mode: string, ...extra: string[]) => cli(["check", "--cwd", root, "--all", "--mode", mode, ...extra]);
  assert.equal((await audit("failOverLimit")).code, 0, "ratchet: unchanged code passes");
  assert.equal((await audit("failOverLimit", "--policy", "absolute")).code, 1);
  assert.equal((await audit("failOnRegression", "--policy", "absolute")).code, 0);
  assert.match((await audit("warn", "--policy", "absolute")).out, /over limit/);
});

test("--base compares with the merge base of a branch", async () => {
  const root = gitRepo({ "a.ts": SIMPLE });
  git(root, "checkout", "-q", "-b", "feature");
  commit(root, { "a.ts": COMPLEX });
  assert.equal((await cli(["check", "--cwd", root, "--mode", "failOverLimit"])).code, 0, "nothing uncommitted");
  const r = await cli(["check", "--cwd", root, "--base", "main", "--mode", "failOverLimit", "--format", "json"]);
  assert.equal(r.code, 1);
  const json = JSON.parse(r.out) as { problems: Finding[] };
  assert.ok(json.problems.every((f) => f.status === "regression" && f.path === "a.ts"));
});

test("files given on the command line; files outside the repo or excluded are skipped", async () => {
  const root = regressed();
  fs.writeFileSync(path.join(root, "a.test.ts"), COMPLEX);
  const r = await cli(["check", "--cwd", root, "--mode", "warn", "--", path.join(root, "a.ts"), path.join(root, "a.test.ts"), "/elsewhere/x.ts"]);
  assert.match(r.out, /a\.ts/);
  assert.doesNotMatch(r.out, /a\.test\.ts/);
});

test("config errors exit with 2", async () => {
  const root = folder({ "complexity-lens.json": '{ "policy": "never", "extra": 1 }' });
  const r = await cli(["check", "--cwd", root]);
  assert.equal(r.code, 2);
  assert.match(r.err, /warning: extra: unknown option, ignored\nconfig error: policy: must be one of ratchet, absolute/);
});

test("github format escapes workflow-command data and properties", () => {
  const f: Finding = { path: "src/a,b:c%.ts", line: 3, metric: "functionLines", value: 70, limit: 60, status: "new-over", hint: "line one\nline two\r 100%" };
  const out = format.github([f, { ...f, status: "improved" }], "error");
  assert.equal(out.split("\n").length, 1, "only problems");
  assert.ok(out.startsWith("::error file=src/a%2Cb%3Ac%25.ts,line=3,title=Complexity Lens::"));
  assert.ok(out.endsWith("Tip: line one%0Aline two%0D 100%25."));
  assert.equal(format.github([f], "warning").slice(0, 10), "::warning ");
  assert.equal(format.text([]), "Complexity Lens: no problems found.");
});

test("init writes the commented config once", async () => {
  const root = folder({});
  const r = await cli(["init", "--cwd", root, "--preset", "strict"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /\(preset: strict\)/);
  assert.match(fs.readFileSync(path.join(root, "complexity-lens.json"), "utf8"), /"preset": "strict"/);
  const again = await cli(["init", "--cwd", root]);
  assert.equal(again.code, 2);
  assert.match(again.err, /already exists; not overwritten/);
});

test("hook reads JSON from stdin, answers on stdout, and fails open", async () => {
  const root = regressed();
  const input = JSON.stringify({ cwd: root, tool_name: "Edit", tool_input: { file_path: path.join(root, "a.ts") } });
  const r = await cli(["hook", "post-edit"], input);
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).decision, "block");
  assert.deepEqual(await cli(["hook", "stop"], "{ broken"), { code: 0, out: "", err: "" });
  assert.equal((await cli(["hook", "stop"], "")).code, 0);
});
