// Search box for "What to fix" and "Your change": type part of a path or pick a file.

import { h } from "./dom";
import { setFilter, state } from "./state";

let listId = 0;

export function searchBox(paths: string[], placeholder: string): HTMLElement {
  const id = `paths-${++listId}`;
  const input = h("input", {
    id: "search",
    class: "search",
    type: "search",
    list: id,
    placeholder,
    "aria-label": placeholder,
    value: state.filter,
    oninput: (e: Event) => {
      state.searchFocused = true;
      setFilter((e.target as HTMLInputElement).value);
    },
    onblur: () => {
      // Re-rendering replaces the box and fires blur; only a real blur ends typing mode.
      if (!state.rendering) state.searchFocused = false;
    },
  }) as HTMLInputElement;
  input.value = state.filter;
  const options = h("datalist", { id }, ...[...new Set(paths)].sort().slice(0, 500).map((p) => h("option", { value: p })));
  const clear = state.filter
    ? h("button", { class: "icon-btn", title: "Show everything", "aria-label": "Clear search", onclick: () => ((state.pinned = undefined), setFilter("")) }, "✕")
    : null;
  return h("div", { class: "searchbar" }, h("span", { class: "search-icon" }, "🔎"), input, clear, options);
}

/** Puts the caret back in the search box after a re-render while typing. */
export function restoreSearchFocus(): void {
  if (!state.searchFocused) return;
  const el = document.getElementById("search") as HTMLInputElement | null;
  if (!el) return;
  el.focus();
  const end = el.value.length;
  el.setSelectionRange(end, end);
}
