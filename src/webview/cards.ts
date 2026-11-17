// The Report card: verdict, the 🔍 deep-analysis button, and seven metric boxes.

import type { FileSummary, Item } from "../core/insights";
import { METRIC } from "../core/limits";
import { badge, box, h, link } from "./dom";
import { metricBox } from "./metrics";
import { fixCommits, fixFile, openFile, state, toggle } from "./state";

function metricGrid(r: FileSummary): HTMLElement {
  const L = r.limits;
  const fix = fixCommits();
  const imports = L.imports === null ? "" : `, Ce limit ${L.imports}`;
  return h(
    "div",
    { class: "grid" },
    metricBox(METRIC.cognitiveComplexity, r.cognitiveComplexity, L.cognitiveComplexity, r.worstFunction ? ` (${r.worstFunction})` : ""),
    metricBox(METRIC.cyclomaticComplexity, r.cyclomaticComplexity, L.cyclomaticComplexity),
    metricBox(METRIC.nestingDepth, r.nestingDepth, L.nestingDepth),
    box({
      label: "Churn",
      text: `${r.churn.commits}×`,
      value: r.churn.commits,
      limit: fix,
      title: `${r.churn.commits} commits recently by ${r.churn.authors} author(s); ${fix}+ makes it a hotspot`,
    }),
    box({
      label: "Coupling",
      text: `Ca ${r.coupling.ca}·Ce ${r.coupling.ce}`,
      value: r.coupling.ce,
      limit: L.imports,
      title: `Ca ${r.coupling.ca}: files that import it · Ce ${r.coupling.ce}: modules it imports${imports} · instability ${r.coupling.instability}`,
    }),
    metricBox(METRIC.lcom, r.lcom, L.lcom),
    metricBox(METRIC.contextTokens, r.contextTokens, L.contextTokens),
  );
}

export function itemList(path: string, items: Item[]): HTMLElement {
  const icon = (s: Item["status"]) =>
    s === "improved" ? "▼" : s === "allowed" ? "✓" : "✖";
  return h(
    "ul",
    { class: "items" },
    ...items.map((it) =>
      h(
        "li",
        { class: `item ${it.status}` },
        h("span", { class: "icon" }, icon(it.status)),
        link(`line ${it.line}`, { type: "open", path, line: it.line }),
        h("span", null, ` ${it.text}`),
      ),
    ),
  );
}

function delta(r: FileSummary): HTMLElement | null {
  const before = r.cognitiveBefore;
  if (
    before === undefined ||
    before === r.cognitiveComplexity ||
    state.update?.scope !== "changed"
  )
    return null;
  const up = r.cognitiveComplexity > before;
  return h(
    "span",
    {
      class: `delta ${up ? "up" : "down"}`,
      title: "Hardest function since the last commit",
    },
    `${up ? "▲" : "▼"} ${before} → ${r.cognitiveComplexity}`,
  );
}

const iconButton = (text: string, title: string, run: () => void) =>
  h("button", { class: "icon-btn", title, "aria-label": title, onclick: (e: Event) => (e.stopPropagation(), run()) }, text);

/**
 * Header row used by every list: the file name (opens the file), the verdict, 🔍 (deep
 * analysis) and, on Report cards, 🛠 (What to fix for this file only).
 */
export function fileHeader(r: FileSummary, withFix = false): HTMLElement {
  return h(
    "div",
    { class: "card-top" },
    link(r.path, { type: "open", path: r.path, line: 1 }, { class: "path", title: `Open ${r.path}` }),
    delta(r),
    badge(r.verdict),
    iconButton("🔍", "Deep analysis of this file", () => openFile(r.path)),
    withFix ? iconButton("🛠", "What to fix in this file", () => fixFile(r.path)) : null,
  );
}

export function reportCard(r: FileSummary): HTMLElement {
  const key = `r:${r.path}`;
  const open = state.expanded.has(key);
  const items = [...r.problems, ...r.notes];
  const notes = r.notes.length ? `, ${r.notes.length} note(s)` : "";
  return h(
    "div",
    { class: `card v-${r.verdict.toLowerCase()}-edge` },
    fileHeader(r, true),
    metricGrid(r),
    items.length
      ? h(
          "div",
          { class: "toggle", onclick: () => toggle(key) },
          `${open ? "▾" : "▸"} ${r.problems.length} problem(s)${notes}`,
        )
      : null,
    open && items.length ? itemList(r.path, items) : null,
  );
}
