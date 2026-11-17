// "Your change": is my change OK? Changed files compared with the last commit or a branch,
// with a search box to see one file only.

import type { FileSummary } from "../core/insights";
import { actionButton } from "./actions";
import { button, h, select, send } from "./dom";
import { fileHeader, itemList } from "./cards";
import { searchBox } from "./search";
import { matchesFilter, state } from "./state";

function changeItem(r: FileSummary): HTMLElement {
  const fn = r.problems.find((p) => p.fn)?.fn;
  return h(
    "div",
    { class: "card v-fix-edge" },
    fileHeader(r),
    itemList(r.path, r.problems),
    h("div", { class: "why" }, r.why),
    h("div", { class: "actions" }, actionButton("fixPrompt", r.path), actionButton("accept", r.path, fn)),
  );
}

function headline(bad: number, total: number, filtered: boolean): HTMLElement {
  if (bad)
    return h(
      "div",
      { class: "headline warn" },
      `⚠ ${bad} file(s) to fix before the PR`,
    );
  if (filtered)
    return h(
      "div",
      { class: "headline ok" },
      total
        ? "✓ Nothing got more complex in the matching files"
        : "No changed files match the search",
    );
  return h(
    "div",
    { class: "headline ok" },
    total
      ? "✓ Your change didn't make anything more complex"
      : "No changes to check yet",
  );
}

function changeFooter(items: FileSummary[], bad: number): HTMLElement | null {
  if (!items.length || state.filter) return null;
  return h(
    "div",
    { class: "actions footer-actions" },
    button(
      "✨ Fix all with AI",
      () => send({ type: "batch", kind: "fixAll" }),
      { disabled: !bad },
    ),
    button("📋 Copy PR summary", () =>
      send({ type: "batch", kind: "prSummary" }),
    ),
  );
}

function improvements(items: FileSummary[]): HTMLElement[] {
  const list = items.flatMap((r) =>
    r.notes
      .filter((n) => n.status === "improved")
      .map((n) => `${r.path}: ${n.text}`),
  );
  if (!list.length) return [];
  return [
    h("div", { class: "subhead ok" }, `▼ ${list.length} improvement(s)`),
    ...list.map((t) => h("div", { class: "muted small" }, t)),
  ];
}

export function renderChange(): HTMLElement[] {
  const u = state.update;
  const c = u?.data.change;
  if (!u || !c) return [];
  const items = c.items.filter((r) => matchesFilter(r.path));
  const bad = items.filter((r) => r.problems.length);
  const fine = items.length - bad.length;
  const compare = select(
    c.compare,
    [["HEAD", "last commit"], ...u.refs.map((r): [string, string] => [r, r])],
    (v) => send({ type: "compare", value: v }),
  );
  return [
    h(
      "label",
      { class: "row" },
      h("span", { class: "row-label" }, "Compared with"),
      compare,
    ),
    searchBox(
      c.items.map((r) => r.path),
      "Search changed files…",
    ),
    headline(bad.length, items.length, !!state.filter),
    ...bad.map(changeItem),
    ...improvements(items),
    fine
      ? h(
          "div",
          { class: "muted small" },
          `✓ ${fine} other changed file(s) are fine`,
        )
      : null,
    changeFooter(c.items, bad.length),
  ].filter((n): n is HTMLElement => !!n);
}
