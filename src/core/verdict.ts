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
import { Finding, isProblem } from "./evaluate";
import { formatTokens } from "./format";
import { fileValue, isAllowed, isOver, METRICS } from "./limits";

export const VERDICTS = ["FIX", "PLAN", "LEAVE", "OK"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** The reason shown for each verdict, and what it means (tooltips, group headings, help). */
export const VERDICT_TEXT: Record<Verdict, { reason: string; meaning: string }> = {
  FIX: { reason: "hotspot: complex and changed often", meaning: "your change made it worse, or a hotspot (complex and changed often)" },
  PLAN: { reason: "over the limits, changed sometimes", meaning: "over the limits and changed sometimes: worth a ticket" },
  LEAVE: { reason: "complex but stable", meaning: "complex but rarely changed: not worth refactoring now" },
  OK: { reason: "within the limits", meaning: "within the limits" },
};
/** The FIX reason when the current change made the file worse. */
export const REGRESSED_REASON = "your change made it worse";

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
  const fns = m.functions.filter((f) => !isAllowed(f, s));
  const value = (metric: (typeof METRICS)[number]): number | undefined =>
    metric.scope === "function" ? Math.max(0, ...fns.map((f) => f[metric.key])) : fileValue(m, metric.key, s, ctx);
  return METRICS.filter((metric) => isOver(value(metric), s.limits[metric.key])).map((metric) => metric.key);
}

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
    parts.push(`Every AI edit reads about ${formatTokens(contextTokensOf(m, context))} tokens.`);
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

function verdictOf(regressed: boolean, over: boolean, commits: number, v: Config["verdicts"]): Verdict {
  if (regressed) return "FIX";
  if (!over) return "OK";
  if (commits >= v.fixCommits) return "FIX";
  return commits >= v.planCommits ? "PLAN" : "LEAVE";
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
  const verdict = verdictOf(regressed, over.length > 0, commits, config.verdicts);
  return { ...base, verdict, reason: regressed ? REGRESSED_REASON : VERDICT_TEXT[verdict].reason };
}
