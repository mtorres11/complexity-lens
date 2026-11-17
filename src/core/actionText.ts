// Which text each action produces. Hosts only deliver it (clipboard, a file, a line in the editor).

import { fileFixPrompt, functionFixPrompt, ticketDraft } from "./actions";
import { allowCommentText } from "./config";
import type { FileDetail, FunctionDetail } from "./insights";

/** The fix prompt for one function, or for the whole file when no function is given. */
export const fixPromptFor = (d: FileDetail, fn: FunctionDetail | undefined, extra: readonly string[]): string =>
  fn ? functionFixPrompt(d, fn, extra) : fileFixPrompt(d, extra);

/** The function "Accept…" is about: the one asked for, else the worst one over a limit. */
export const acceptTarget = (d: FileDetail, fnKey: string | undefined): FunctionDetail | undefined =>
  d.functions.find((f) => f.key === fnKey) ?? d.functions.find((f) => f.over);

/** The allow comment for a reason the user typed (whitespace collapsed to single spaces). */
export const acceptComment = (marker: string, reason: string): string => allowCommentText(marker, reason.trim().replace(/\s+/g, " "));

/** Problem with a reason the user typed for Accept…, or undefined when it's fine. */
export const reasonProblem = (reason: string): string | undefined =>
  reason.trim().length >= 3 ? undefined : "Give a short reason (at least 3 characters)";

/** Suggested file name for one file's ticket draft, e.g. "parser-complexity.md". */
export const ticketFileName = (path: string): string =>
  `${(path.split("/").pop() ?? "file").replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-")}-complexity.md`;

export const TICKETS_FILE_NAME = "complexity-tickets.md";

/** Several ticket drafts in one Markdown document. */
export const ticketDrafts = (details: FileDetail[], extra: readonly string[]): string =>
  details.map((d) => ticketDraft(d, extra)).join("\n\n---\n\n");

/** The repo's extra prompt rules from a setting: non-empty strings only, trimmed. */
export const cleanGuidelines = (list: unknown): string[] =>
  Array.isArray(list) ? list.filter((g): g is string => typeof g === "string" && g.trim() !== "").map((g) => g.trim()) : [];
