// Design rules added to the AI prompts, ticket drafts and chores. The metric limits catch
// symptoms; these keep the AI from gaming them (moving code around, wrapping branches,
// bundling parameters) instead of fixing the design.

export const NO_GAMING =
  "Don't game the metrics: no one-line wrappers used once, no parameter objects only to cut the parameter count, no helpers that each re-check the same condition. Total complexity must go down, not just move.";

/** Each design rule in full (fix prompts) and, when it belongs in a ticket, in short (design notes). */
const RULES: { long: string; short?: string }[] = [
  { long: "Follow the repo's own conventions first (lint config, contributing or agent guides)." },
  {
    long: "Fix the design, don't just move code. Split by responsibility: each function and file has one reason to change.",
    short: "Split by responsibility, not by line count; don't just move code into more files.",
  },
  {
    long: "DRY: one source of truth. If the same condition or if/else chain on one value (a type, kind, mode) appears in more than one place, replace it with one lookup table or strategy map. Share identical data; don't copy it.",
    short: "DRY: replace repeated if/else chains on the same value with one lookup table or strategy map.",
  },
  {
    long: "KISS: the simplest correct version wins. Add a fast path for the common case; use guard clauses and early returns instead of nested if/else.",
    short: "KISS: fast path for the common case, guard clauses instead of nesting.",
  },
  {
    long: "YAGNI: no new options, generic helpers, layers or abstractions the current code doesn't need.",
    short: "YAGNI: no abstractions, options or helpers the current code doesn't need.",
  },
  {
    long: "Efficiency: make decisions that don't change inside a loop once, before it. Don't re-parse or recompute values in loops or sort comparators (precompute them). Don't process the same input twice. Use a Set or Map instead of chained comparisons. Never make the algorithm slower.",
    short: "Efficiency: hoist loop-invariant decisions, precompute instead of re-parsing, never make the algorithm slower.",
  },
  { long: NO_GAMING, short: "Don't game the limits with one-use wrappers or parameter objects." },
];

const bullets = (lines: readonly string[]) => lines.map((g) => `- ${g}`);

const PROCESS = [
  "Before editing, state the plan in 3–5 lines: responsibilities, what goes where, which pattern. After, list before/after metrics for each function you touched.",
  "Prove there is no behaviour change: if the code lacks tests, first add tests that pin the current behaviour (edge cases included), then refactor.",
];

/** Design rules plus the repo's own extra guidelines (setting complexityLens.fixPromptGuidelines). */
export const guidance = (extra: readonly string[]): string[] => [
  "Design first. The limits are a check, not the goal:",
  ...bullets(RULES.map((r) => r.long)),
  ...bullets(extra),
  ...PROCESS,
];

/** The short design rules for ticket drafts, plus the repo's own guidelines. */
export const designNoteLines = (extra: readonly string[]): string[] =>
  bullets([...RULES.flatMap((r) => (r.short ? [r.short] : [])), ...extra]);

export const CHORE_SUFFIX = " Keep it DRY and simple, decide once outside loops, no behaviour change.";
export const sentence = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);
