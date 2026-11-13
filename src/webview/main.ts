// Complexity Lens sidebar entry point: tabs, drill-down screens, notices and the footer.

import type { ToWebview } from "../vscode/protocol";
import { reportCard } from "./cards";
import { button, fmtTokens, h, link, select, send } from "./dom";
import { renderFile } from "./file";
import { renderFunction } from "./fn";
import { back, home, requestDetail, state, top } from "./state";
import { restoreSearchFocus } from "./search";
import { renderChange, renderTodo } from "./tabs";

const app = document.getElementById("app") as HTMLElement;

const TAB_LABELS: [string, string][] = [
  ["report", "Report"],
  ["change", "Your change"],
  ["todo", "What to fix"],
];

/** A tab opened directly shows everything: the search filter is cleared. */
function openTab(id: "report" | "change" | "todo"): void {
  state.filter = "";
  state.pinned = undefined;
  home();
  send({ type: "tab", value: id });
}

function tabs(): HTMLElement {
  const u = state.update;
  return h(
    "div",
    { class: "tabs", role: "tablist" },
    ...TAB_LABELS.map(([id, label]) =>
      h(
        "button",
        {
          class: `tab${u?.tab === id && !state.stack.length ? " on" : ""}`,
          role: "tab",
          onclick: () => openTab(id as "report"),
        },
        label,
      ),
    ),
  );
}

function reportControls(): HTMLElement {
  const u = state.update;
  if (!u) return h("div");
  const row = (label: string, control: HTMLElement) =>
    h(
      "label",
      { class: "row" },
      h("span", { class: "row-label" }, label),
      control,
    );
  return h(
    "div",
    { class: "controls" },
    row(
      "Scope",
      select(
        u.scope,
        [
          ["changed", "Changed files"],
          ["repo", "Whole repo"],
          ["current", "Current file"],
        ],
        (v) => send({ type: "scope", value: v as "repo" }),
      ),
    ),
    row(
      "Sort",
      select(
        u.sort,
        [
          ["payoff", "Payoff"],
          ["aiCost", "Context load"],
          ["complexity", "Complexity"],
          ["churn", "Churn"],
          ["name", "Name"],
        ],
        (v) => send({ type: "sort", value: v as "payoff" }),
      ),
    ),
    h(
      "div",
      { class: "row" },
      h("span", { class: "row-label" }, "Repo"),
      h(
        "div",
        { class: "inline" },
        button("Rules…", () => send({ type: "openConfig" })),
        button("Agent hook…", () => send({ type: "installHook" }), {
          disabled: !u.trusted,
          title: u.trusted
            ? "Add the agent hook to this repo"
            : "Trust the workspace first",
        }),
      ),
    ),
  );
}

function notices(): HTMLElement[] {
  const u = state.update;
  if (!u) return [];
  const out: HTMLElement[] = [];
  if (!u.trusted)
    out.push(
      h(
        "div",
        { class: "notice" },
        "Restricted Mode: git features (changes, churn, comparisons) are off.",
      ),
    );
  for (const e of u.configErrors)
    out.push(h("div", { class: "notice" }, `complexity-lens.json: ${e}`));
  if (u.error) out.push(h("div", { class: "error" }, `⚠ ${u.error}`));
  if (u.empty) out.push(h("div", { class: "empty muted" }, u.empty));
  if (u.loading)
    out.push(
      h(
        "div",
        { class: "muted summary" },
        state.progress
          ? `Analysing ${state.progress.done}/${state.progress.total}…`
          : "Analysing…",
      ),
    );
  if (u.truncated)
    out.push(
      h(
        "div",
        { class: "muted small" },
        "Only the first files were analysed (see complexityLens.maxFiles).",
      ),
    );
  return out;
}

function reportBody(): HTMLElement[] {
  const rows = state.update?.data.report;
  if (!rows) return [];
  const problems = rows.reduce((n, r) => n + r.problems.length, 0);
  const tokens = rows.reduce((n, r) => n + r.contextTokens, 0);
  const empty =
    state.update?.scope === "changed"
      ? "No changed files to check. Edit something, or switch Scope to Whole repo."
      : "No matching files.";
  return [
    h(
      "div",
      { class: "summary" },
      `${rows.length} file(s) · ${problems} problem(s) · context ≈${fmtTokens(tokens)} tokens`,
    ),
    rows.length ? null : h("div", { class: "empty muted" }, empty),
    ...rows.slice(0, 300).map(reportCard),
  ].filter((n): n is HTMLElement => !!n);
}

function crumbs(): HTMLElement {
  const s = top();
  const parts: (HTMLElement | string)[] = [
    link("← Back", back),
    "  ",
    link("Project", home),
  ];
  if (s) {
    parts.push(
      " › ",
      s.kind === "file"
        ? link(s.path, { type: "open", path: s.path, line: 1 }, { class: "crumb-file", title: `Open ${s.path}` })
        : link(s.path.split("/").pop() ?? s.path, back, { title: s.path }),
    );
    if (s.kind === "function") parts.push(" › ", h("span", null, s.fn));
  }
  return h("div", { class: "crumbs" }, ...parts);
}

function screen(): HTMLElement[] {
  const s = top();
  if (!s) return [];
  const err = state.detailErrors.get(s.path);
  if (err) return [crumbs(), h("div", { class: "error" }, err)];
  const d = state.details.get(s.path);
  if (!d)
    return [
      crumbs(),
      h("div", { class: "muted summary" }, "Analysing the file…"),
    ];
  return [
    crumbs(),
    ...(s.kind === "file" ? renderFile(d) : renderFunction(d, s.fn)),
  ];
}

function footer(): HTMLElement {
  const a = state.update?.about;
  return h(
    "div",
    { class: "footer muted" },
    `Created by ${a?.author || "Marco Torres C"}`,
    a?.hasRepo ? " · " : null,
    a?.hasRepo
      ? link(
          "GitHub",
          { type: "openRepo" },
          { title: "Open the source repository" },
        )
      : null,
    a?.version ? ` · v${a.version}` : null,
    " · local only, no telemetry",
  );
}

function body(): HTMLElement[] {
  if (state.stack.length) return screen();
  const tab = state.update?.tab ?? "report";
  if (tab === "change") return [...notices(), ...renderChange()];
  if (tab === "todo") return [...notices(), ...renderTodo()];
  return [reportControls(), ...notices(), ...reportBody()];
}

function render(): void {
  if (!state.update) return;
  state.rendering = true;
  app.replaceChildren(tabs(), ...body(), footer());
  state.rendering = false;
  restoreSearchFocus();
}
state.render = render;

window.addEventListener("message", (e: MessageEvent<ToWebview>) => {
  const m = e.data;
  if (m?.type === "progress") {
    state.progress = m;
    if (state.update?.loading) render();
    return;
  }
  if (m?.type === "detail") state.details.set(m.detail.path, m.detail);
  else if (m?.type === "detailError") state.detailErrors.set(m.path, m.text);
  else if (m?.type === "update") {
    state.update = m;
    if (!m.loading) {
      // Fresh data: details are asked for again when they are shown.
      state.details.clear();
      state.requested.clear();
    }
    if (!m.loading) for (const s of state.stack) requestDetail(s.path);
  } else return;
  render();
});
send({ type: "ready" });
