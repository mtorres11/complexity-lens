// Preview fix: the pure prompt/parser/metrics in core, and the Claude runner (with a fake process).
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { analyzeSource } from "../src/core/analyze";
import { defaultConfig, settingsFor } from "../src/core/config";
import { changeText, metricChanges, parseProposal, previewPrompt, proposalSummary } from "../src/core/preview";
import { askClaude, claudeCommand } from "../src/node/claude";
import { COMPLEX, SIMPLE, tempDir } from "./helpers";

const settings = settingsFor(defaultConfig(), "a.ts");

test("the preview prompt keeps the fix prompt and asks for whole files between markers, with no edits", () => {
  const p = previewPrompt("Refactor `f` in a.ts.");
  assert.ok(p.startsWith("Refactor `f` in a.ts.\n"));
  assert.match(p, /don't edit, create or delete any file yourself/);
  assert.match(p, /^<<<FILE src\/example\.ts$/m);
  assert.match(p, /^<<<END$/m);
});

test("parseProposal reads every complete block; a repeated path keeps its last version", () => {
  const answer = [
    "I split the parser.",
    "<<<FILE src/a.ts",
    "export const a = 1;",
    "<<<END",
    "<<<FILE ./src/b.ts  \r",
    "export const b = 2;\r",
    "<<<END",
    "<<<FILE src/a.ts",
    "export const a = 3;",
    "<<<END",
    "<<<FILE src/unfinished.ts",
    "no end marker",
  ].join("\n");
  assert.deepEqual(parseProposal(answer), [
    { path: "src/a.ts", content: "export const a = 3;\n" },
    { path: "./src/b.ts", content: "export const b = 2;\r\n" },
  ]);
  assert.deepEqual(parseProposal("no files here"), []);
});

test("metric changes list only metrics over their limit before or after, and mark new findings", () => {
  const before = analyzeSource("a.ts", COMPLEX);
  const after = analyzeSource("a.ts", SIMPLE);
  const fixed = metricChanges(before, after, settings);
  assert.ok(fixed.length > 0);
  assert.ok(fixed.every((c) => c.after <= c.limit), "everything back within its limit");
  assert.match(changeText(fixed.find((c) => c.key === "cognitiveComplexity")!), /^cognitive 18 → 0 ✓$/);

  const worse = metricChanges(after, before, settings);
  assert.match(changeText(worse.find((c) => c.key === "nestingDepth")!), /^nesting 0 → 5 ✖ new$/);
  assert.deepEqual(metricChanges(after, after, settings), [], "nothing over, nothing listed");
  const fresh = metricChanges(undefined, before, settings);
  assert.match(changeText(fresh[0]), /^\S+( \S+)? \d+ ✖ new$/, "a new file shows only its value");
});

test("the summary has a headline, warns about new findings and says which files aren't measured", () => {
  const worse = metricChanges(analyzeSource("a.ts", SIMPLE), analyzeSource("a.ts", COMPLEX), settings);
  const text = proposalSummary([{ path: "a.ts", changes: worse }, { path: "b.ts", changes: [] }, { path: "README.md" }]);
  const [head, a, b, readme] = text.split("\n");
  assert.equal(head, "3 files changed. ⚠ It adds new findings.");
  assert.match(a, /^a\.ts: .*✖ new/);
  assert.equal(b, "b.ts: every metric within its limit");
  assert.equal(readme, "README.md: not measured");
  assert.equal(proposalSummary([{ path: "a.ts", changes: [] }]), "1 file changed.\na.ts: every metric within its limit");
});

test("claude is found from the setting, then the PATH, then the Claude Code extension", () => {
  const home = tempDir();
  const ext = (v: string) => path.join(home, ".vscode", "extensions", `anthropic.claude-code-${v}-darwin-arm64`, "resources", "native-binary");
  for (const v of ["2.1.9", "2.1.10"]) {
    fs.mkdirSync(ext(v), { recursive: true });
    fs.writeFileSync(path.join(ext(v), process.platform === "win32" ? "claude.exe" : "claude"), "");
  }
  assert.equal(claudeCommand(" /opt/claude ", () => true, home), "/opt/claude");
  assert.equal(claudeCommand("", () => true, home), "claude");
  assert.match(claudeCommand("", () => false, home) ?? "", /claude-code-2\.1\.10-/, "the newest bundled one");
  assert.equal(claudeCommand("", () => false, tempDir()), undefined);
});

test("askClaude passes the prompt on stdin with read-only tools, and reports failures in plain words", async () => {
  const calls: { cmd: string; args: string[]; cwd: string; stdin?: string }[] = [];
  const fake = (fail: boolean) =>
    ((cmd: string, args: string[], opts: { cwd: string }, cb: (e: Error | null, out: string, err: string) => void) => {
      const call: (typeof calls)[number] = { cmd, args, cwd: opts.cwd };
      calls.push(call);
      setImmediate(() => (fail ? cb(new Error("exit 1"), "", "line 1\nline 2\nNot logged in") : cb(null, "<<<FILE a.ts\nx\n<<<END\n", "")));
      return { stdin: { end: (text: string) => (call.stdin = text) } };
    }) as unknown as typeof import("child_process").execFile;
  assert.equal(await askClaude("Fix it", "/repo", "/bin/claude", fake(false)), "<<<FILE a.ts\nx\n<<<END\n");
  assert.deepEqual(calls[0], {
    cmd: "/bin/claude",
    args: ["-p", "--output-format", "text", "--tools", "Read,Grep,Glob", "--permission-mode", "dontAsk"],
    cwd: "/repo",
    stdin: "Fix it",
  });
  await assert.rejects(askClaude("Fix it", "/repo", "/bin/claude", fake(true)), /line 1 line 2 Not logged in/);
});
