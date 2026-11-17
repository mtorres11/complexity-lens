// Metric rows (now · before · limit) and metric boxes, labelled from the metrics table.

import { capitalize, formatTokens } from "../core/format";
import { isOver, Metric } from "../core/limits";
import { bar, box, h } from "./dom";

/** A value as shown: tokens as ≈1.2k, LCOM 0 (nothing to judge) as "–", the rest as numbers. */
export function metricText(m: Metric, v: number): string {
  if (m.unit === "tokens") return `≈${formatTokens(v)}`;
  return m.key === "lcom" && !v ? "–" : `${v}`;
}

export interface MetricValues {
  now: number;
  before?: number;
  limit: number | null;
}

/** One row: label, now, before, limit, an optional bar, and ✓ / ✖. */
export function metricRow(label: string, m: Metric, v: MetricValues, withBar = true): HTMLElement {
  const over = isOver(v.now, v.limit);
  return h(
    "div",
    { class: "mrow" },
    h("span", { class: "mlabel" }, label),
    h("span", { class: "mnum" }, metricText(m, v.now)),
    h("span", { class: "mnum muted" }, v.before === undefined ? "–" : metricText(m, v.before)),
    h("span", { class: "mnum muted" }, v.limit === null ? "–" : metricText(m, v.limit)),
    withBar ? bar(v.now, v.limit) : h("span"),
    h("span", { class: over ? "bad-text" : "ok-text" }, over ? "✖" : "✓"),
  );
}

/** One report-card box for a metric; `detail` is added to the tooltip (e.g. the worst function). */
export function metricBox(m: Metric, value: number, limit: number | null, detail = ""): HTMLElement {
  return box({
    label: capitalize(m.short),
    text: metricText(m, value),
    value,
    limit,
    title: `${capitalize(m.help)}${detail}${limit === null ? "" : `, limit ${limit}`}`,
    wide: m.unit === "tokens",
  });
}
