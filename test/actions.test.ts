import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  chore,
  fileFixPrompt,
  fixAllPrompt,
  functionFixPrompt,
  ticketDraft,
} from "../src/core/actions";
import type { FileDetail, FunctionDetail } from "../src/core/insights";

const fn: FunctionDetail = {
  key: "parseRow",
  line: 10,
  endLine: 60,
  cognitiveComplexity: 20,
  cyclomaticComplexity: 12,
  nestingDepth: 4,
  functionLines: 50,
  parameters: 2,
  over: true,
  hotspots: [],
  calls: [],
  calledBy: [],
  advice: ["Use guard clauses"],
};

const detail = {
  path: "src/a.ts",
  verdict: "FIX",
  reason: "hard to change",
  why: "It is changed often",
  fileLines: 400,
  cognitiveComplexity: 20,
  cyclomaticComplexity: 12,
  nestingDepth: 4,
  worstFunction: "parseRow",
  lcom: 1,
  contextTokens: 5000,
  churn: { commits: 9, authors: 3 },
  coupling: { ca: 4, ce: 2, instability: 0.3 },
  limits: {
    cognitiveComplexity: 8,
    cyclomaticComplexity: 10,
    nestingDepth: 3,
    functionLines: 40,
    parameters: 3,
    fileTokens: 4000,
  },
  overLimits: [],
  problems: [{ line: 10, text: "parseRow got more complex" }],
  notes: [],
  context: { own: 3000, fromImports: 2000, imports: [], ignored: [] },
  functions: [fn],
} as unknown as FileDetail;

const DESIGN_MARKERS = [
  "DRY",
  "KISS",
  "YAGNI",
  "Don't game the metrics",
  "before it",
  "Before editing, state the plan",
];

test("fix prompts carry the design rules and the repo's own guidelines", () => {
  const prompts = [
    functionFixPrompt(detail, fn, ["Follow AGENTS.md"]),
    fileFixPrompt(detail, ["Follow AGENTS.md"]),
    fixAllPrompt([detail], ["Follow AGENTS.md"]),
  ];
  for (const p of prompts) {
    for (const m of DESIGN_MARKERS) assert.ok(p.includes(m), `missing "${m}"`);
    assert.ok(p.includes("- Follow AGENTS.md"));
    assert.ok(
      p.indexOf("DRY") < p.indexOf("Rules:"),
      "design rules come before the limits",
    );
  }
});

test("fix prompts work without extra guidelines", () => {
  const p = fileFixPrompt(detail);
  assert.ok(p.includes("YAGNI"));
  assert.ok(!p.includes("- \n"));
});

test("ticket draft has design notes and design acceptance criteria", () => {
  const t = ticketDraft(detail, ["Follow AGENTS.md"]);
  assert.ok(t.includes("## Design notes"));
  assert.ok(t.indexOf("## Design notes") < t.indexOf("## Acceptance criteria"));
  assert.ok(t.includes("- Follow AGENTS.md"));
  assert.ok(t.includes("No duplicated logic or data introduced"));
  assert.ok(t.includes("Total complexity of the touched code goes down"));
});

test("chore stays one line, ends with the short design reminder and no double period", () => {
  for (const c of [chore(detail, fn), chore(detail)]) {
    assert.ok(!c.includes("\n"));
    assert.ok(c.endsWith("no behaviour change."));
    assert.ok(!c.includes(".."));
  }
});
