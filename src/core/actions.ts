// Text produced by the action buttons: AI prompts, ticket drafts, chores, PR summaries.
// Plain text / Markdown with no product-specific format, so it can be pasted anywhere.

import type { FileDetail, FileSummary, FunctionDetail } from "./insights";
import { METRIC_LABEL } from "./evaluate";

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : `${n}`);

const RULES =
  "Rules: don't change behaviour; keep all existing tests passing; no new dependencies; " +
  "every function you touch must end within the limits below.";

function limitsLine(d: FileSummary): string {
  const L = d.limits;
  const parts = [
    L.cognitiveComplexity !== null
      ? `cognitive ≤ ${L.cognitiveComplexity}`
      : "",
    L.cyclomaticComplexity !== null
      ? `cyclomatic ≤ ${L.cyclomaticComplexity}`
      : "",
    L.nestingDepth !== null ? `nesting ≤ ${L.nestingDepth}` : "",
    L.functionLines !== null ? `≤ ${L.functionLines} lines per function` : "",
    L.parameters !== null ? `≤ ${L.parameters} parameters` : "",
  ];
  return `Limits: ${parts.filter(Boolean).join(", ")}.`;
}

function functionProblem(f: FunctionDetail, d: FileSummary): string {
  const L = d.limits;
  const m = [
    `cognitive ${f.cognitive}${L.cognitiveComplexity !== null ? ` (limit ${L.cognitiveComplexity})` : ""}`,
    `cyclomatic ${f.cyclomatic}${L.cyclomaticComplexity !== null ? ` (limit ${L.cyclomaticComplexity})` : ""}`,
    `nesting ${f.nesting}${L.nestingDepth !== null ? ` (limit ${L.nestingDepth})` : ""}`,
    `${f.lines} lines`,
    `${f.parameters} parameter${f.parameters === 1 ? "" : "s"}`,
  ];
  return m.join(", ");
}

const hotLines = (f: FunctionDetail) =>
  [...f.hotspots]
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((h) => `the ${h.kind} at line ${h.line} (+${h.points})`)
    .join(", ");

export function functionFixPrompt(d: FileDetail, f: FunctionDetail): string {
  return [
    `Refactor \`${f.key}\` in ${d.path} (lines ${f.line}–${f.endLine}).`,
    `Problem: ${functionProblem(f, d)}.`,
    f.hotspots.length ? `Where the complexity is: ${hotLines(f)}.` : "",
    f.advice.length ? `Suggested: ${f.advice.join(" ")}` : "",
    RULES,
    limitsLine(d),
  ]
    .filter(Boolean)
    .join("\n");
}

function splitText(d: FileDetail): string {
  if (!d.split) return "";
  const parts = d.split.parts.map(
    (p) =>
      `${p.file} (${p.members.slice(0, 6).join(", ")}${p.members.length > 6 ? ", …" : ""})`,
  );
  return `Split the file into: ${parts.join("; ")}. That makes the file itself about ${k(d.split.savesTokens)} tokens smaller (imports not included).`;
}

const importsText = (d: FileDetail) => (d.context.importsAdvice ? `Context load: ${d.context.importsAdvice}.` : "");

export function fileFixPrompt(d: FileDetail): string {
  const bad = d.functions.filter((f) => f.over).slice(0, 5);
  return [
    `Refactor ${d.path} to make it easier to work on.`,
    `Why: ${d.why}`,
    d.overLimits.length
      ? `Over the limits: ${d.overLimits.map((m) => METRIC_LABEL[m]).join(", ")}.`
      : "",
    bad.length
      ? `Functions to simplify:\n${bad.map((f) => `- ${f.key} (line ${f.line}): ${functionProblem(f, d)}. ${f.advice.join(" ")}`).join("\n")}`
      : "",
    splitText(d),
    importsText(d),
    "Update imports in the files that depend on it.",
    RULES,
    limitsLine(d),
  ]
    .filter(Boolean)
    .join("\n");
}

const size = (d: FileDetail) =>
  d.lines > 800 || d.functions.filter((f) => f.over).length > 4
    ? "L"
    : d.lines > 300 || d.split
      ? "M"
      : "S";

