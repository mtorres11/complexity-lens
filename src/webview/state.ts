// Webview state and navigation: the current tab, and a stack of drill-down screens
// (file analysis, function analysis) with a Back button.

import type { FileDetail } from "../core/insights";
import type { UpdateMessage } from "../vscode/protocol";
import { send } from "./dom";

export type Screen =
  | { kind: "file"; path: string }
  | { kind: "function"; path: string; fn: string };

export const state: {
  update?: UpdateMessage;
  progress?: { done: number; total: number };
  stack: Screen[];
  details: Map<string, FileDetail>;
  detailErrors: Map<string, string>;
  /** Details already asked for (so re-renders don't ask again). */
  requested: Set<string>;
  expanded: Set<string>;
  /** Search filter for "What to fix" and "Your change" (case-insensitive part of a path). */
  filter: string;
  /** Keep the search box focused across re-renders while typing. */
  searchFocused: boolean;
  /** True while the panel is being re-rendered (focus changes then are not the user's). */
  rendering: boolean;
  /** File chosen with 🛠: shown even when it isn't in the What to fix lists. */
  pinned?: string;
  render: () => void;
} = {
  stack: [],
  details: new Map(),
  detailErrors: new Map(),
  requested: new Set(),
  expanded: new Set(),
  filter: "",
  searchFocused: false,
  rendering: false,
  render: () => undefined,
};

/** Paths that match the search filter (all of them when the filter is empty). */
export const matchesFilter = (path: string): boolean => !state.filter || path.toLowerCase().includes(state.filter.toLowerCase());

/** The exact file the filter names, if any (used to show that file's function-level fixes). */
export const filteredFile = (paths: string[]): string | undefined => {
  const exact = paths.find((p) => p === state.filter);
  if (exact) return exact;
  if (state.pinned && state.filter === state.pinned) return state.pinned;
  const hits = state.filter ? paths.filter(matchesFilter) : [];
  return hits.length === 1 ? hits[0] : undefined;
};

export function setFilter(value: string): void {
  state.filter = value;
  state.render();
}

/** "What to fix" for one file only (from the 🛠 button on a report card). */
export function fixFile(path: string): void {
  state.stack = [];
  state.filter = path;
  state.pinned = path;
  state.searchFocused = false;
  send({ type: "tab", value: "todo" });
  state.render();
  window.scrollTo(0, 0);
}

export const top = (): Screen | undefined =>
  state.stack[state.stack.length - 1];

/** Opens the deep analysis of a file (asks the extension for it if needed). */
export function openFile(path: string): void {
  state.stack.push({ kind: "file", path });
  state.detailErrors.delete(path);
  requestDetail(path);
  state.render();
  window.scrollTo(0, 0);
}

/** Asks the extension for a file's analysis once. */
export function requestDetail(path: string): void {
  if (state.details.has(path) || state.requested.has(path)) return;
  state.requested.add(path);
  send({ type: "detail", path });
}

export function openFunction(path: string, fn: string): void {
  state.stack.push({ kind: "function", path, fn });
  state.render();
  window.scrollTo(0, 0);
}

export function back(): void {
  state.stack.pop();
  state.render();
}

export function home(): void {
  state.stack = [];
  state.render();
}

export function toggle(key: string): void {
  if (state.expanded.has(key)) state.expanded.delete(key);
  else state.expanded.add(key);
  state.render();
}
