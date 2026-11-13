import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { resolveConfig } from "../src/core/configParse";
import { agentMessage } from "../src/cli/format";
import { Project } from "../src/core/project";

const BIG_DATA = `export const data = ${JSON.stringify(Array.from({ length: 400 }, (_, i) => `value-${i}`))};\n`;
const ENTRY =
  'import { data } from "./data.examples";\nimport { util } from "./util";\nexport const first = () => data[0] + util();\n';
const UTIL = "export const util = () => 1;\n";

function repo(config?: object): Project {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cl-context-"));
  fs.writeFileSync(path.join(root, "entry.ts"), ENTRY);
  fs.writeFileSync(path.join(root, "data.examples.ts"), BIG_DATA);
  fs.writeFileSync(path.join(root, "util.ts"), UTIL);
  if (config)
    fs.writeFileSync(
      path.join(root, "complexity-lens.json"),
      JSON.stringify(config),
    );
  return new Project(root, { useGit: false });
}

test("tokens.ignoreImports: matching imports are listed but not counted", () => {
  const ctx = repo().contextBreakdown("entry.ts");
  assert.deepEqual(ctx.ignored, ["data.examples.ts"]);
  assert.deepEqual(
    ctx.imports.map((i) => i.path),
    ["util.ts"],
  );
  assert.equal(ctx.total, ctx.own + ctx.imports[0].tokens);
});

test("tokens.ignoreImports: an empty list counts every import", () => {
  const ctx = repo({ tokens: { ignoreImports: [] } }).contextBreakdown(
    "entry.ts",
  );
  assert.deepEqual(ctx.ignored, []);
  assert.deepEqual(
    ctx.imports.map((i) => i.path),
    ["data.examples.ts", "util.ts"],
  );
});

test("tokens.ignoreImports: invalid patterns are rejected", () => {
  const { errors } = resolveConfig({
    tokens: { ignoreImports: ["../outside/**"] },
  });
  assert.ok(errors.some((e) => e.startsWith("tokens.ignoreImports")));
});

test("context load made of imports: the hint names the largest import instead of 'split it'", () => {
  const project = repo({
    tokens: { ignoreImports: [] },
    limits: { contextTokens: 100 },
  });
  const finding = project
    .evaluate("entry.ts")
    .findings.find((f) => f.metric === "contextTokens");
  assert.ok(finding?.hint);
  assert.match(finding.hint, /largest: data\.examples\.ts/);
  assert.match(finding.hint, /won't lower it/);
  assert.match(
    agentMessage([finding], "header", "footer"),
    /largest: data\.examples\.ts/,
  );
});

test("context load mostly from the file itself keeps the generic hint", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cl-context-"));
  fs.writeFileSync(
    path.join(root, "own.ts"),
    `import { util } from "./util";\n${BIG_DATA}`,
  );
  fs.writeFileSync(path.join(root, "util.ts"), UTIL);
  fs.writeFileSync(
    path.join(root, "complexity-lens.json"),
    JSON.stringify({ limits: { contextTokens: 100 } }),
  );
  const finding = new Project(root, { useGit: false })
    .evaluate("own.ts")
    .findings.find((f) => f.metric === "contextTokens");
  assert.ok(finding);
  assert.equal(finding.hint, undefined);
});