function problemLines(d: FileDetail): string[] {
  const lines = [
    `- Changed ${d.churn.commits}× recently by ${d.churn.authors} author(s); ${d.coupling.ca} file(s) depend on it.`,
    `- Agents read about ${k(d.contextTokens)} tokens per edit (file ${k(d.context.own)} + imports ${k(d.context.fromImports)}).`,
    `- Hardest function: ${d.worstFunction ?? "-"} (cognitive ${d.cognitive}, cyclomatic ${d.cyclomatic}, nesting ${d.nesting}).`,
  ];
  if (d.lcom > 1) lines.push(`- Cohesion LCOM ${d.lcom}: the file does ${d.lcom} unrelated jobs.`);
  return lines;
}

function approachLines(d: FileDetail): string[] {
  const lines = d.split ? [`- ${splitText(d)}`] : [];
  if (importsText(d)) lines.push(`- ${importsText(d)}`);
  for (const f of d.functions.filter((x) => x.over).slice(0, 5)) lines.push(`- Simplify \`${f.key}\`: ${f.advice[0] ?? "reduce branching and nesting"}`);
  return lines.length ? lines : ["- Reduce the metrics that are over their limits (see Problem)."];
}

function criteriaLines(d: FileDetail): string[] {
  const L = d.limits;
  const lines: string[] = [];
  if (L.cognitiveComplexity !== null) lines.push(`- No function over cognitive ${L.cognitiveComplexity}${L.nestingDepth !== null ? ` or nesting ${L.nestingDepth}` : ""}.`);
  if (L.fileTokens !== null) lines.push(`- Each resulting file ≤ ${k(L.fileTokens)} tokens.`);
  lines.push("- Behaviour unchanged; all existing tests pass.");
  return lines;
}

export function ticketDraft(d: FileDetail): string {
  const label = d.verdict === "FIX" ? d.reason : d.verdict.toLowerCase();
  return [
    `# Reduce complexity of ${d.path.split("/").pop()} (${label})`,
    "",
    `File: \`${d.path}\``,
    "",
    "## Problem",
    ...problemLines(d),
    "",
    "## Proposed approach",
    ...approachLines(d),
    "",
    "## Acceptance criteria",
    ...criteriaLines(d),
    "",
    `Size: ${size(d)}`,
  ].join("\n");
}

export function chore(d: FileDetail, f?: FunctionDetail): string {
  if (f)
    return `Chore: simplify \`${f.key}\` in ${d.path} (line ${f.line}): ${f.advice[0] ?? functionProblem(f, d)}`;
  return `Chore: tidy ${d.path}: ${d.split ? splitText(d) : (d.functions.find((x) => x.over)?.advice[0] ?? d.why)}`;
}

export function fixAllPrompt(items: FileSummary[]): string {
  const lines = items.flatMap((s) =>
    s.problems.map((p) => `- ${s.path} line ${p.line}: ${p.text}`),
  );
  return [
    "These changes made the code harder to work with. Fix each one before the pull request:",
    ...lines,
    RULES,
    items[0] ? limitsLine(items[0]) : "",
    'If one is genuinely necessary, add "// complexity-ok: <reason>" above that function instead.',
  ]
    .filter(Boolean)
    .join("\n");
}

export function prSummary(items: FileSummary[]): string {
  const problems = items.reduce((n, s) => n + s.problems.length, 0);
  const improved = items.flatMap((s) =>
    s.notes.filter((n) => n.status === "improved"),
  );
  const accepted = items.flatMap((s) =>
    s.notes.filter((n) => n.status === "allowed"),
  );
  return [
    "**Complexity**",
    problems
      ? `- ${problems} item(s) got more complex:`
      : "- No function or file got more complex.",
    ...items.flatMap((s) => s.problems.map((p) => `  - ${s.path}: ${p.text}`)),
    improved.length
      ? `- ${improved.length} improvement(s): ${improved.map((i) => i.text).join("; ")}`
      : "",
    accepted.length
      ? `- ${accepted.length} accepted with a reason in the code.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function choreList(items: FileSummary[]): string {
  return items
    .map((s, i) => `${i + 1}. [${s.verdict}] ${s.path}: ${s.reason}. ${s.why}`)
    .join("\n");
}
