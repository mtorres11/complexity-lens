// File summaries and file / function detail built from a real repository.
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { detail, InsightContext, summarize } from "../src/core/insights";
import { Project } from "../src/core/project";
import { COMPLEX, folder, gitRepo, SIMPLE } from "./helpers";

const METHODS = `import { u } from "./u";
import * as fs from "fs";
export class Parser {
  parse(a: number, b: number) { return this.step(a) + helper(b); }
  step(a: number) { if (a) { if (a > 1) { if (a > 2) { if (a > 3) { if (a > 4) { return 1; } } } } } return u(); }
}
function helper(x: number) { return x; }
function helper(x: string) { return x; }
`;

const ctx = (project: Project, changed?: string[]): InsightContext => ({
  churn: new Map([["src/m.ts", { commits: 2, added: 1, deleted: 0, authors: 1, lastChange: 0, weekly: [] }]]),
  dependents: project.dependents(project.files("all")),
  baseRef: "HEAD",
  changed: changed && new Set(changed),
});

test("summary of a changed file: problems against the last commit, baseline and context load", () => {
  const root = gitRepo({ "src/a.ts": SIMPLE, "src/b.ts": 'import { f } from "./a";\nexport const g = () => f(1);\n' });
  fs.writeFileSync(path.join(root, "src/a.ts"), COMPLEX);
  const p = new Project(root);
  const s = summarize(p, "src/a.ts", ctx(p))!;
  assert.equal(s.verdict, "FIX");
  assert.equal(s.reason, "your change made it worse");
  assert.equal(s.cognitiveBefore, 0);
  assert.ok(s.cognitive > 15);
  assert.equal(s.worstFunction, "f");
  assert.equal(s.coupling.ca, 1, "src/b.ts imports it");
  assert.ok(s.problems.some((x) => x.status === "regression" && x.fn === "f"));
  assert.equal(s.contextTokens, p.contextBreakdown("src/a.ts").total);
  assert.equal(s.churn.commits, 0, "no churn entry: empty churn");
  assert.equal(summarize(p, "src/missing.ts", ctx(p)), undefined);
});

test("unchanged files are compared with themselves (fast path): no regressions, same baseline", () => {
  const root = gitRepo({ "src/a.ts": SIMPLE });
  fs.writeFileSync(path.join(root, "src/a.ts"), COMPLEX); // changed on disk, but not in `changed`
  const p = new Project(root);
  const s = summarize(p, "src/a.ts", ctx(p, []))!;
  assert.equal(s.problems.length, 0);
  assert.equal(s.cognitiveBefore, s.cognitive);
  assert.notEqual(s.verdict, "OK", "still over the limits");
  assert.equal(summarize(p, "src/missing.ts", ctx(p, [])), undefined);
});

test("detail: functions worst first, over flags, calls / called by, before values and imports", () => {
  const root = gitRepo({ "src/m.ts": METHODS.replace("if (a > 4) { return 1; }", "return 1;"), "src/u.ts": "export const u = () => 1;\n", "src/c.ts": 'import "./m";\n' });
  fs.writeFileSync(path.join(root, "src/m.ts"), METHODS);
  const p = new Project(root);
  const d = detail(p, "src/m.ts", ctx(p))!;
  assert.equal(d.functions[0].key, "Parser.step");
  assert.equal(d.functions[0].over, true);
  assert.ok(d.functions.slice(1).every((f) => !f.over));
  const fn = (key: string) => d.functions.find((f) => f.key === key)!;
  assert.deepEqual(fn("Parser.parse").calls.sort(), ["Parser.step", "helper", "helper#2"]);
  assert.deepEqual(fn("Parser.step").calledBy, ["Parser.parse"]);
  assert.deepEqual(fn("helper").calledBy, ["Parser.parse"]);
  assert.ok(fn("Parser.step").before!.nesting < fn("Parser.step").nesting);
  assert.equal(fn("Parser.parse").before?.parameters, 2);
  assert.deepEqual(d.internalImports, ["src/u.ts"]);
  assert.equal(d.externalImports, 1);
  assert.deepEqual(d.dependents, ["src/c.ts"]);
  assert.equal(d.churn.commits, 2);
  assert.ok(d.before && d.before.nesting < d.nesting);
  assert.equal(d.before?.contextTokens, d.context.fromImports + p.baselineMetrics("src/m.ts")!.fileTokens);
  assert.equal(d.context.importsAdvice, undefined);
  assert.equal(detail(p, "src/missing.ts", ctx(p)), undefined);
});

test("detail: imports that dominate an over-limit context load get their own advice", () => {
  const big = `export const data = ${JSON.stringify(Array.from({ length: 300 }, (_, i) => `v${i}`))};\n`;
  const root = folder({ "a.ts": 'import { data } from "./data";\nexport const a = () => data;\n', "data.ts": big, "complexity-lens.json": '{ "limits": { "contextTokens": 100 } }' });
  const p = new Project(root, { useGit: false });
  const d = detail(p, "a.ts", { churn: new Map(), dependents: new Map(), baseRef: "HEAD" })!;
  assert.ok(d.overLimits.includes("contextTokens"));
  assert.match(d.context.importsAdvice ?? "", /largest: data\.ts/);
  assert.equal(d.before, undefined, "no git: no baseline");
});
