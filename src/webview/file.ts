// Deep analysis of one file (from the 🔍 button).

import { capitalize, formatTokens } from "../core/format";
import type { FileDetail, FileValues, FunctionDetail } from "../core/insights";
import { functionMetricsText, METRIC } from "../core/limits";
import { actionButton } from "./actions";
import { ago, badge, h, link, section, sparkline } from "./dom";
import { metricRow } from "./metrics";
import { openFile, openFunction } from "./state";

/** File metrics on the deep-analysis screen; function metrics show the worst function. */
const SHOWN = [METRIC.cognitiveComplexity, METRIC.cyclomaticComplexity, METRIC.nestingDepth, METRIC.lcom, METRIC.contextTokens];

function metrics(d: FileDetail): HTMLElement {
  return section(
    "METRICS · now · last commit · limit",
    ...SHOWN.map((m) => {
      const key: keyof FileValues = m.key;
      const label = m.scope === "function" ? `${capitalize(m.short)} (worst)` : m.title;
      return metricRow(label, m, { now: d[key], before: d.before?.[key], limit: d.limits[key] });
    }),
    h(
      "div",
      { class: "muted small" },
      `= file ≈${formatTokens(d.context.own)} + imports ≈${formatTokens(d.context.fromImports)} · ${d.fileLines} lines`,
    ),
    d.context.ignored.length
      ? h(
          "div",
          { class: "muted small", title: d.context.ignored.join("\n") },
          `${d.context.ignored.length} import(s) not counted (tokens.ignoreImports)`,
        )
      : null,
    h(
      "div",
      { class: "muted small" },
      `Coupling: Ca ${d.coupling.ca} (files that import it) · Ce ${d.coupling.ce} (it imports) · instability ${d.coupling.instability}`,
    ),
  );
}

function churn(d: FileDetail): HTMLElement {
  const c = d.churn;
  return section(
    "CHURN",
    h(
      "div",
      null,
      `${c.commits} commit(s) · +${c.added} / −${c.deleted} lines · ${c.authors} author(s)`,
    ),
    h(
      "div",
      { class: "muted small" },
      `last change ${ago(c.lastChange)} · weekly `,
      sparkline(c.weekly),
    ),
  );
}

/** Related files: the name opens the file, 🔍 opens its deep analysis. */
const fileLinks = (paths: string[]) =>
  paths.slice(0, 12).flatMap((p) => [
    link(p.split("/").pop() ?? p, { type: "open", path: p, line: 1 }, { title: `Open ${p}` }),
    link("🔍", () => openFile(p), { class: "mini", title: `Deep analysis of ${p}` }),
    " ",
  ]);

function couplingSection(d: FileDetail): HTMLElement {
  return section(
    "COUPLING",
    h(
      "div",
      null,
      h("span", { class: "muted" }, `Used by (${d.dependents.length}): `),
      ...fileLinks(d.dependents),
      d.dependents.length > 12 ? "…" : null,
    ),
    h(
      "div",
      null,
      h(
        "span",
        { class: "muted" },
        `Uses (${d.coupling.ce}): ${d.internalImports.length} in the repo `,
      ),
      ...fileLinks(d.internalImports),
      ` · ${d.externalImports} package(s)`,
    ),
  );
}

function fnRow(d: FileDetail, f: FunctionDetail): HTMLElement {
  return h(
    "div",
    {
      class: `fnrow${f.over ? " over" : ""}`,
      onclick: () => openFunction(d.path, f.key),
      title: "Function analysis",
    },
    h(
      "span",
      { class: "icon" },
      f.over ? "✖" : f.allowReason !== undefined ? "✓" : "·",
    ),
    h("span", { class: "fname" }, f.key),
    h(
      "span",
      { class: "muted small" },
      functionMetricsText(f, undefined, " · "),
    ),
    h("span", { class: "chev" }, "▸"),
  );
}

function functionsSection(d: FileDetail): HTMLElement {
  const bad = d.functions.filter((f) => f.over);
  const fine = d.functions.length - bad.length;
  return section(
    "FUNCTIONS (worst first)",
    ...bad.map((f) => fnRow(d, f)),
    ...d.functions
      .filter((f) => !f.over)
      .slice(0, 8)
      .map((f) => fnRow(d, f)),
    fine > 8
      ? h(
          "div",
          { class: "muted small" },
          `✓ ${fine - 8} more within the limits`,
        )
      : null,
  );
}

function splitSection(d: FileDetail): HTMLElement | null {
  if (!d.split) return null;
  return section(
    `SUGGESTED SPLIT (saves ≈${formatTokens(d.split.savesTokens)} tokens per edit)`,
    ...d.split.parts.map((p) =>
      h(
        "div",
        { class: "split" },
        h("span", { class: "fname" }, p.file),
        h(
          "span",
          { class: "muted small" },
          ` ${p.members.slice(0, 4).join(", ")}${p.members.length > 4 ? ", …" : ""} (${p.members.length}) ≈${formatTokens(p.tokens)} tok`,
        ),
      ),
    ),
    h(
      "div",
      { class: "muted small" },
      "Groups come from cohesion: code in different groups never calls each other or shares state.",
    ),
  );
}

function actionsSection(d: FileDetail): HTMLElement {
  const worst = d.functions.find((f) => f.over)?.key;
  return section(
    "ACTIONS",
    h(
      "div",
      { class: "actions" },
      actionButton("fixPrompt", d.path),
      actionButton("ticket", d.path),
      actionButton("chore", d.path),
      actionButton("accept", d.path, worst, !worst),
      actionButton("ignore", d.path),
    ),
  );
}

export function renderFile(d: FileDetail): HTMLElement[] {
  return [
    h(
      "div",
      { class: "detail-head" },
      badge(d.verdict),
      h("span", { class: "muted" }, ` · ${d.reason}`),
    ),
    h("div", { class: "why big" }, d.why),
    metrics(d),
    churn(d),
    couplingSection(d),
    functionsSection(d),
    splitSection(d),
    actionsSection(d),
  ].filter((n): n is HTMLElement => !!n);
}
