// Concrete suggestions for simplifying a function.

import type { FunctionMetrics, Increment } from "./analyze";
import type { FileSettings } from "./config";
import { isOver } from "./limits";

/** Points inside an increment's line range (including itself): what extracting it would remove. */
function weight(inc: Increment, all: Increment[]): number {
  return all
    .filter((o) => o.line >= inc.line && o.endLine <= inc.endLine)
    .reduce((n, o) => n + o.points, 0);
}

/** The block worth extracting: the biggest nested chunk that isn't the whole function. */
function hottestBlock(
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

/** Each rule looks at one aspect and returns a suggestion, or nothing. */
const RULES: Rule[] = [
  (fn, L) => {
    const hot = hottestBlock(fn);
    if (!hot || !isOver(fn.cognitiveComplexity, L.cognitiveComplexity)) return undefined;
    return `Move lines ${hot.inc.line}–${hot.inc.endLine} (the ${hot.inc.kind}) into its own function: about −${hot.points} cognitive.`;
  },
  (fn, L) => {
    const sw = fn.increments.find((i) => i.kind === "switch");
    return sw && isOver(fn.cognitiveComplexity, L.cognitiveComplexity) ? `Replace the switch at line ${sw.line} with a lookup table or a map of handlers.` : undefined;
  },
  (fn, L) => (isOver(fn.nestingDepth, L.nestingDepth) ? "Flatten the nesting with early returns (guard clauses)." : undefined),
  (fn, L) => {
    const logical = fn.increments.filter((i) => i.kind === "&&" || i.kind === "||" || i.kind === "??").length;
    return isOver(fn.cyclomaticComplexity, L.cyclomaticComplexity) && logical >= 3
      ? `Reduce the ${logical} boolean conditions: when they test the same value (a type, kind or mode), use one lookup (a Set or Map); extract a condition only when it is reused or not obvious.`
      : undefined;
  },
  (fn, L) => (isOver(fn.parameters, L.parameters) ? `Pass fewer than ${fn.parameters} things: split the function, or pass the object the values come from.` : undefined),
  (fn, L) => (isOver(fn.functionLines, L.functionLines) ? "Split it into smaller functions that each do one job." : undefined),
];

export function functionAdvice(fn: FunctionMetrics, s: FileSettings): string[] {
  return RULES.map((r) => r(fn, s.limits))
    .filter((x): x is string => !!x)
    .slice(0, 4);
}
