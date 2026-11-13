import { strict as assert } from "node:assert";
import { test } from "node:test";
import { analyzeSource, FileMetrics } from "../src/core/analyze";
import {
  settingsFor,
  defaultConfig,
} from "../src/core/config";
import { resolveConfig } from "../src/core/configParse";
import { parseJsonc } from "../src/core/jsonc";
import { evaluateFile, Finding, isProblem } from "../src/core/evaluate";
import { globToRegExp, matchesAny } from "../src/core/glob";
import { parseChurn } from "../src/core/churn";
import { buildDependents, coupling } from "../src/core/dependents";
import { decide } from "../src/core/verdict";
import { functionAdvice, suggestSplit } from "../src/core/advice";
import { isSafeRef } from "../src/core/git";

const cc = (src: string, name: string) => {
  const fn = analyzeSource("a.ts", src).functions.find((f) => f.name === name);
  assert.ok(fn, `function ${name} not found`);
  return fn;
};

test("cognitive complexity: SonarSource sumOfPrimes example = 7", () => {
  const src = `function sumOfPrimes(max: number) {
    let total = 0;
    OUT: for (let i = 1; i <= max; ++i) {
      for (let j = 2; j < i; ++j) {
        if (i % j == 0) { continue OUT; }
      }
      total += i;
    }
    return total;
  }`;
  assert.equal(cc(src, "sumOfPrimes").cognitiveComplexity, 7);
  assert.equal(cc(src, "sumOfPrimes").nestingDepth, 3);
});

test("cognitive complexity: switch counts once", () => {
  const src = `function getWords(n: number) { switch (n) { case 1: return "one"; case 2: return "two"; default: return "lots"; } }`;
  assert.equal(cc(src, "getWords").cognitiveComplexity, 1);
});

test("cognitive complexity: if / else if / else = 3, nested if adds nesting", () => {
  assert.equal(
    cc(
      `function f(a: boolean, b: boolean) { if (a) {} else if (b) {} else {} }`,
      "f",
    ).cognitiveComplexity,
    3,
  );
  assert.equal(
    cc(`function f(a: boolean, b: boolean) { if (a) { if (b) {} } }`, "f")
      .cognitiveComplexity,
    3,
  );
});

test("cognitive complexity: logical operator sequences", () => {
  assert.equal(
    cc(`function f(a: any, b: any, c: any) { return a && b && c; }`, "f")
      .cognitiveComplexity,
    1,
  );
  assert.equal(
    cc(`function f(a: any, b: any, c: any) { return a && b || c; }`, "f")
      .cognitiveComplexity,
    2,
  );
  assert.equal(
    cc(`function f(a: any, b: any, c: any) { return a ?? (b ?? c); }`, "f")
      .cognitiveComplexity,
    1,
  );
});

test("anonymous callbacks count toward the parent with extra nesting; named inner functions are separate", () => {
  const src = `function outer(xs: number[]) {
    xs.forEach((x) => { if (x) {} });
    const inner = (y: number) => { if (y) {} };
    return inner;
  }`;
  assert.equal(cc(src, "outer").cognitiveComplexity, 2);
  assert.equal(cc(src, "inner").cognitiveComplexity, 1);
});

test("methods, accessors and duplicates get stable keys", () => {
  const src = `class A { constructor() {} get v() { return 1; } run() {} }
    const o = { run() {} }; function run() {} `;
  const keys = analyzeSource("a.ts", src).functions.map((f) => f.key);
  assert.deepEqual(keys, ["A.constructor", "A.get v", "A.run", "run", "run#2"]);
});

test("file metrics: lines, imports (unique), relative imports, parameters", () => {
  const src = `import a from "./a";\nimport { b } from "lib";\nexport * from "./c";\nconst d = require("./a");\nfunction f(x: number, y: number, z = 1) {}\n`;
  const m = analyzeSource("x.ts", src);
  assert.equal(m.imports, 3);
  assert.deepEqual(m.relativeImports.sort(), ["./a", "./c"]);
  assert.equal(m.functions[0].parameters, 3);
  assert.ok(m.fileTokens > 0);
});

test("allow comment with and without a reason", () => {
  const src = `// complexity-ok: state machine\nfunction a() {}\n/* complexity-ok */\nfunction b() {}\nfunction c() {}`;
  const fns = analyzeSource("x.ts", src).functions;
  assert.equal(fns[0].allowReason, "state machine");
  assert.equal(fns[1].allowReason, "");
  assert.equal(fns[2].allowReason, undefined);
});

const fileWith = (complexity: number): FileMetrics => ({
  path: "x.ts",
  fileLines: 10,
  fileTokens: 10,
  imports: 0,
  relativeImports: [],
  lcom: 0,
  cohesion: [],
  functions: [
    {
      key: "f",
      name: "f",
      line: 1,
      endLine: 5,
      cognitiveComplexity: complexity,
      cyclomaticComplexity: 1,
      increments: [],
      calls: [],
      functionLines: 5,
      nestingDepth: 1,
      parameters: 1,
    },
  ],
});

