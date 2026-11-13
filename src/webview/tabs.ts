// Project screens: "Your change" (is my change OK?) and "What to fix" (ranked FIX / PLAN / LEAVE).
// Both have a search box: type part of a path, or pick a file, to see only its items.

import type { FileSummary } from "../core/insights";
import { button, fmtTokens, h, link, select, send } from "./dom";
import { fileHeader, itemList } from "./cards";
import { fileFixes } from "./fixes";
import { searchBox } from "./search";
import { filteredFile, matchesFilter, state, toggle } from "./state";

const actions = (r: FileSummary, extra: HTMLElement[] = []) =>
  h(
    "div",
    { class: "actions" },
    button(
      "✨ Fix with AI",
      () => send({ type: "action", kind: "fixPrompt", path: r.path }),
      { title: "Copy a prompt for your AI agent" },
    ),
    ...extra,
  );

function changeItem(r: FileSummary): HTMLElement {
  const fn = r.problems.find((p) => p.fn)?.fn;
  return h(
    "div",
    { class: "card v-fix-edge" },
    fileHeader(r),
    itemList(r.path, r.problems),
    h("div", { class: "why" }, r.why),
    actions(r, [
      button(
        "Accept…",
        () => send({ type: "action", kind: "accept", path: r.path, fn }),
        { title: "Keep it as is, with a reason in the code" },
      ),
    ]),
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
      `${commits}${r.coupling.ca} depend on it · ≈${fmtTokens(r.contextTokens)} tokens per edit · hardest function ${r.cognitive}`,
    ),
    h("div", { class: "why" }, r.reason),
    actions(r, [
      button("🎫 Ticket draft", () =>
        send({ type: "action", kind: "ticket", path: r.path }),
      ),
      button(
        "Ignore",
        () => send({ type: "action", kind: "ignore", path: r.path }),
        { title: "Hide it from this list (on this machine)" },
      ),
    ]),
  );
}

function group(
  key: string,
  title: string,
  note: string,
  rows: FileSummary[],
  openByDefault: boolean,
): HTMLElement[] {
  if (!rows.length && state.filter) return [];
  // While searching, every group with matches is open.
  const open = state.filter ? true : state.expanded.has(key) !== openByDefault;
  const headLine = h(
    "div",
    { class: "subhead", onclick: () => toggle(key) },
    `${open ? "▾" : "▸"} ${title} (${rows.length})`,
    h("span", { class: "muted" }, ` ${note}`),
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
    ...group(
      "todo:fix",
      "FIX",
      "complex and changed often, or made worse",
      fix,
      true,
    ),
    ...group(
      "todo:plan",
      "PLAN",
      "over the limits, changed sometimes",
      plan,
      false,
    ),
    ...group(
      "todo:leave",
      "LEAVE",
      "complex but stable: not worth it now",
      leave,
      false,
    ),
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
