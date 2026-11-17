// Regression tests for reviewed bugs: per-file allow markers, cached metrics never mutated,
// consistent parameter advice, and the --policy option.
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { fixAllPrompt } from "../src/core/actions";
import { functionAdvice } from "../src/core/advice";
import { analyzeSource } from "../src/core/analyze";
import { allowCommentText, defaultConfig, settingsFor } from "../src/core/config";
import { HINT } from "../src/core/evaluate";
import { detail, summarize } from "../src/core/insights";
import type { FileSummary } from "../src/core/insights";
import { Project } from "../src/node/project";

const BRANCHY = "export function f(a: number, b: number, c: number, d: number, e: number, g: number) {\n  if (a) { if (b) { if (c) return d; } }\n  return e + g;\n}\n";

function repo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cl-fixes-"));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const ctx = { churn: new Map(), dependents: new Map(), baseRef: "HEAD" };

test("allowCommentText builds the accept comment from the marker", () => {
  assert.equal(allowCommentText("keep-it", "parser"), "// keep-it: parser");
});

test("summaries carry the file's own allow marker, including per-file overrides", () => {
  const root = repo({
    "a.ts": BRANCHY,
    "legacy/b.ts": BRANCHY,
    "complexity-lens.json": JSON.stringify({ overrides: [{ files: ["legacy/**"], allowComment: { marker: "legacy-ok" } }] }),
  });
  const p = new Project(root, { useGit: false });
  assert.equal(summarize(p, "a.ts", ctx)?.allowMarker, "complexity-ok");
  assert.equal(summarize(p, "legacy/b.ts", ctx)?.allowMarker, "legacy-ok");
});

test("fix-all prompt uses the configured markers, never a hard-coded one", () => {
  const item = (allowMarker: string) => ({ path: "a.ts", allowMarker, problems: [{ line: 1, text: "x" }], limits: defaultConfig().limits }) as unknown as FileSummary;
  const one = fixAllPrompt([item("keep-it")]);
  assert.ok(one.includes('"// keep-it: <reason>"'));
  assert.ok(!one.includes("complexity-ok"));
  const two = fixAllPrompt([item("keep-it"), item("legacy-ok"), item("keep-it")]);
  assert.ok(two.includes('"// keep-it: <reason>" or "// legacy-ok: <reason>"'));
  assert.ok(!fixAllPrompt([]).includes("genuinely necessary"));
});

test("evaluate, summarize and detail never write derived values onto cached metrics", () => {
  const root = repo({ "a.ts": 'import { u } from "./u";\nexport const a = () => u();\n', "u.ts": "export const u = () => 1;\n" });
  const p = new Project(root, { useGit: false });
  const cached = p.metrics("a.ts");
  const snapshot = JSON.stringify(cached);
  const r = p.evaluate("a.ts");
  assert.equal(r.metrics, cached);
  assert.ok(r.context && r.context.total > r.context.own);
  summarize(p, "a.ts", ctx);
  detail(p, "a.ts", { ...ctx, changed: new Set() });
  assert.equal(JSON.stringify(p.metrics("a.ts")), snapshot);
  assert.ok(!("contextTokens" in (cached as object)));
});

test("parameter advice never suggests a parameter object", () => {
  const fn = analyzeSource("a.ts", BRANCHY).functions[0];
  const advice = functionAdvice(fn, settingsFor(defaultConfig("strict"), "a.ts")).join(" ");
  for (const text of [advice, HINT.parameters]) {
    assert.ok(!/options object|group/i.test(text), text);
    assert.ok(/split the function|object the values come from/.test(text), text);
  }
});

test("policy option overrides the repo policy and every override without changing the config", () => {
  const root = repo({
    "a.ts": BRANCHY,
    "complexity-lens.json": JSON.stringify({ policy: "ratchet", overrides: [{ files: ["legacy/**"], policy: "ratchet" }] }),
  });
  const audit = new Project(root, { useGit: false, policy: "absolute" });
  assert.equal(audit.settings("a.ts").policy, "absolute");
  assert.equal(audit.settings("legacy/x.ts").policy, "absolute");
  assert.equal(audit.config.policy, "ratchet");
  assert.equal(audit.config.overrides[0].policy, "ratchet");
  assert.equal(new Project(root, { useGit: false }).settings("legacy/x.ts").policy, "ratchet");
});
