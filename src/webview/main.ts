// Complexity Lens sidebar entry point: tabs, drill-down screens, notices and the footer.

import { formatTokens } from "../core/format";
import { Scope, SCOPES, Sort, SORTS, Tab, TABS, ToWebview } from "../shared/protocol";
import { reportCard } from "./cards";
import { applyReportFilters, renderReportFilters } from "./reportFilters";
import { button, h, link, select } from "./dom";
import { onMessage, send } from "./bridge";
import { renderFile } from "./file";
import { renderFunction } from "./fn";
import { back, home, requestDetail, state, top } from "./state";
import { restoreSearchFocus } from "./search";
import { renderChange } from "./change";
import { renderTodo } from "./todo";

const app = document.getElementById("app") as HTMLElement;

const TAB_LABEL: Record<Tab, string> = { report: "Report", change: "Your change", todo: "What to fix" };
const SCOPE_LABEL: Record<Scope, string> = { changed: "Changed files", repo: "Whole repo", current: "Current file" };
const SORT_LABEL: Record<Sort, string> = { payoff: "Payoff", aiCost: "Context load", complexity: "Complexity", churn: "Churn", name: "Name" };

/** Options for a select, in the protocol's order. */
const options = <T extends string>(values: readonly T[], labels: Record<T, string>): [T, string][] => values.map((v) => [v, labels[v]]);

/** A tab opened directly shows everything: the search filter is cleared. */
function openTab(id: Tab): void {
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
    ...TABS.map((id) =>
      h(
        "button",
        {
          class: `tab${u?.tab === id && !state.stack.length ? " on" : ""}`,
          role: "tab",
          onclick: () => openTab(id),
        },
        TAB_LABEL[id],
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
      select(u.scope, options(SCOPES, SCOPE_LABEL), (v) => send({ type: "scope", value: v as Scope })),
    ),
    row(
      "Sort",
      select(u.sort, options(SORTS, SORT_LABEL), (v) => send({ type: "sort", value: v as Sort })),
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
          title: u.trusted ? "Add the agent hook to this repo" : u.wording.trustFirst,
        }),
      ),
    ),
  );
}

function notices(): HTMLElement[] {
  const u = state.update;
  if (!u) return [];
  const out: HTMLElement[] = [];
  if (!u.trusted) out.push(h("div", { class: "notice" }, u.wording.untrusted));
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
  if (u.truncated) out.push(h("div", { class: "muted small" }, u.wording.truncated));
  return out;
}

function reportBody(): HTMLElement[] {
  const all = state.update?.data.report;
  if (!all) return [];
  const rows = applyReportFilters(all);
  const problems = rows.reduce((n, r) => n + r.problems.length, 0);
  const tokens = rows.reduce((n, r) => n + r.contextTokens, 0);
  const shown = rows.length === all.length ? `${rows.length} file(s)` : `${rows.length} of ${all.length} file(s)`;
  const emptyText = all.length ? "No files match the filters." : state.update?.scope === "changed" ? "No changed files to check. Edit something, or switch Scope to Whole repo." : "No matching files.";
  return [
    renderReportFilters(all),
    h("div", { class: "summary" }, `${shown} · ${problems} problem(s) · context ≈${formatTokens(tokens)} tokens`),
    rows.length ? null : h("div", { class: "empty muted" }, emptyText),
    ...rows.slice(0, 300).map(reportCard),
    rows.length > 300 ? h("div", { class: "muted small" }, `Showing the first 300 of ${rows.length}. Narrow the filters to see the rest.`) : null,
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
    a?.author ? `Created by ${a.author}` : null,
    a?.author && a.hasRepo ? " · " : null,
    a?.hasRepo ? link("GitHub", { type: "openRepo" }, { title: "Open the source repository" }) : null,
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

onMessage((m: ToWebview) => {
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
