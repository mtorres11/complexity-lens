// Output formats: plain text, GitHub annotations, JSON.

import { describe, Finding, hintFor, isProblem } from "../core/evaluate";

export function groupByPath(findings: Finding[]): Map<string, Finding[]> {
  const out = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = out.get(f.path) ?? [];
    list.push(f);
    out.set(f.path, list);
  }
  return out;
}

export function text(findings: Finding[]): string {
  const problems = findings.filter(isProblem);
  if (!problems.length) return "Complexity Lens: no problems found.";
  const lines = [`Complexity Lens: ${problems.length} problem(s)`];
  for (const [p, list] of groupByPath(problems)) {
    lines.push(`  ${p}`);
    for (const f of list) lines.push(`    ✖ line ${f.line}  ${describe(f)}`);
  }
  return lines.join("\n");
}

// GitHub Actions workflow commands: escape per the documented rules.
const escData = (s: string) =>
  s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escProp = (s: string) =>
  escData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

export function github(
  findings: Finding[],
  level: "warning" | "error",
): string {
  return findings
    .filter(isProblem)
    .map(
      (f) =>
        `::${level} file=${escProp(f.path)},line=${f.line},title=${escProp("Complexity Lens")}::${escData(`${describe(f)}. Tip: ${hintFor(f)}.`)}`,
    )
    .join("\n");
}

export function json(findings: Finding[]): string {
  return JSON.stringify(
    { problems: findings.filter(isProblem), all: findings },
    null,
    2,
  );
}

/** Message the agent reads. Short, specific, with one concrete hint per metric. */
export function agentMessage(
  findings: Finding[],
  header: string,
  footer: string,
): string {
  const problems = findings.filter(isProblem);
  const lines = [header];
  for (const [p, list] of groupByPath(problems)) {
    lines.push(`  ${p}`);
    for (const f of list) lines.push(`    ✖ line ${f.line}  ${describe(f)}`);
  }
  const hints = [...new Set(problems.map(hintFor))];
  if (hints.length) {
    lines.push("  How to fix:");
    for (const hint of hints) lines.push(`    - ${hint}`);
  }
  lines.push(footer);
  return lines.join("\n");
}
