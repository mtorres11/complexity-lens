// Verdicts, summaries, finding text, cohesion judgement and glob syntax.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { analyzeSource, FileMetrics } from "../src/core/analyze";
import { defaultConfig, settingsFor } from "../src/core/config";
import type { ContextLoad } from "../src/core/context";
import { describe, Finding, hintFor } from "../src/core/evaluate";
import { judgedLcom } from "../src/core/limits";
import { matchesAny } from "../src/core/glob";
import type { FileSummary } from "../src/core/insights";
import { choreList, prSummary } from "../src/core/summaries";
import { decide } from "../src/core/verdict";

const cfg = defaultConfig("recommended");
const s = settingsFor(cfg, "x.ts");
const churn = (commits: number, authors = 1) => ({ commits, added: 0, deleted: 0, authors, lastChange: 0, weekly: [] });
const ctxOf = (fromImports: number): ContextLoad => ({ own: 0, fromImports, total: fromImports, imports: [], ignored: [] });
const COMPLEX = "export function hard(a: number) {\n  if (a) { if (a > 1) { if (a > 2) { return 1; } } }\n  return 0;\n}\n";

test("payoff = (commits + 1) × (context k-tokens + worst cognitive) × (1 + log2(1 + dependents) / 2)", () => {
  const m = analyzeSource("x.ts", COMPLEX); // cognitive 6
  const d = decide({ metrics: m, findings: [], churn: churn(3), ca: 3, context: ctxOf(2000 - m.fileTokens), config: cfg, settings: s });
  assert.equal(d.payoff, Math.round(4 * (2 + 6) * (1 + Math.log2(4) / 2)));
  const noContext = decide({ metrics: m, findings: [], ca: 0, config: cfg, settings: s });
  assert.equal(noContext.payoff, Math.round(m.fileTokens / 1000 + 6));
});

test("why explains regressions, churn, dependents, context load and the hardest function", () => {
  const m = analyzeSource("x.ts", COMPLEX);
  const regression = { status: "regression" } as Finding;
  const why = decide({ metrics: m, findings: [regression], churn: churn(4, 2), ca: 1, context: ctxOf(1500), config: cfg, settings: s }).why;
  assert.match(why, /This change made it harder to work with\./);
  assert.match(why, /Changed 4× recently by 2 people\./);
  assert.match(why, /1 file depend on it/);
  assert.match(why, /Every AI edit reads about 1\.\dk tokens\./);
  assert.match(why, /Hardest function: hard \(6\)\./);
  const quiet = decide({ metrics: analyzeSource("y.ts", "export const y = 1;\n"), findings: [], churn: churn(1), ca: 2, config: cfg, settings: s }).why;
  assert.equal(quiet, "Changed 1× recently. 2 files depend on it, so mistakes spread.");
});

const item = (path: string, problems: string[], notes: [Finding["status"], string][] = []) =>
  ({
    path,
    verdict: "FIX",
    reason: "hotspot",
    why: "Changed often.",
    problems: problems.map((text) => ({ line: 1, text, status: "regression" })),
    notes: notes.map(([status, text]) => ({ line: 1, text, status })),
  }) as unknown as FileSummary;

test("PR summary lists problems, improvements and accepted items", () => {
  const out = prSummary([item("a.ts", ["f got worse"], [["improved", "g improved"], ["allowed", "h accepted"]]), item("b.ts", [])]);
  assert.equal(out, ["**Complexity**", "- 1 item(s) got more complex:", "  - a.ts: f got worse", "- 1 improvement(s): g improved", "- 1 accepted with a reason in the code."].join("\n"));
  assert.equal(prSummary([item("b.ts", [])]), "**Complexity**\n- No function or file got more complex.");
});

test("chore list numbers files with verdict, reason and why", () => {
  assert.equal(choreList([item("a.ts", []), item("b.ts", [])]), "1. [FIX] a.ts: hotspot. Changed often.\n2. [FIX] b.ts: hotspot. Changed often.");
});

test("describe tags each status and shows the change from the baseline", () => {
  const f = (status: Finding["status"], baseline?: number, fn?: string): Finding => ({ path: "a.ts", fn, line: 1, metric: "cognitiveComplexity", value: 20, limit: 15, baseline, status });
  assert.equal(describe(f("new-over", undefined, "g")), "g: cognitive complexity 20 (limit 15, new, over limit)");
  assert.equal(describe(f("regression", 16, "g")), "g: cognitive complexity 16 → 20 (limit 15, got worse)");
  assert.equal(describe(f("allowed", 20)), "file: cognitive complexity 20 (limit 15, accepted by comment)");
  assert.equal(describe(f("improved", 25)), "file: cognitive complexity 25 → 20 (limit 15, improved)");
  assert.equal(describe(f("over", 20)), "file: cognitive complexity 20 (limit 15, over limit)");
  assert.equal(hintFor({ ...f("over"), hint: "custom" }), "custom");
});

test("judged LCOM: classes always count; the module only from half the file-line limit", () => {
  const m = (fileLines: number): FileMetrics => ({
    path: "a.ts", fileLines, fileTokens: 1, imports: 0, relativeImports: [], functions: [],
    cohesion: [{ scope: "module", name: "(module)", lcom: 3, groups: [] }, { scope: "class", name: "C", lcom: 2, groups: [] }],
  });
  assert.equal(judgedLcom(m(199), s), 2, "small file: only the class counts");
  assert.equal(judgedLcom(m(200), s), 3, "half the 400-line limit: the module counts");
  const noLineLimit = settingsFor(defaultConfig(), "a.ts");
  noLineLimit.limits.fileLines = null;
  assert.equal(judgedLcom(m(10), noLineLimit), 3, "no line limit: the module always counts");
});

test("glob: braces, **/ at the root and in folders, ? and *", () => {
  assert.ok(matchesAny("a.ts", ["**/*.{ts,js}"]), "**/ matches no folder at all");
  assert.ok(matchesAny("src/deep/a.js", ["**/*.{ts,js}"]));
  assert.ok(!matchesAny("a.tsx", ["**/*.{ts,js}"]));
  assert.ok(matchesAny("src/x/generated/y.ts", ["**/generated/**"]));
  assert.ok(matchesAny("./src/a.ts", ["src/?.ts"]), "leading ./ is ignored");
  assert.ok(!matchesAny("src/ab.ts", ["src/?.ts"]));
  assert.ok(!matchesAny("src/a/b.ts", ["src/*.ts"]), "* stops at /");
  assert.ok(matchesAny("src\\win\\a.ts", ["src/win/*.ts"]), "backslashes are normalised");
  assert.ok(matchesAny("x.a", ["x.{a"]), "an unclosed group still matches its alternatives");
});
