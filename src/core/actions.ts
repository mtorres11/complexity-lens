// Text produced by the action buttons: AI fix prompts, ticket drafts and chores.
// Plain text / Markdown with no product-specific format, so it can be pasted anywhere.

import type { FileDetail, FileSummary, FunctionDetail } from "./insights";
import { allowCommentText } from "./config";
import { formatTokens as k } from "./format";
import { CHORE_SUFFIX, designNoteLines, guidance, sentence } from "./guidance";
import { FUNCTION_METRICS, functionMetricsText, METRIC } from "./limits";

const RULES =
  "Rules: don't change behaviour; keep all existing tests passing; no new dependencies; " +
  "every function you touch must end within the limits below.";

function limitsLine(d: FileSummary): string {
  const parts = FUNCTION_METRICS.flatMap((m) => (d.limits[m.key] === null ? [] : [`${m.short} ≤ ${d.limits[m.key]}`]));
  return `Limits: ${parts.join(", ")}.`;
}

const functionProblem = (f: FunctionDetail, d: FileSummary): string => functionMetricsText(f, d.limits);

const hotLines = (f: FunctionDetail) =>
  [...f.hotspots]
    .sort((a, b) => b.points - a.points)
    .slice(0, 3)
    .map((h) => `the ${h.kind} at line ${h.line} (+${h.points})`)
    .join(", ");

export function functionFixPrompt(
  d: FileDetail,
  f: FunctionDetail,
  extra: readonly string[] = [],
): string {
  return [
    `Refactor \`${f.key}\` in ${d.path} (lines ${f.line}–${f.endLine}).`,
    `Problem: ${functionProblem(f, d)}.`,
    f.hotspots.length ? `Where the complexity is: ${hotLines(f)}.` : "",
    f.advice.length ? `Suggested: ${f.advice.join(" ")}` : "",
    ...guidance(extra),
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

export function fileFixPrompt(d: FileDetail, extra: readonly string[] = []): string {
  const bad = d.functions.filter((f) => f.over).slice(0, 5);
  return [
    `Refactor ${d.path} to make it easier to work on.`,
    `Why: ${d.why}`,
    d.overLimits.length
      ? `Over the limits: ${d.overLimits.map((m) => METRIC[m].label).join(", ")}.`
      : "",
    bad.length
      ? `Functions to simplify:\n${bad.map((f) => `- ${f.key} (line ${f.line}): ${functionProblem(f, d)}. ${f.advice.join(" ")}`).join("\n")}`
      : "",
    splitText(d),
    importsText(d),
    "Update imports in the files that depend on it.",
    ...guidance(extra),
    RULES,
    limitsLine(d),
  ]
    .filter(Boolean)
    .join("\n");
}

const size = (d: FileDetail) =>
  d.fileLines > 800 || d.functions.filter((f) => f.over).length > 4
    ? "L"
    : d.fileLines > 300 || d.split
      ? "M"
      : "S";

function problemLines(d: FileDetail): string[] {
  const lines = [
    `- Changed ${d.churn.commits}× recently by ${d.churn.authors} author(s); ${d.coupling.ca} file(s) depend on it.`,
    `- Agents read about ${k(d.contextTokens)} tokens per edit (file ${k(d.context.own)} + imports ${k(d.context.fromImports)}).`,
    `- Hardest function: ${d.worstFunction ?? "-"} (cognitive ${d.cognitiveComplexity}, cyclomatic ${d.cyclomaticComplexity}, nesting ${d.nestingDepth}).`,
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
  const fnLimits = FUNCTION_METRICS.flatMap((m) => (L[m.key] === null ? [] : [`${m.short} ≤ ${L[m.key]}`]));
  if (fnLimits.length) lines.push(`- Every function within: ${fnLimits.join(", ")}.`);
  if (L.fileTokens !== null) lines.push(`- Each resulting file ≤ ${k(L.fileTokens)} tokens.`);
  lines.push(
    "- No duplicated logic or data introduced; each decision on a type/kind/mode lives in one place.",
    "- Decisions that don't change inside a loop are made before it; no re-parsing in loops or comparators.",
    "- Total complexity of the touched code goes down, not just the per-function maximum.",
    "- Behaviour unchanged, proven by tests (add tests that pin current behaviour first if coverage is missing); all existing tests pass.",
  );
  return lines;
}

export function ticketDraft(d: FileDetail, extra: readonly string[] = []): string {
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
    "## Design notes",
    ...designNoteLines(extra),
    "",
    "## Acceptance criteria",
    ...criteriaLines(d),
    "",
    `Size: ${size(d)}`,
  ].join("\n");
}

export function chore(d: FileDetail, f?: FunctionDetail): string {
  if (f)
    return `Chore: simplify \`${f.key}\` in ${d.path} (line ${f.line}): ${sentence(f.advice[0] ?? functionProblem(f, d))}${CHORE_SUFFIX}`;
  const what = d.split ? splitText(d) : (d.functions.find((x) => x.over)?.advice[0] ?? d.why);
  return `Chore: tidy ${d.path}: ${sentence(what)}${CHORE_SUFFIX}`;
}

/** The allow comment(s) the files use, e.g. "// complexity-ok: <reason>". */
const acceptComments = (items: FileSummary[]) =>
  [...new Set(items.map((s) => s.allowMarker))].map((m) => `"${allowCommentText(m, "<reason>")}"`).join(" or ");

export function fixAllPrompt(items: FileSummary[], extra: readonly string[] = []): string {
  const lines = items.flatMap((s) =>
    s.problems.map((p) => `- ${s.path} line ${p.line}: ${p.text}`),
  );
  return [
    "These changes made the code harder to work with. Fix each one before the pull request:",
    ...lines,
    ...guidance(extra),
    RULES,
    items[0] ? limitsLine(items[0]) : "",
    items.length ? `If one is genuinely necessary, add ${acceptComments(items)} above that function instead.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
