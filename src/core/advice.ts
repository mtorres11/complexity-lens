// Concrete suggestions: how to simplify a function, and how to split a file.

import type { FileMetrics, FunctionMetrics, Increment } from "./analyze";
import type { FileSettings } from "./config";
import { judgedLcom } from "./evaluate";

/** Points inside an increment's line range (including itself): what extracting it would remove. */
function weight(inc: Increment, all: Increment[]): number {
  return all
    .filter((o) => o.line >= inc.line && o.endLine <= inc.endLine)
    .reduce((n, o) => n + o.points, 0);
}

/** The block worth extracting: the biggest nested chunk that isn't the whole function. */
export function hottestBlock(
  fn: FunctionMetrics,
): { inc: Increment; points: number } | undefined {
  let best: { inc: Increment; points: number } | undefined;
  for (const inc of fn.increments) {
    if (
      inc.endLine - inc.line < 2 ||
      (inc.line <= fn.line + 1 && inc.endLine >= fn.endLine - 1)
    )
      continue;
    const points = weight(inc, fn.increments);
    if (!best || points > best.points) best = { inc, points };
  }
  return best;
}

type Rule = (fn: FunctionMetrics, L: FileSettings["limits"]) => string | undefined;

const over = (v: number, l: number | null) => l !== null && v > l;

/** Each rule looks at one aspect and returns a suggestion, or nothing. */
const RULES: Rule[] = [
  (fn, L) => {
    const hot = hottestBlock(fn);
    if (!hot || !over(fn.cognitiveComplexity, L.cognitiveComplexity)) return undefined;
    return `Move lines ${hot.inc.line}–${hot.inc.endLine} (the ${hot.inc.kind}) into its own function: about −${hot.points} cognitive.`;
  },
  (fn, L) => {
    const sw = fn.increments.find((i) => i.kind === "switch");
    return sw && over(fn.cognitiveComplexity, L.cognitiveComplexity) ? `Replace the switch at line ${sw.line} with a lookup table or a map of handlers.` : undefined;
  },
  (fn, L) => (over(fn.nestingDepth, L.nestingDepth) ? "Flatten the nesting with early returns (guard clauses)." : undefined),
  (fn, L) => {
    const logical = fn.increments.filter((i) => i.kind === "&&" || i.kind === "||" || i.kind === "??").length;
    return over(fn.cyclomaticComplexity, L.cyclomaticComplexity) && logical >= 3 ? `Name the ${logical} boolean conditions as small helper functions (e.g. isEligible()).` : undefined;
  },
  (fn, L) => (over(fn.parameters, L.parameters) ? `Group the ${fn.parameters} parameters into one options object.` : undefined),
  (fn, L) => (over(fn.functionLines, L.functionLines) ? "Split it into smaller functions that each do one job." : undefined),
];

export function functionAdvice(fn: FunctionMetrics, s: FileSettings): string[] {
  return RULES.map((r) => r(fn, s.limits))
    .filter((x): x is string => !!x)
    .slice(0, 4);
}

export interface SplitPart {
  file: string;
  members: string[];
  tokens: number;
}

export interface SplitSuggestion {
  parts: SplitPart[];
  /** Tokens an agent no longer reads per edit (whole file minus the largest part). */
  savesTokens: number;
}

const STOP = new Set([
  "get",
  "set",
  "to",
  "from",
  "is",
  "has",
  "create",
  "build",
  "handle",
  "make",
  "on",
  "the",
  "with",
  "for",
  "of",
  "and",
  "new",
  "default",
  "init",
  "run",
  "do",
]);

const words = (name: string) =>
  name
    .replace(/^.*\./, "")
    .split(/(?=[A-Z])|[_\-\s]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 2 && !STOP.has(w));

/** A file name from the most common meaningful word in the members' names. */
function partName(
  members: string[],
  used: Set<string>,
  ext: string,
  index: number,
): string {
  const counts = new Map<string, number>();
  for (const w of members.flatMap(words))
    counts.set(w, (counts.get(w) ?? 0) + 1);
  const best = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0]?.[0];
  let name = `${best ?? `part${index + 1}`}${ext}`;
  if (used.has(name)) name = `${best ?? "part"}${index + 1}${ext}`;
  used.add(name);
  return name;
}

export function suggestSplit(
  m: FileMetrics,
  s: FileSettings,
): SplitSuggestion | undefined {
  const mod = m.cohesion.find((c) => c.scope === "module");
  if (!mod || mod.groups.length < 2) return undefined;
  const L = s.limits;
  const big =
    (L.fileLines !== null && m.fileLines > L.fileLines) ||
    (L.fileTokens !== null && m.fileTokens > L.fileTokens) ||
    (L.lcom !== null && judgedLcom(m, s) > L.lcom);
  if (!big) return undefined;
  const ext = (/\.[^.]+$/.exec(m.path) ?? [".ts"])[0];
  const used = new Set<string>();
  const parts = mod.groups
    .slice(0, 5)
    .map((g, i) => ({
      file: partName(g.members, used, ext, i),
      members: g.members,
      tokens: g.tokens,
    }));
  const largest = Math.max(...parts.map((p) => p.tokens));
  return { parts, savesTokens: Math.max(0, m.fileTokens - largest) };
}