test("ratchet: new over limit, regression, unchanged, improved", () => {
  const s = settingsFor(defaultConfig("recommended"), "x.ts"); // limit 15
  const status = (now: number, before?: number) =>
    evaluateFile(
      fileWith(now),
      before === undefined ? undefined : fileWith(before),
      s,
    ).find((f) => f.metric === "cognitiveComplexity")?.status;
  assert.equal(status(16), "new-over");
  assert.equal(status(22, 20), "regression");
  assert.equal(status(20, 20), undefined);
  assert.equal(status(18, 20), "improved");
  assert.equal(status(10, 20), "improved");
  assert.equal(status(10), undefined);
});

test("absolute: unchanged over-limit code is still a problem", () => {
  const s = settingsFor(defaultConfig("strict"), "x.ts"); // limit 10, absolute
  const f = evaluateFile(fileWith(12), fileWith(12), s).find(
    (x) => x.metric === "cognitiveComplexity",
  );
  assert.equal(f?.status, "over");
  assert.ok(f && isProblem(f));
  const better = evaluateFile(fileWith(11), fileWith(14), s).find(
    (x) => x.metric === "cognitiveComplexity",
  );
  assert.equal(better?.status, "over");
});

test("allowed functions are reported but not problems; reason can be required", () => {
  const s = settingsFor(defaultConfig("recommended"), "x.ts");
  const withReason = fileWith(30);
  withReason.functions[0] = {
    ...withReason.functions[0],
    allowReason: "parser",
  } as never;
  assert.equal(evaluateFile(withReason, undefined, s)[0].status, "allowed");
  const noReason = fileWith(30);
  noReason.functions[0] = {
    ...noReason.functions[0],
    allowReason: "",
  } as never;
  assert.equal(evaluateFile(noReason, undefined, s)[0].status, "new-over");
});

test("config: preset, overrides, unknown keys, invalid values, unsafe globs", () => {
  const r = resolveConfig({
    preset: "strict",
    limits: { cognitiveComplexity: 12, imports: null },
    hook: { afterEdit: "loud" },
    surprise: true,
    include: ["../outside/**", "/abs/**", "src/**"],
    overrides: [
      {
        files: ["src/legacy/**"],
        policy: "ratchet",
        hook: { onFinish: "inform" },
      },
    ],
  });
  assert.equal(r.config.limits.cognitiveComplexity, 12);
  assert.equal(r.config.limits.imports, null);
  assert.equal(r.config.limits.functionLines, 40); // from strict preset
  assert.equal(r.config.hook.afterEdit, "nudge"); // invalid value fell back to preset
  assert.deepEqual(r.config.include, ["src/**"]);
  assert.ok(r.warnings.some((w) => w.startsWith("surprise")));
  assert.ok(r.errors.some((e) => e.includes("hook.afterEdit")));
  assert.equal(
    r.errors.filter((e) => e.includes("cannot use") || e.includes("relative"))
      .length,
    2,
  );
  const legacy = settingsFor(r.config, "src/legacy/old.ts");
  assert.equal(legacy.policy, "ratchet");
  assert.equal(legacy.hook.onFinish, "inform");
  assert.equal(settingsFor(r.config, "src/new.ts").policy, "absolute");
});

test("JSONC parsing keeps strings intact", () => {
  const v = parseJsonc(
    `{ // comment\n "a": "x // not a comment", /* b */ "b": [1, 2,], }`,
  ) as Record<string, unknown>;
  assert.deepEqual(v, { a: "x // not a comment", b: [1, 2] });
});

test("glob matching", () => {
  assert.ok(matchesAny("src/a/b.ts", ["src/**/*.{ts,tsx}"]));
  assert.ok(matchesAny("src/b.ts", ["src/**/*.ts"]));
  assert.ok(!matchesAny("lib/b.ts", ["src/**"]));
  assert.ok(matchesAny("src/x.test.ts", ["**/*.test.*"]));
  assert.ok(!globToRegExp("a.b").test("aXb"), "dots are literal");
  assert.ok(!globToRegExp("(a|b)").test("a"), "regex syntax is literal");
});

test("git refs are validated", () => {
  for (const ok of ["HEAD", "main", "origin/main", "v1.2.3", "HEAD~1"])
    assert.ok(isSafeRef(ok), ok);
  for (const bad of ["--output=/tmp/x", "-n", "a..b", "a b", "a;rm", ""])
    assert.ok(!isSafeRef(bad), bad);
});

test("cyclomatic complexity: 1 + decisions (if, loops, cases, catch, && / ||, ternary)", () => {
  const src = `function f(a: number, b: boolean) {
    if (a > 1 && b) { return 1; }
    for (const x of [1]) { try { void x; } catch { return 2; } }
    switch (a) { case 1: return 3; case 2: return 4; default: return 5; }
    return b ? 6 : 7;
  }`;
  // 1 + if + && + for + catch + 2 cases + ternary = 8
  assert.equal(cc(src, "f").cyclomaticComplexity, 8);
});

