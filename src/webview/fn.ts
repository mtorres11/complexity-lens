// Analysis of one function: metrics, where the complexity is, calls, how to fix, actions.

import type { FileDetail, FunctionDetail } from "../core/insights";
import { button, h, link, section, send } from "./dom";
import { openFunction } from "./state";

function metricLine(
  label: string,
  now: number,
  before: number | undefined,
  limit: number | null,
): HTMLElement {
  const over = limit !== null && now > limit;
  return h(
    "div",
    { class: "mrow" },
    h("span", { class: "mlabel" }, label),
    h("span", { class: "mnum" }, `${now}`),
    h(
      "span",
      { class: "mnum muted" },
      before === undefined ? "–" : `${before}`,
    ),
    h("span", { class: "mnum muted" }, limit === null ? "–" : `${limit}`),
    h("span"),
    h("span", { class: over ? "bad-text" : "ok-text" }, over ? "✖" : "✓"),
  );
}

function whereSection(d: FileDetail, f: FunctionDetail): HTMLElement {
  const maxPoints = Math.max(...f.hotspots.map((x) => x.points), 0);
  return section(
    "WHERE THE COMPLEXITY IS",
    ...f.hotspots.map((x) =>
      h(
        "div",
        { class: "inc" },
        link(`line ${x.line}`, { type: "open", path: d.path, line: x.line }),
        h(
          "span",
          { class: "inc-kind" },
          `${"  ".repeat(x.nesting)}${x.nesting ? "└ " : ""}${x.kind}`,
        ),
        h(
          "span",
          {
            class:
              x.points === maxPoints && maxPoints > 1
                ? "inc-pts hot"
                : "inc-pts",
          },
          `+${x.points}${x.points === maxPoints && maxPoints > 1 ? " ◀" : ""}`,
        ),
      ),
    ),
    f.hotspots.length
      ? null
      : h(
          "div",
          { class: "muted small" },
          "No branches or loops: this function is straight-line code.",
        ),
  );
}

const fnLinks = (d: FileDetail, keys: string[]) =>
  keys.length
    ? keys.flatMap((k) => [link(k, () => openFunction(d.path, k)), " "])
    : ["–"];

function header(d: FileDetail, f: FunctionDetail): HTMLElement {
  return h(
    "div",
    { class: "detail-head" },
    h("span", { class: f.over ? "bad-text" : "ok-text" }, f.over ? "✖ Hard to follow" : "✓ Within the limits"),
    h("span", { class: "muted" }, " · "),
    link(`line ${f.line}`, { type: "open", path: d.path, line: f.line }, { title: "Open at this line" }),
    h("span", { class: "muted" }, ` · ${f.lines} lines`),
  );
}

function metricsSection(d: FileDetail, f: FunctionDetail): HTMLElement {
  const L = d.limits;
  const b = f.before;
  return section(
    "METRICS · now · last commit · limit",
    metricLine("Cognitive", f.cognitive, b?.cognitive, L.cognitiveComplexity),
    metricLine("Cyclomatic", f.cyclomatic, b?.cyclomatic, L.cyclomaticComplexity),
    metricLine("Nesting", f.nesting, b?.nesting, L.nestingDepth),
    metricLine("Lines", f.lines, b?.lines, L.functionLines),
    metricLine("Parameters", f.parameters, b?.parameters, L.parameters),
  );
}

function callsSection(d: FileDetail, f: FunctionDetail): HTMLElement {
  return section(
    "CALLS / CALLED BY (in this file)",
    h("div", null, h("span", { class: "muted" }, "called by: "), ...fnLinks(d, f.calledBy)),
    h("div", null, h("span", { class: "muted" }, "calls: "), ...fnLinks(d, f.calls)),
  );
}

function actionsSection(d: FileDetail, f: FunctionDetail): HTMLElement {
  const act = (kind: "fixPrompt" | "chore" | "accept") => () => send({ type: "action", kind, path: d.path, fn: f.key });
  return section(
    "ACTIONS",
    h(
      "div",
      { class: "actions" },
      button("✨ Fix with AI", act("fixPrompt"), { title: "Copy a prompt for your AI agent" }),
      button("🧹 Chore", act("chore")),
      button("Accept…", act("accept"), { title: "Keep it as is, with a reason in the code" }),
    ),
  );
}

export function renderFunction(d: FileDetail, key: string): HTMLElement[] {
  const f = d.functions.find((x) => x.key === key);
  if (!f) return [h("div", { class: "empty muted" }, "This function is no longer in the file.")];
  return [
    header(d, f),
    f.allowReason !== undefined ? h("div", { class: "why" }, `Accepted in code: ${f.allowReason || "(no reason given)"}`) : null,
    metricsSection(d, f),
    whereSection(d, f),
    callsSection(d, f),
    f.advice.length ? section("HOW TO FIX", h("ul", { class: "advice" }, ...f.advice.map((a) => h("li", null, a)))) : null,
    actionsSection(d, f),
  ].filter((n): n is HTMLElement => !!n);
}
