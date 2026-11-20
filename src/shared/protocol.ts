// Messages between the host (the editor extension) and the sidebar panel.

import type { FileDetail, FileSummary } from "../core/insights";

export const TABS = ["report", "change", "todo"] as const;
export const SCOPES = ["changed", "repo", "current"] as const;
export const SORTS = ["payoff", "aiCost", "complexity", "churn", "name"] as const;
export const ACTIONS = ["fixPrompt", "explainRed", "preview", "ticket", "chore", "accept", "ignore", "unignore"] as const;
export const BATCHES = ["fixAll", "prSummary", "tickets", "choreList"] as const;

export type Tab = (typeof TABS)[number];
export type Scope = (typeof SCOPES)[number];
export type Sort = (typeof SORTS)[number];
export type ActionKind = (typeof ACTIONS)[number];
export type BatchKind = (typeof BATCHES)[number];

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

/** Wording that depends on the host editor (its name for restricted workspaces, its setting names). */
export interface HostWording {
  /** Notice shown when the workspace isn't trusted. */
  untrusted: string;
  /** Tooltip of the agent-hook button when the workspace isn't trusted. */
  trustFirst: string;
  /** Notice shown when only the first files were analysed. */
  truncated: string;
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
  wording: HostWording;
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
