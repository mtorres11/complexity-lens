// Deep analysis of one file (from the 🔍 button).

import type { FileDetail, FunctionDetail } from "../core/insights";
import {
  ago,
  badge,
  bar,
  button,
  fmtTokens,
  h,
  link,
  section,
  send,
  sparkline,
} from "./dom";
import { openFile, openFunction } from "./state";

type Row = {
  label: string;
  now: number | string;
  before?: number;
  limit: number | null;
  value?: number;
};

function metricRow(r: Row): HTMLElement {
  const over =
    r.limit !== null && typeof r.value === "number" && r.value > r.limit;
  return h(
    "div",
    { class: "mrow" },
    h("span", { class: "mlabel" }, r.label),
    h("span", { class: "mnum" }, `${r.now}`),
    h(
      "span",
      { class: "mnum muted" },
      r.before === undefined ? "–" : `${r.before}`,
    ),
    h("span", { class: "mnum muted" }, r.limit === null ? "–" : `${r.limit}`),
    typeof r.value === "number" ? bar(r.value, r.limit) : h("span"),
    h("span", { class: over ? "bad-text" : "ok-text" }, over ? "✖" : "✓"),
  );
}

function metrics(d: FileDetail): HTMLElement {
  const L = d.limits;
  const b = d.before;
  return section(
    "METRICS · now · last commit · limit",
    metricRow({
      label: "Cognitive (worst)",
      now: d.cognitive,
      before: b?.cognitive,
      limit: L.cognitiveComplexity,
      value: d.cognitive,
    }),
    metricRow({
      label: "Cyclomatic (worst)",
      now: d.cyclomatic,
      before: b?.cyclomatic,
      limit: L.cyclomaticComplexity,
      value: d.cyclomatic,
    }),
    metricRow({
      label: "Nesting (worst)",
      now: d.nesting,
      before: b?.nesting,
      limit: L.nestingDepth,
      value: d.nesting,
    }),
    metricRow({
      label: "Cohesion (LCOM)",
      now: d.lcom || "–",
      before: b?.lcom,
      limit: L.lcom,
      value: d.lcom,
    }),
    metricRow({
      label: "Context load",
      now: fmtTokens(d.contextTokens),
      before: b?.contextTokens,
      limit: L.contextTokens,
      value: d.contextTokens,
    }),
    h(
      "div",
      { class: "muted small" },
      `= file ≈${fmtTokens(d.context.own)} + imports ≈${fmtTokens(d.context.fromImports)} · ${d.lines} lines`,
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
      `cog ${f.cognitive} · cyc ${f.cyclomatic} · ${f.lines} ln · nest ${f.nesting}`,
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
    `SUGGESTED SPLIT (saves ≈${fmtTokens(d.split.savesTokens)} tokens per edit)`,
    ...d.split.parts.map((p) =>
      h(
        "div",
        { class: "split" },
        h("span", { class: "fname" }, p.file),
        h(
          "span",
          { class: "muted small" },
          ` ${p.members.slice(0, 4).join(", ")}${p.members.length > 4 ? ", …" : ""} (${p.members.length}) ≈${fmtTokens(p.tokens)} tok`,
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
  const fn = d.functions.find((f) => f.over)?.key;
  const act =
    (kind: "fixPrompt" | "ticket" | "chore" | "accept" | "ignore") => () =>
      send({
        type: "action",
        kind,
        path: d.path,
        fn: kind === "accept" ? fn : undefined,
      });
  return section(
    "ACTIONS",
    h(
      "div",
      { class: "actions" },
      button("✨ Fix with AI", act("fixPrompt"), {
        title: "Copy a refactoring prompt for your AI agent",
      }),
      button("🎫 Ticket draft", act("ticket"), {
        title: "Copy or save a ready-to-file ticket",
      }),
      button("🧹 Chore", act("chore")),
      button("Accept…", act("accept"), {
        disabled: !fn,
        title: "Keep the worst function as is, with a reason in the code",
      }),
      button("Ignore", act("ignore"), {
        title: "Hide from What to fix (on this machine)",
      }),
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
