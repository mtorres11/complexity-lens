// Turns measurements into a decision: FIX, PLAN, LEAVE or OK, with a reason and a payoff score.
//   FIX   - the current change made something worse, or a hotspot: over a limit and changed
//           at least verdicts.fixCommits times in hotspots.historyDays.
//   PLAN  - over a limit and changed at least verdicts.planCommits times.
//   LEAVE - over a limit but rarely changed: refactoring isn't worth it now.
//   OK    - within the limits.

import type { FileMetrics } from "./analyze";
import type { Churn } from "./churn";
import type { Config, FileSettings, LimitKey } from "./config";
import { ContextLoad, contextTokensOf } from "./context";
import { Finding, isProblem, judgedLcom } from "./evaluate";

export type Verdict = "FIX" | "PLAN" | "LEAVE" | "OK";

export interface Decision {
  verdict: Verdict;
  /** Short label, e.g. "your change made it worse", "hotspot". */
  reason: string;
  /** One or two sentences in plain language. */
  why: string;
  /** Higher = more worth fixing: (commits + 1) × (context k-tokens + worst cognitive) × (1 + log2(1 + dependents) / 2). */
  payoff: number;
  overLimits: LimitKey[];
}

/** Current values over their limits, ignoring functions accepted by the allow comment. */
export function overLimits(m: FileMetrics, s: FileSettings, ctx?: ContextLoad): LimitKey[] {
  const L = s.limits;
  const fns = m.functions.filter(
    (f) =>
      f.allowReason === undefined ||
      (s.allowComment.requireReason && !f.allowReason),
  );
  const worst = (
    k:
      | "cognitiveComplexity"
      | "cyclomaticComplexity"
      | "nestingDepth"
      | "functionLines"
      | "parameters",
  ) => Math.max(0, ...fns.map((f) => f[k]));
  const values: Partial<Record<LimitKey, number | undefined>> = {
    cognitiveComplexity: worst("cognitiveComplexity"),
    cyclomaticComplexity: worst("cyclomaticComplexity"),
    nestingDepth: worst("nestingDepth"),
    functionLines: worst("functionLines"),
    parameters: worst("parameters"),
    fileLines: m.fileLines,
    fileTokens: m.fileTokens,
    imports: m.imports,
    lcom: judgedLcom(m, s),
    contextTokens: ctx && contextTokensOf(m, ctx),
  };
  return (Object.keys(values) as LimitKey[]).filter((k) => {
    const v = values[k];
    const l = L[k];
    return v !== undefined && l !== null && v > l;
  });
}

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : `${n}`);

function why({ metrics: m, churn, ca, context }: DecideInput, regressed: boolean): string {
  const parts: string[] = [];
  if (regressed) parts.push("This change made it harder to work with.");
  if (churn && churn.commits > 0)
    parts.push(
      `Changed ${churn.commits}× recently${churn.authors > 1 ? ` by ${churn.authors} people` : ""}.`,
    );
  if (ca > 0)
    parts.push(
      `${ca} file${ca === 1 ? "" : "s"} depend on it, so mistakes spread.`,
    );
  if (context)
    parts.push(`Every AI edit reads about ${k(contextTokensOf(m, context))} tokens.`);
  const worst = [...m.functions].sort(
    (a, b) => b.cognitiveComplexity - a.cognitiveComplexity,
  )[0];
  if (worst && worst.cognitiveComplexity > 0)
    parts.push(
      `Hardest function: ${worst.key} (${worst.cognitiveComplexity}).`,
    );
  return parts.join(" ");
}

export interface DecideInput {
  metrics: FileMetrics;
  /** Findings against the baseline (problems mean the change made things worse). */
  findings: Finding[];
  churn?: Churn;
  /** Afferent coupling: files that import this one. */
  ca: number;
  /** Context load of the file (without it, payoff uses the file's own tokens). */
  context?: ContextLoad;
  config: Config;
  settings: FileSettings;
}

export function decide(input: DecideInput): Decision {
  const { metrics: m, findings, churn, ca, context, config, settings: s } = input;
  const over = overLimits(m, s, context);
  const commits = churn?.commits ?? 0;
  const worst = Math.max(0, ...m.functions.map((f) => f.cognitiveComplexity));
  const payoff = Math.round(
    (commits + 1) *
      ((context ? contextTokensOf(m, context) : m.fileTokens) / 1000 + worst) *
      (1 + Math.log2(1 + ca) / 2),
  );
  const regressed = findings.some(isProblem);
  const base = { payoff, overLimits: over, why: why(input, regressed) };
  if (regressed)
    return { ...base, verdict: "FIX", reason: "your change made it worse" };
  if (!over.length)
    return { ...base, verdict: "OK", reason: "within the limits" };
  if (commits >= config.verdicts.fixCommits)
    return {
      ...base,
      verdict: "FIX",
      reason: "hotspot: complex and changed often",
    };
  if (commits >= config.verdicts.planCommits)
    return {
      ...base,
      verdict: "PLAN",
      reason: "over the limits, changed sometimes",
    };
  return { ...base, verdict: "LEAVE", reason: "complex but stable" };
}
