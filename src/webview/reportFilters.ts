// Report filters: verdict chips with counts, "over the limit in" a metric, hotspots only,
// problems only, and the path search. Filters live in the panel (reset when VS Code reloads).

import type { LimitKey } from "../core/config";
import type { FileSummary } from "../core/insights";
import type { Verdict } from "../core/verdict";
import { button, h, select } from "./dom";
import { searchBox } from "./search";
import { matchesFilter, state } from "./state";

const VERDICTS: Verdict[] = ["FIX", "PLAN", "LEAVE", "OK"];

const METRICS: [LimitKey | "", string][] = [
  ["", "Any metric"],
  ["cognitiveComplexity", "Cognitive complexity"],
  ["cyclomaticComplexity", "Cyclomatic complexity"],
  ["nestingDepth", "Nesting depth"],
  ["functionLines", "Function length"],
  ["parameters", "Parameters"],
  ["fileLines", "File lines"],
  ["fileTokens", "File tokens"],
  ["imports", "Coupling (imports)"],
  ["lcom", "Cohesion (LCOM)"],
  ["contextTokens", "Context load"],
];

export const reportFilter: {
  hidden: Set<Verdict>;
  metric: LimitKey | "";
  hotspots: boolean;
  problems: boolean;
} = {
  hidden: new Set(),
  metric: "",
  hotspots: false,
  problems: false,
};

const active = () =>
  reportFilter.hidden.size > 0 ||
  !!reportFilter.metric ||
  reportFilter.hotspots ||
  reportFilter.problems ||
  !!state.filter;

function keep(r: FileSummary): boolean {
  const f = reportFilter;
  if (f.hidden.has(r.verdict)) return false;
  if (f.metric && !r.overLimits.includes(f.metric)) return false;
  if (f.hotspots && r.churn.commits < (state.update?.fixCommits ?? 6))
    return false;
  if (f.problems && !r.problems.length) return false;
  return matchesFilter(r.path);
}

export const applyReportFilters = (rows: FileSummary[]): FileSummary[] =>
  rows.filter(keep);

function chip(v: Verdict, count: number): HTMLElement {
  const off = reportFilter.hidden.has(v);
  const toggle = () => {
    if (off) reportFilter.hidden.delete(v);
    else reportFilter.hidden.add(v);
    state.render();
  };
  return h(
    "button",
    {
      class: `chip v-${v.toLowerCase()}${off ? " off" : ""}`,
      "aria-pressed": off ? "false" : "true",
      title: off ? `Show ${v} files` : `Hide ${v} files`,
      onclick: toggle,
    },
    `${v} ${count}`,
  );
}

function check(
  label: string,
  on: boolean,
  title: string,
  flip: () => void,
): HTMLElement {
  return h(
    "label",
    { class: "chk", title },
    h("input", {
      type: "checkbox",
      checked: on,
      onchange: () => (flip(), state.render()),
    }),
    label,
  );
}

function reset(): void {
  reportFilter.hidden.clear();
  reportFilter.metric = "";
  reportFilter.hotspots = false;
  reportFilter.problems = false;
  state.filter = "";
  state.render();
}

export function renderReportFilters(rows: FileSummary[]): HTMLElement {
  const counts = new Map<Verdict, number>(
    VERDICTS.map((v) => [v, rows.filter((r) => r.verdict === v).length]),
  );
  return h(
    "div",
    { class: "filters" },
    h(
      "div",
      { class: "chips" },
      ...VERDICTS.map((v) => chip(v, counts.get(v) ?? 0)),
    ),
    h(
      "label",
      { class: "row" },
      h("span", { class: "row-label" }, "Over"),
      select(
        reportFilter.metric,
        METRICS,
        (v) => ((reportFilter.metric = v as LimitKey | ""), state.render()),
      ),
    ),
    h(
      "div",
      { class: "inline checks" },
      check(
        "Hotspots only",
        reportFilter.hotspots,
        "Files changed often recently (the churn threshold for FIX)",
        () => (reportFilter.hotspots = !reportFilter.hotspots),
      ),
      check(
        "Problems only",
        reportFilter.problems,
        "Files your current changes made worse",
        () => (reportFilter.problems = !reportFilter.problems),
      ),
      active()
        ? button("Clear filters", reset, { title: "Show every file again" })
        : null,
    ),
    searchBox(
      rows.map((r) => r.path),
      "Search files…",
    ),
  );
}
