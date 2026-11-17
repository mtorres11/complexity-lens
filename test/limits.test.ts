// The metrics table and the shared helpers built on it.
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { defaultConfig, LIMIT_KEYS, PRESET_NAMES, settingsFor } from "../src/core/config";
import { capitalize, formatTokens } from "../src/core/format";
import { designNoteLines, guidance } from "../src/core/guidance";
import { FILE_KEYS, FUNCTION_KEYS, functionMetricsText, functionOverLimits, isAllowed, isOver, METRIC, METRICS } from "../src/core/limits";
import { Project } from "../src/core/project";
import { VERDICT_TEXT, VERDICTS } from "../src/core/verdict";
import { createConfigFile } from "../src/node/configFile";
import { analyzeSource } from "../src/core/analyze";
import { folder, gitRepo, SIMPLE } from "./helpers";

test("one table drives the limit keys, scopes and lookups", () => {
  assert.deepEqual(LIMIT_KEYS, METRICS.map((m) => m.key));
  assert.deepEqual([...FUNCTION_KEYS, ...FILE_KEYS], LIMIT_KEYS);
  assert.deepEqual(Object.keys(defaultConfig().limits), LIMIT_KEYS, "presets set every limit, in table order");
  for (const m of METRICS) assert.equal(METRIC[m.key], m);
});

test("isOver, functionOverLimits and isAllowed", () => {
  assert.equal(isOver(5, 4), true);
  assert.equal(isOver(4, 4), false);
  assert.equal(isOver(9, null), false, "a null limit is off");
  assert.equal(isOver(undefined, 1), false, "unmeasured is never over");
  const L = defaultConfig("strict").limits;
  const f = { cognitiveComplexity: 11, cyclomaticComplexity: 1, functionLines: 41, nestingDepth: 1, parameters: 1 };
  assert.deepEqual(functionOverLimits(f, L), ["cognitiveComplexity", "functionLines"]);
  const s = settingsFor(defaultConfig(), "a.ts");
  const [withReason, bare, none] = analyzeSource("a.ts", "// complexity-ok: why\nfunction a() {}\n// complexity-ok\nfunction b() {}\nfunction c() {}\n").functions;
  assert.deepEqual([isAllowed(withReason, s), isAllowed(bare, s), isAllowed(none, s)], [true, false, false]);
  s.allowComment.requireReason = false;
  assert.equal(isAllowed(bare, s), true);
});

test("functionMetricsText lists every function metric, with limits when given", () => {
  const f = { cognitiveComplexity: 20, cyclomaticComplexity: 3, functionLines: 50, nestingDepth: 2, parameters: 1 };
  assert.equal(functionMetricsText(f, undefined, " · "), "cognitive 20 · cyclomatic 3 · lines 50 · nesting 2 · parameters 1");
  const L = { ...defaultConfig().limits, cyclomaticComplexity: null };
  assert.equal(functionMetricsText(f, L), "cognitive 20 (limit 15), cyclomatic 3, lines 50 (limit 60), nesting 2 (limit 4), parameters 1 (limit 5)");
});

test("formatTokens and capitalize", () => {
  assert.deepEqual([0, 950, 1000, 1234, 12_000, 1_500_000].map(formatTokens), ["0", "950", "1k", "1.2k", "12k", "1.5M"]);
  assert.equal(capitalize("context load"), "Context load");
});

test("every verdict has a reason and a meaning", () => {
  for (const v of VERDICTS) assert.ok(VERDICT_TEXT[v].reason && VERDICT_TEXT[v].meaning);
});

test("design rules: every short rule has a long form; repo guidelines are added to both", () => {
  const long = guidance(["Use the repo logger"]);
  const short = designNoteLines(["Use the repo logger"]);
  assert.ok(long.includes("- Use the repo logger") && short.includes("- Use the repo logger"));
  assert.ok(short.length < long.length);
  assert.ok(short.every((l) => l.startsWith("- ")));
});

test("baseRefFor: HEAD and unsafe refs compare with the last commit, a branch with its merge base", () => {
  const root = gitRepo({ "a.ts": SIMPLE });
  const p = new Project(root);
  assert.equal(p.baseRefFor("HEAD"), "HEAD");
  assert.equal(p.baseRefFor("-x"), "HEAD");
  assert.match(p.baseRefFor("main"), /^[0-9a-f]{40,64}$/);
});

test("stateDir is inside the git directory, and absent without git", () => {
  const root = gitRepo({ "a.ts": SIMPLE });
  assert.equal(new Project(root).stateDir(), path.join(root, ".git", "complexity-lens"));
  assert.equal(new Project(root, { useGit: false }).stateDir(), undefined);
  assert.equal(new Project(folder({})).stateDir(), undefined);
});

test("createConfigFile writes each preset once", () => {
  for (const preset of PRESET_NAMES) {
    const root = folder({});
    const file = createConfigFile(root, preset);
    assert.match(fs.readFileSync(file, "utf8"), new RegExp(`"preset": "${preset}"`));
    assert.throws(() => createConfigFile(root, preset), { code: "EEXIST" });
  }
});
