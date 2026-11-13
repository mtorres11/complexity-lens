// DOM helpers for the sidebar. Everything is built with createElement/textContent (no innerHTML).
// The CSP blocks inline style attributes, so sizes are set through the CSSOM (el.style.*).

import type { FromWebview } from "../vscode/protocol";
import type { Verdict } from "../core/verdict";

declare function acquireVsCodeApi(): { postMessage(m: unknown): void };
const vscode = acquireVsCodeApi();

export const send = (m: FromWebview): void => vscode.postMessage(m);

type Child = Node | string | null | undefined | false;
type Attrs = Record<
  string,
  string | number | boolean | ((e: Event) => void) | undefined | null
>;

const isEmpty = (v: unknown) => v === undefined || v === null || v === false;

function setAttr(
  el: HTMLElement,
  k: string,
  v: NonNullable<Attrs[string]>,
): void {
  if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
  else if (k === "class") el.className = String(v);
  else if (k === "flex") el.style.flex = `${v} 1 0`;
  else if (k === "heightPct") el.style.height = `${v}%`;
  else el.setAttribute(k, v === true ? "" : String(v));
}

export function h(
  tag: string,
  attrs?: Attrs | null,
  ...kids: (Child | Child[])[]
): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {}))
    if (!isEmpty(v)) setAttr(el, k, v as NonNullable<Attrs[string]>);
  el.append(...(kids.flat().filter((c) => !isEmpty(c)) as (Node | string)[]));
  return el;
}

/** A link that sends a message (or runs a function) instead of navigating. */
export function link(
  text: string,
  msg: FromWebview | (() => void),
  attrs: Attrs = {},
): HTMLElement {
  const run = typeof msg === "function" ? msg : () => send(msg);
  return h(
    "a",
    {
      href: "#",
      ...attrs,
      onclick: (e: Event) => (e.preventDefault(), e.stopPropagation(), run()),
    },
    text,
  );
}

export function button(
  text: string,
  onClick: () => void,
  attrs: Attrs = {},
): HTMLElement {
  return h(
    "button",
    {
      class: "secondary",
      ...attrs,
      onclick: (e: Event) => (e.stopPropagation(), onClick()),
    },
    text,
  );
}

export const fmtTokens = (n: number): string =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : `${n}`;

/** Bar filled to value/limit; green < 70%, mustard 70–100%, red over the limit. */
export function bar(value: number, limit: number | null): HTMLElement {
  const el = h("div", { class: "bar" });
  if (limit === null || limit <= 0) {
    el.classList.add("off");
    return el;
  }
  const ratio = value / limit;
  const cls = ratio > 1 ? "bad" : ratio >= 0.7 ? "warn" : "ok";
  const filled = Math.min(ratio, 1);
  el.append(h("div", { class: `seg ${cls}`, flex: Math.max(filled, 0.02) }));
  if (filled < 1) el.append(h("div", { class: "seg rest", flex: 1 - filled }));
  return el;
}

export interface BoxSpec {
  label: string;
  text: string;
  value: number;
  limit: number | null;
  title: string;
  wide?: boolean;
}

/** One metric box: label, value text and a bar. */
export function box(b: BoxSpec): HTMLElement {
  return h(
    "div",
    { class: `box${b.wide ? " wide" : ""}`, title: b.title },
    h(
      "div",
      { class: "box-head" },
      h("span", null, b.label),
      h("span", { class: "val" }, b.text),
    ),
    bar(b.value, b.limit),
  );
}

const VERDICT_TITLE: Record<Verdict, string> = {
  FIX: "Fix: your change made it worse, or a hotspot (complex and changed often)",
  PLAN: "Plan: over the limits and changed sometimes. Worth a ticket.",
  LEAVE: "Leave: complex but rarely changed. Not worth refactoring now.",
  OK: "Within the limits",
};

export const badge = (v: Verdict): HTMLElement =>
  h(
    "span",
    { class: `badge v-${v.toLowerCase()}`, title: VERDICT_TITLE[v] },
    v,
  );

export function select(
  value: string,
  options: [string, string][],
  onchange: (v: string) => void,
): HTMLElement {
  const s = h("select", {
    onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value),
  }) as HTMLSelectElement;
  for (const [v, label] of options) s.append(h("option", { value: v }, label));
  s.value = value;
  return s;
}

export const ago = (unixSeconds: number): string => {
  if (!unixSeconds) return "never";
  const days = Math.floor((Date.now() / 1000 - unixSeconds) / 86400);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};

export function sparkline(weekly: number[]): HTMLElement {
  const max = Math.max(1, ...weekly);
  const bars = weekly.map((n) =>
    h("span", {
      class: "spark-bar",
      heightPct: Math.max(6, Math.round((n / max) * 100)),
      title: `${n} commit(s)`,
    }),
  );
  return h(
    "span",
    { class: "spark", title: "Commits per week, oldest first" },
    ...bars,
  );
}

export function section(
  title: string,
  ...kids: (Child | Child[])[]
): HTMLElement {
  return h(
    "section",
    { class: "section" },
    h("div", { class: "section-title" }, title),
    ...kids,
  );
}
