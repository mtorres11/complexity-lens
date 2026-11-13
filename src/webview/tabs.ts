// Project screens: "Your change" (is my change OK?) and "What to fix" (ranked FIX / PLAN / LEAVE).

import type { FileSummary } from "../core/insights";
import { button, fmtTokens, h, link, select, send } from "./dom";
import { fileHeader, itemList } from "./cards";
import { state, toggle } from "./state";

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
    button("Open", () =>
      send({ type: "open", path: r.path, line: r.problems[0]?.line ?? 1 }),
    ),
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

function headline(bad: number, total: number): HTMLElement {
  if (bad) return h("div", { class: "headline warn" }, `⚠ ${bad} file(s) to fix before the PR`);
  return h("div", { class: "headline ok" }, total ? "✓ Your change didn't make anything more complex" : "No changes to check yet");
}

function changeFooter(items: FileSummary[], bad: number): HTMLElement | null {
  if (!items.length) return null;
  return h(
    "div",
    { class: "actions footer-actions" },
    button("✨ Fix all with AI", () => send({ type: "batch", kind: "fixAll" }), { disabled: !bad }),
    button("📋 Copy PR summary", () => send({ type: "batch", kind: "prSummary" })),
  );
}

function improvements(items: FileSummary[]): HTMLElement[] {
  const list = items.flatMap((r) => r.notes.filter((n) => n.status === "improved").map((n) => `${r.path}: ${n.text}`));
  if (!list.length) return [];
  return [h("div", { class: "subhead ok" }, `▼ ${list.length} improvement(s)`), ...list.map((t) => h("div", { class: "muted small" }, t))];
}

export function renderChange(): HTMLElement[] {
  const u = state.update;
  const c = u?.data.change;
  if (!u || !c) return [];
  const bad = c.items.filter((r) => r.problems.length);
  const fine = c.items.length - bad.length;
  const compare = select(c.compare, [["HEAD", "last commit"], ...u.refs.map((r): [string, string] => [r, r])], (v) => send({ type: "compare", value: v }));
  return [
    h("label", { class: "row" }, h("span", { class: "row-label" }, "Compared with"), compare),
    headline(bad.length, c.items.length),
    ...bad.map(changeItem),
    ...improvements(c.items),
    fine ? h("div", { class: "muted small" }, `✓ ${fine} other changed file(s) are fine`) : null,
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
  const open = state.expanded.has(key) !== openByDefault;
  const headLine = h(
    "div",
    { class: "subhead", onclick: () => toggle(key) },
    `${open ? "▾" : "▸"} ${title} (${rows.length})`,
    h("span", { class: "muted" }, ` ${note}`),
  );
  return [headLine, ...(open ? rows.map(todoItem) : [])];
}

export function renderTodo(): HTMLElement[] {
  const t = state.update?.data.todo;
  if (!t) return [];
  const ignored = t.ignored.length
    ? h(
        "div",
        { class: "muted small" },
        `${t.ignored.length} ignored: `,
        ...t.ignored
          .slice(0, 20)
          .flatMap((p) => [
            link(
              p.split("/").pop() ?? p,
              { type: "action", kind: "unignore", path: p },
              { title: `Show ${p} again` },
            ),
            " ",
          ]),
      )
    : null;
  return [
    ...group(
      "todo:fix",
      "FIX",
      "complex and changed often, or made worse",
      t.fix,
      true,
    ),
    ...group(
      "todo:plan",
      "PLAN",
      "over the limits, changed sometimes",
      t.plan,
      false,
    ),
    ...group(
      "todo:leave",
      "LEAVE",
      "complex but stable: not worth it now",
      t.leave,
      false,
    ),
    ignored,
    h(
      "div",
      { class: "actions footer-actions" },
      button(
        "🎫 Ticket drafts for top 5",
        () => send({ type: "batch", kind: "tickets" }),
        { disabled: !t.fix.length && !t.plan.length },
      ),
      button(
        "🧹 Chore list",
        () => send({ type: "batch", kind: "choreList" }),
        { disabled: !t.fix.length && !t.plan.length },
      ),
    ),
  ].filter((n): n is HTMLElement => !!n);
}
