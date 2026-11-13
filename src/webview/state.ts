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
  expanded: Set<string>;
  render: () => void;
} = {
  stack: [],
  details: new Map(),
  detailErrors: new Map(),
  expanded: new Set(),
  render: () => undefined,
};

export const top = (): Screen | undefined =>
  state.stack[state.stack.length - 1];

/** Opens the deep analysis of a file (asks the extension for it if needed). */
export function openFile(path: string): void {
  state.stack.push({ kind: "file", path });
  state.detailErrors.delete(path);
  if (!state.details.has(path)) send({ type: "detail", path });
  state.render();
  window.scrollTo(0, 0);
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
