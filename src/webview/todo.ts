// "What to fix": the repo ranked into FIX / PLAN / LEAVE. Type part of a path, or pick a file,
// to see only its items and its function-level fixes.

import { formatTokens } from "../core/format";
import type { FileSummary } from "../core/insights";
import { VERDICT_TEXT } from "../core/verdict";
import { actionButtons } from "./actions";
import { button, h, link } from "./dom";
import { send } from "./bridge";
import { fileHeader } from "./cards";
import { fileFixes } from "./fixes";
import { searchBox } from "./search";
import { filteredFile, matchesFilter, state, toggle } from "./state";

function todoItem(r: FileSummary, i: number): HTMLElement {
  const commits = r.churn.commits
    ? `Changed ${r.churn.commits}× by ${r.churn.authors} · `
    : "";
  return h(
    "div",
    { class: `card v-${r.verdict.toLowerCase()}-edge` },
    h("div", { class: "rank" }, `${i + 1}.`),
    fileHeader(r),
    h(
      "div",
      { class: "facts muted small" },
      `${commits}${r.coupling.ca} depend on it · ≈${formatTokens(r.contextTokens)} tokens per edit · hardest function ${r.cognitiveComplexity}`,
    ),
    h("div", { class: "why" }, r.reason),
    actionButtons(r.path, undefined, ["fixPrompt", "ticket", "ignore"]),
  );
}

/** A collapsible verdict group of "What to fix"; FIX is open by default. */
function group(verdict: "FIX" | "PLAN" | "LEAVE", rows: FileSummary[]): HTMLElement[] {
  if (!rows.length && state.filter) return [];
  const key = `todo:${verdict.toLowerCase()}`;
  // While searching, every group with matches is open.
  const open = state.filter ? true : state.expanded.has(key) !== (verdict === "FIX");
  const headLine = h(
    "div",
    { class: "subhead", onclick: () => toggle(key) },
    `${open ? "▾" : "▸"} ${verdict} (${rows.length})`,
    h("span", { class: "muted" }, ` ${VERDICT_TEXT[verdict].meaning}`),
  );
  return [headLine, ...(open ? rows.map(todoItem) : [])];
}

function ignoredLine(ignored: string[]): HTMLElement | null {
  if (!ignored.length) return null;
  const links = ignored
    .slice(0, 20)
    .flatMap((p) => [
      link(
        p.split("/").pop() ?? p,
        { type: "action", kind: "unignore", path: p },
        { title: `Show ${p} again` },
      ),
      " ",
    ]);
  return h(
    "div",
    { class: "muted small" },
    `${ignored.length} ignored: `,
    ...links,
  );
}

function todoFooter(
  fix: FileSummary[],
  plan: FileSummary[],
): HTMLElement | null {
  if (state.filter) return null;
  const none = !fix.length && !plan.length;
  return h(
    "div",
    { class: "actions footer-actions" },
    button(
      "🎫 Ticket drafts for top 5",
      () => send({ type: "batch", kind: "tickets" }),
      { disabled: none },
    ),
    button("🧹 Chore list", () => send({ type: "batch", kind: "choreList" }), {
      disabled: none,
    }),
  );
}

/** Shown when the search names one file: that file's own fixes, or a "nothing to fix" note. */
function singleFile(path: string, listed: boolean): HTMLElement[] {
  const note = listed
    ? null
    : h(
        "div",
        { class: "headline ok" },
        `✓ ${path.split("/").pop()} isn't on the list: it's within the limits, or ignored`,
      );
  return [note, ...fileFixes(path)].filter((n): n is HTMLElement => !!n);
}

export function renderTodo(): HTMLElement[] {
  const t = state.update?.data.todo;
  if (!t) return [];
  const all = [...t.fix, ...t.plan, ...t.leave];
  const pick = (rows: FileSummary[]) =>
    rows.filter((r) => matchesFilter(r.path));
  const [fix, plan, leave] = [pick(t.fix), pick(t.plan), pick(t.leave)];
  const one = filteredFile(all.map((r) => r.path));
  const nothing =
    state.filter && !one && !fix.length && !plan.length && !leave.length;
  return [
    searchBox(
      all.map((r) => r.path),
      "Search files to fix…",
    ),
    nothing
      ? h("div", { class: "empty muted" }, "No files to fix match the search.")
      : null,
    ...group("FIX", fix),
    ...group("PLAN", plan),
    ...group("LEAVE", leave),
    ...(one
      ? singleFile(
          one,
          all.some((r) => r.path === one),
        )
      : []),
    state.filter ? null : ignoredLine(t.ignored),
    todoFooter(t.fix, t.plan),
  ].filter((n): n is HTMLElement => !!n);
}
