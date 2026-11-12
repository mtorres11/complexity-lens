// @ts-check
// Complexity Lens sidebar. Builds the DOM with textContent only (no innerHTML).
(function () {
  const vscode = acquireVsCodeApi();
  const app = /** @type {HTMLElement} */ (document.getElementById("app"));
  /** @type {any} */ let state = null;
  const expanded = new Set();

  const isEmpty = (/** @type {any} */ v) => v === undefined || v === null || v === false;

  /** @param {HTMLElement} el @param {string} k @param {any} v */
  function setAttr(el, k, v) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "flex") el.style.flex = `${v} 1 0`;
    else el.setAttribute(k, v === true ? "" : String(v));
  }

  /** @param {string} tag @param {Record<string, any> | null} [attrs] @param {...any} kids */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) if (!isEmpty(v)) setAttr(el, k, v);
    el.append(...kids.flat().filter((c) => !isEmpty(c)));
    return el;
  }
  const send = (/** @type {any} */ m) => vscode.postMessage(m);
  const link = (/** @type {string} */ text, /** @type {any} */ msg, /** @type {Record<string, any>} */ attrs = {}) =>
    h("a", { href: "#", ...attrs, onclick: (/** @type {Event} */ e) => (e.preventDefault(), send(msg)) }, text);

  const fmtTokens = (/** @type {number} */ n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
  const limitText = (/** @type {number|null} */ l, prefix = ", limit ") => (l ? `${prefix}${l}` : "");

  /** Bar filled to value/limit; green < 70%, mustard 70–100%, red over the limit. */
  function bar(/** @type {number} */ value, /** @type {number|null} */ limit) {
    const el = h("div", { class: "bar" });
    if (limit === null || limit <= 0) {
      el.classList.add("off");
      return el;
    }
    const ratio = value / limit;
    const cls = ratio > 1 ? "bad" : ratio >= 0.7 ? "warn" : "ok";
    const filled = Math.min(ratio, 1);
    el.append(h("div", { class: `seg ${cls}`, flex: Math.max(filled, 0.02) }));
    if (filled < 1) el.append(h("div", { class: "seg rest", flex: 1 - filled }));
    return el;
  }

  function box(label, valueText, value, limit, title) {
    return h("div", { class: "box", title }, h("div", { class: "box-head" }, h("span", null, label), h("span", { class: "val" }, valueText)), bar(value, limit));
  }

  function select(id, value, options, onchange) {
    const s = h("select", { id, onchange: (/** @type {any} */ e) => onchange(e.target.value) });
    for (const [v, label] of options) s.append(h("option", { value: v }, label));
    /** @type {HTMLSelectElement} */ (s).value = value;
    return s;
  }

  function delta(row) {
    const before = row.maxComplexityBefore;
    if (state.scope !== "changed" || before === undefined || before === row.maxComplexity) return null;
    const up = row.maxComplexity > before;
    return h("span", { class: `delta ${up ? "up" : "down"}`, title: "Highest function complexity since the last commit" }, `${up ? "▲" : "▼"} ${before} → ${row.maxComplexity}`);
  }

  function boxes(row) {
    const L = row.limits;
    const worst = row.worstFunction ? ` (${row.worstFunction})` : "";
    return h(
      "div",
      { class: "boxes" },
      box("Complexity", `${row.maxComplexity}`, row.maxComplexity, L.complexity, `Highest function complexity${worst}${limitText(L.complexity)}`),
      box("Size", `${row.lines}`, row.lines, L.lines, `${row.lines} lines${limitText(L.lines)}`),
      box("Coupling", `${row.imports}`, row.imports, L.imports, `${row.imports} imports${limitText(L.imports)}`),
      box("AI cost", `≈${fmtTokens(row.aiCost)}`, row.aiCost, L.tokens, `≈${row.aiCost} tokens to read this file and its direct imports${limitText(L.tokens, " (file limit ")}${L.tokens ? ")" : ""}`),
    );
  }

  const ICON = { improved: "▼", allowed: "✓" };

  function itemList(row, items) {
    return h(
      "ul",
      { class: "items" },
      ...items.map((it) =>
        h("li", { class: `item ${it.status}` }, h("span", { class: "icon" }, ICON[it.status] || "✖"), link(`line ${it.line}`, { type: "open", path: row.path, line: it.line }), h("span", null, ` ${it.text}`)),
      ),
    );
  }

  function toggle(row, open) {
    const notes = row.notes.length ? `, ${row.notes.length} note(s)` : "";
    const flip = () => {
      if (open) expanded.delete(row.path);
      else expanded.add(row.path);
      render();
    };
    return h("div", { class: "toggle", onclick: flip }, `${open ? "▾" : "▸"} ${row.problems.length} problem(s)${notes}`);
  }

  function card(row) {
    const open = expanded.has(row.path);
    const items = [...row.problems, ...row.notes];
    const showHistory = state.sort === "hotspot" || state.scope === "repo";
    return h(
      "div",
      { class: `card${row.problems.length ? " has-problems" : ""}` },
      h("div", { class: "card-top" }, link(row.path, { type: "open", path: row.path, line: 1 }, { class: "path", title: row.path }), delta(row)),
      boxes(row),
      showHistory ? h("div", { class: "muted small" }, `${row.commits} commit(s) recently · hotspot score ${row.hotspot}`) : null,
      items.length ? toggle(row, open) : null,
      open && items.length ? itemList(row, items) : null,
    );
  }

  function controls() {
    const row = (label, control) => h("label", { class: "row" }, h("span", { class: "row-label" }, label), control);
    const hookTitle = state.trusted ? "Add the agent hook to this repo" : "Trust the workspace first";
    return h(
      "div",
      { class: "controls" },
      row("Scope", select("scope", state.scope, [["changed", "Changed files"], ["repo", "Whole repo"], ["current", "Current file"]], (v) => send({ type: "scope", value: v }))),
      row("Sort", select("sort", state.sort, [["aiCost", "AI cost"], ["complexity", "Complexity"], ["hotspot", "Hotspot"], ["name", "Name"]], (v) => send({ type: "sort", value: v }))),
      h(
        "div",
        { class: "row" },
        h("span", { class: "row-label" }, "Repo"),
        h(
          "div",
          { class: "inline" },
          h("button", { class: "secondary", onclick: () => send({ type: "openConfig" }) }, "Rules…"),
          h("button", { class: "secondary", disabled: !state.trusted, title: hookTitle, onclick: () => send({ type: "installHook" }) }, "Agent hook…"),
        ),
      ),
    );
  }

  function notices() {
    const out = [];
    if (!state.trusted) out.push(h("div", { class: "notice" }, "Restricted Mode: git features (changed files, hotspots, comparisons) are off."));
    for (const e of state.configErrors || []) out.push(h("div", { class: "notice" }, `complexity-lens.json: ${e}`));
    if (state.error) out.push(h("div", { class: "error" }, `⚠ ${state.error}`));
    if (state.empty) out.push(h("div", { class: "empty muted" }, state.empty));
    return out;
  }

  function reportNodes() {
    const r = state.report;
    if (!r) {
      const progress = state.progress ? `Analysing ${state.progress.done}/${state.progress.total}…` : "Analysing…";
      return state.loading ? [h("div", { class: "muted summary" }, progress)] : [];
    }
    const summary = h(
      "div",
      { class: "summary" },
      `${r.rows.length} file(s) · ${r.problemCount} problem(s) · AI context ≈${fmtTokens(r.totalTokens)} tokens`,
      state.loading ? h("span", { class: "muted" }, " · refreshing…") : null,
      r.truncated ? h("div", { class: "muted small" }, "Showing the first files only (see complexityLens.maxFiles).") : null,
    );
    const empty = r.scope === "changed" ? "No changed files to check. Edit something, or switch Scope to Whole repo." : "No matching files.";
    return [summary, r.rows.length ? null : h("div", { class: "empty muted" }, empty), ...r.rows.map(card)];
  }

  function render() {
    if (!state) return;
    const a = state.about || {};
    const footer = h(
      "div",
      { class: "footer muted" },
      `Created by ${a.author || "Marco Torres C"}`,
      a.hasRepo ? " · " : null,
      a.hasRepo ? link("GitHub", { type: "openRepo" }, { title: "Open the source repository" }) : null,
      a.version ? ` · v${a.version}` : null,
      " · local only, no telemetry",
    );
    app.replaceChildren(...[controls(), ...notices(), ...reportNodes(), footer].filter((n) => !isEmpty(n)));
  }

  window.addEventListener("message", (e) => {
    const m = e.data;
    if (m?.type === "progress") {
      if (state) state.progress = m;
      if (state && !state.report) render();
      return;
    }
    if (m?.type !== "update") return;
    const keepReport = m.loading && state?.report && state.scope === m.scope && state.sort === m.sort;
    state = { ...m, report: m.report ?? (keepReport ? state.report : undefined) };
    render();
  });
  send({ type: "ready" });
})();