test("where the complexity is: increments carry line, kind and points", () => {
  const src = `function f(a: number[]) {\n  for (const x of a) {\n    if (x) {\n      return x;\n    }\n  }\n  return 0;\n}`;
  const incs = cc(src, "f").increments;
  assert.deepEqual(incs.map((i) => [i.kind, i.line, i.points]), [["for…of", 2, 1], ["if", 3, 2]]);
});

test("cohesion: a class with two unrelated halves has LCOM 2; a module of related functions has LCOM 1", () => {
  const cls = `class A {
    x = 1; y = 2;
    a() { return this.x; } b() { return this.x + 1; }
    c() { return this.y; } d() { return this.c(); }
  }`;
  const m = analyzeSource("a.ts", cls);
  assert.equal(m.cohesion.find((c) => c.scope === "class")?.lcom, 2);
  const mod = analyzeSource("m.ts", `function main() { return helper(); }\nfunction helper() { return 1; }\nfunction other() { return 2; }`);
  assert.equal(mod.cohesion.find((c) => c.scope === "module")?.lcom, 2);
  const joined = analyzeSource("j.ts", `const state = { n: 0 };\nfunction a() { state.n++; }\nfunction b() { return state.n; }`);
  assert.equal(joined.cohesion.find((c) => c.scope === "module")?.lcom, 1, "shared module state connects functions");
});

test("calls: plain and own-member calls are recorded", () => {
  const src = `class S { run() { this.save(); helper(); other.thing(); } save() {} }`;
  assert.deepEqual(cc(src, "S.run").calls.sort(), ["helper", "this.save"]);
});

test("churn: commits, lines, authors and weekly buckets from numstat", () => {
  const now = 1_700_000_000;
  const raw = [`\x01${now - 3600}\ta@x`, "10\t2\tsrc/a.ts", "1\t1\tsrc/b.ts", `\x01${now - 8 * 86400}\tb@x`, "5\t0\tsrc/a.ts", "-\t-\tlogo.png"].join("\n");
  const c = parseChurn(raw, 14, now);
  const a = c.get("src/a.ts");
  assert.deepEqual([a?.commits, a?.added, a?.deleted, a?.authors, a?.weekly], [2, 15, 2, 2, [1, 1]]);
  assert.equal(c.get("logo.png")?.added, 0);
});

test("afferent coupling and instability", () => {
  const idx = buildDependents(["a.ts", "b.ts", "c.ts"], (f) => (f === "c.ts" ? [] : ["./c"]), (_f, s) => (s === "./c" ? "c.ts" : undefined));
  assert.deepEqual([...(idx.get("c.ts") ?? [])].sort(), ["a.ts", "b.ts"]);
  assert.deepEqual(coupling(2, 6), { ca: 2, ce: 6, instability: 0.75 });
});

test("verdicts: FIX when the change regressed or a hotspot, PLAN / LEAVE by churn, OK within limits", () => {
  const cfg = defaultConfig("recommended");
  const s = settingsFor(cfg, "x.ts");
  const churn = (commits: number) => ({ commits, added: 0, deleted: 0, authors: 1, lastChange: 0, weekly: [] });
  const over = fileWith(30);
  const v = (m: FileMetrics, commits: number, findings: Finding[] = []) => decide({ metrics: m, findings, churn: churn(commits), ca: 0, config: cfg, settings: s }).verdict;
  assert.equal(v(fileWith(3), 50), "OK");
  assert.equal(v(over, 10), "FIX");
  assert.equal(v(over, 3), "PLAN");
  assert.equal(v(over, 0), "LEAVE");
  const regression = evaluateFile(fileWith(30), fileWith(20), s);
  assert.equal(v(over, 0, regression), "FIX");
});

test("split suggestion from cohesion groups, with token savings", () => {
  const body = (n: string) => `export function ${n}() {\n${"  const x = 1;\n".repeat(60)}  return x;\n}\n`;
  const src = body("parseOrder") + body("parseOrderLine") .replace("return x;", "return parseOrder();") + body("renderInvoice");
  const m = analyzeSource("big.ts", src);
  const split = suggestSplit(m, settingsFor(defaultConfig("strict"), "big.ts"));
  assert.ok(split, "a split is suggested");
  assert.equal(split.parts.length, 2);
  assert.ok(split.parts.some((p) => p.file === "order.ts" || p.file === "parse.ts"));
  assert.ok(split.savesTokens > 0);
});

test("function advice points at the block to extract", () => {
  const src = `function f(a: number[], b: boolean) {
    for (const x of a) {
      if (x > 1) { if (b) { if (x > 2) { if (x > 3) { return x; } } } }
    }
    return 0;
  }`;
  const advice = functionAdvice(cc(src, "f"), settingsFor(defaultConfig("strict"), "a.ts"));
  assert.match(advice[0], /^Move lines 2–4 \(the for…of\) into its own function: about −\d+ cognitive\.$/);
});
