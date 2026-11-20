// "What to fix" for a single file: its functions to fix, each with advice and actions.

import type { FileDetail, FunctionDetail } from "../core/insights";
import { functionMetricsText } from "../core/limits";
import { actionButtons } from "./actions";
import { h, link } from "./dom";
import { openFunction, requestDetail, state } from "./state";

function fnFix(d: FileDetail, f: FunctionDetail): HTMLElement {
  return h(
    "div",
    { class: "fnfix" },
    h(
      "div",
      { class: "fnfix-head" },
      link(f.key, () => openFunction(d.path, f.key), { class: "fname", title: "Function analysis" }),
      " ",
      link(`line ${f.line}`, { type: "open", path: d.path, line: f.line }, { title: "Open at this line" }),
    ),
    h("div", { class: "muted small" }, functionMetricsText(f, undefined, " · ")),
    f.advice.length ? h("ul", { class: "advice" }, ...f.advice.map((a) => h("li", null, a))) : null,
    actionButtons(d.path, f.key, ["fixPrompt", "explainRed", "preview", "chore", "accept"]),
  );
}

/** Function-level fixes for the filtered file (asks the extension for its analysis once). */
export function fileFixes(path: string): HTMLElement[] {
  const err = state.detailErrors.get(path);
  if (err) return [h("div", { class: "error" }, err)];
  const d = state.details.get(path);
  if (!d) {
    requestDetail(path);
    return [h("div", { class: "muted summary" }, "Loading this file's fixes…")];
  }
  const bad = d.functions.filter((f) => f.over);
  const split = d.split ? h("div", { class: "why" }, `Suggested split: ${d.split.parts.map((p) => p.file).join(", ")} (open 🔍 for details).`) : null;
  if (!bad.length && !split) return [h("div", { class: "headline ok" }, "✓ No function in this file is over the limits")];
  return [h("div", { class: "subhead" }, `FUNCTIONS TO FIX (${bad.length})`), ...bad.map((f) => fnFix(d, f)), split].filter((n): n is HTMLElement => !!n);
}
