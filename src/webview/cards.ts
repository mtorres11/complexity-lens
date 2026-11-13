// The Report card: verdict, the 🔍 deep-analysis button, and seven metric boxes.

import type { FileSummary, Item } from "../core/insights";
import { badge, box, fmtTokens, h, link } from "./dom";
import { fixFile, openFile, state, toggle } from "./state";

const lim = (l: number | null, label = "limit") =>
  l === null ? "" : `, ${label} ${l}`;

function metricGrid(r: FileSummary): HTMLElement {
  const L = r.limits;
  const fix = state.update?.fixCommits ?? 6;
  const worst = r.worstFunction ? ` (${r.worstFunction})` : "";
  return h(
    "div",
    { class: "grid" },
    box({
      label: "Cognitive",
      text: `${r.cognitive}`,
      value: r.cognitive,
      limit: L.cognitiveComplexity,
      title: `Hardest-to-follow function${worst}${lim(L.cognitiveComplexity)}`,
    }),
    box({
      label: "Cyclomatic",
      text: `${r.cyclomatic}`,
      value: r.cyclomatic,
      limit: L.cyclomaticComplexity,
      title: `Most paths through one function${lim(L.cyclomaticComplexity)}`,
    }),
    box({
      label: "Nesting",
      text: `${r.nesting}`,
      value: r.nesting,
      limit: L.nestingDepth,
      title: `Deepest if/loop/try nesting${lim(L.nestingDepth)}`,
    }),
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
      title: `Ca ${r.coupling.ca}: files that import it · Ce ${r.coupling.ce}: modules it imports${lim(L.imports, "Ce limit")} · instability ${r.coupling.instability}`,
    }),
    box({
      label: "Cohesion",
      text: r.lcom ? `LCOM ${r.lcom}` : "–",
      value: r.lcom,
      limit: L.lcom,
      title: `Unrelated groups of code in the file or a class (1 = cohesive)${lim(L.lcom)}`,
    }),
    box({
      label: "Context load",
      text: `≈${fmtTokens(r.contextTokens)} tok`,
      value: r.contextTokens,
      limit: L.contextTokens,
      title: `Estimated tokens an AI reads to work on it (file + imports)${lim(L.contextTokens)}`,
      wide: true,
    }),
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
    before === r.cognitive ||
    state.update?.scope !== "changed"
  )
    return null;
  const up = r.cognitive > before;
  return h(
    "span",
    {
      class: `delta ${up ? "up" : "down"}`,
      title: "Hardest function since the last commit",
    },
    `${up ? "▲" : "▼"} ${before} → ${r.cognitive}`,
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
