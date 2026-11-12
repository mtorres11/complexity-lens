import { strict as assert } from "node:assert";
import { test } from "node:test";
import { analyzeSource } from "../src/core/analyze";
import {
  settingsFor,
  defaultConfig,
} from "../src/core/config";
import { parseJsonc, resolveConfig } from "../src/core/configParse";
import { evaluateFile, isProblem } from "../src/core/evaluate";
import { globToRegExp, matchesAny } from "../src/core/glob";
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

const fileWith = (complexity: number) => ({
  path: "x.ts",
  fileLines: 10,
  fileTokens: 10,
  imports: 0,
  relativeImports: [],
  functions: [
    {
      key: "f",
      name: "f",
      line: 1,
      endLine: 5,
      cognitiveComplexity: complexity,
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
