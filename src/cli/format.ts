// Output formats: plain text, GitHub annotations, JSON.

import { describe, Finding, hintFor, isProblem } from "../core/evaluate";

function groupByPath(findings: Finding[]): Map<string, Finding[]> {
  const out = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = out.get(f.path) ?? [];
    list.push(f);
    out.set(f.path, list);
  }
  return out;
}

/** Problems grouped by file: "  path" then "    ✖ line N  description" per problem. */
function problemLines(problems: Finding[]): string[] {
  return [...groupByPath(problems)].flatMap(([p, list]) => [`  ${p}`, ...list.map((f) => `    ✖ line ${f.line}  ${describe(f)}`)]);
}

export function text(findings: Finding[]): string {
  const problems = findings.filter(isProblem);
  if (!problems.length) return "Complexity Lens: no problems found.";
  return [`Complexity Lens: ${problems.length} problem(s)`, ...problemLines(problems)].join("\n");
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
  const lines = [header, ...problemLines(problems)];
  const hints = [...new Set(problems.map(hintFor))];
  if (hints.length) {
    lines.push("  How to fix:");
    for (const hint of hints) lines.push(`    - ${hint}`);
  }
  lines.push(footer);
  return lines.join("\n");
}
