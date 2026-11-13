// Messages between the extension host and the sidebar webview.

import type { FileDetail, FileSummary } from "../core/insights";

export type Tab = "report" | "change" | "todo";
export type Scope = "changed" | "repo" | "current";
export type Sort = "payoff" | "aiCost" | "complexity" | "churn" | "name";
export type ActionKind =
  "fixPrompt" | "ticket" | "chore" | "accept" | "ignore" | "unignore";
export type BatchKind = "fixAll" | "prSummary" | "tickets" | "choreList";

export interface ViewData {
  /** Report: files in the chosen scope. */
  report?: FileSummary[];
  /** Your change: changed files compared with `compare`. */
  change?: { items: FileSummary[]; compare: string };
  /** What to fix: whole repo, grouped. */
  todo?: {
    fix: FileSummary[];
    plan: FileSummary[];
    leave: FileSummary[];
    ignored: string[];
  };
}

export interface UpdateMessage {
  type: "update";
  tab: Tab;
  scope: Scope;
  sort: Sort;
  compare: string;
  refs: string[];
  trusted: boolean;
  configErrors: string[];
  about: { author: string; version: string; hasRepo: boolean };
  /** Commits that make an over-limit file a hotspot (for the churn bar). */
  fixCommits: number;
  loading: boolean;
  data: ViewData;
  truncated: boolean;
  error?: string;
  empty?: string;
}

export type ToWebview =
  | UpdateMessage
  | { type: "progress"; done: number; total: number }
  | { type: "detail"; detail: FileDetail }
  | { type: "detailError"; path: string; text: string };

export type FromWebview =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "tab"; value: Tab }
  | { type: "scope"; value: Scope }
  | { type: "sort"; value: Sort }
  | { type: "compare"; value: string }
  | { type: "open"; path: string; line?: number }
  | { type: "detail"; path: string }
  | { type: "action"; kind: ActionKind; path: string; fn?: string }
  | { type: "batch"; kind: BatchKind }
  | { type: "openConfig" }
  | { type: "installHook" }
  | { type: "openRepo" };

export const TABS: Tab[] = ["report", "change", "todo"];
export const SCOPES: Scope[] = ["changed", "repo", "current"];
export const SORTS: Sort[] = [
  "payoff",
  "aiCost",
  "complexity",
  "churn",
  "name",
];
export const ACTIONS: ActionKind[] = [
  "fixPrompt",
  "ticket",
  "chore",
  "accept",
  "ignore",
  "unignore",
];
export const BATCHES: BatchKind[] = [
  "fixAll",
  "prSummary",
  "tickets",
  "choreList",
];
