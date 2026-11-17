// Batch summaries for the change and the fix list: PR summary text and the chore list.

import type { FileSummary } from "./insights";

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
