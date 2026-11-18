// What each action button does: one strategy per action, with the title shown while it runs.
// Texts come from core; delivery (clipboard, file, editor) goes through the host.

import { chore, fixAllPrompt, ticketDraft } from "../core/actions";
import {
  acceptComment,
  acceptTarget,
  cleanGuidelines,
  fixPromptFor,
  redPromptFor,
  reasonProblem,
  ticketDrafts,
  ticketFileName,
  TICKETS_FILE_NAME,
} from "../core/actionText";
import type { FileDetail, FileSummary, FunctionDetail } from "../core/insights";
import { choreList, prSummary } from "../core/summaries";
import type { Project } from "../node/project";
import type { ActionKind, BatchKind } from "../shared/protocol";
import type { HostPort } from "./host";

export interface ActionContext {
  host: HostPort;
  project: Project;
  detail(rel: string): Promise<FileDetail | undefined>;
  /** Summaries of the "Your change" tab. */
  changeItems(): Promise<FileSummary[]>;
  /** The top of "What to fix" (FIX, then PLAN). */
  topFix(): Promise<FileSummary[]>;
  ignored(): string[];
  setIgnored(list: string[]): Promise<void>;
}

interface Strategy<Args extends unknown[]> {
  /** Shown while it runs, e.g. "preparing the fix prompt". */
  title: string;
  /** Edits files, so it needs a trusted workspace. */
  editsFiles?: true;
  run(ctx: ActionContext, ...args: Args): Promise<void>;
}

const guidelines = (ctx: ActionContext) => cleanGuidelines(ctx.host.getSetting<unknown>("fixPromptGuidelines", []));

/** A file action that needs the file's analysis (and the function, when one is given). */
const withDetail =
  (run: (ctx: ActionContext, d: FileDetail, fn: FunctionDetail | undefined, fnKey?: string) => Promise<void>) =>
  async (ctx: ActionContext, rel: string, fnKey?: string): Promise<void> => {
    const d = await ctx.detail(rel);
    if (!d) throw new Error(`${rel} could not be analysed`);
    return run(ctx, d, d.functions.find((f) => f.key === fnKey), fnKey);
  };

const setIgnored = (ctx: ActionContext, rel: string, ignore: boolean): Promise<void> => {
  const list = new Set(ctx.ignored());
  if (ignore) list.add(rel);
  else list.delete(rel);
  return ctx.setIgnored([...list].sort());
};

async function accept(ctx: ActionContext, d: FileDetail, _fn: FunctionDetail | undefined, fnKey?: string): Promise<void> {
  const fn = acceptTarget(d, fnKey);
  if (!fn) return ctx.host.notify("info", "Complexity Lens: nothing to accept in this file.");
  const marker = ctx.project.settings(d.path).allowComment.marker;
  const reason = await ctx.host.prompt({
    title: `Accept ${fn.key} as it is`,
    prompt: `Why is this complexity necessary? It's added as "${acceptComment(marker, "<reason>")}" above the function.`,
    validate: reasonProblem,
  });
  const abs = ctx.project.absolute(d.path);
  if (reason && abs) await ctx.host.insertLine(abs, fn.line, acceptComment(marker, reason));
}

export const FILE_ACTIONS: Record<ActionKind, Strategy<[rel: string, fnKey?: string]>> = {
  fixPrompt: { title: "preparing the fix prompt", run: withDetail((ctx, d, fn) => ctx.host.copy(fixPromptFor(d, fn, guidelines(ctx)), "fix prompt")) },
  explainRed: { title: "preparing the red-metrics prompt", run: withDetail((ctx, d, fn) => ctx.host.copy(redPromptFor(d, fn, guidelines(ctx)), "red-metrics prompt")) },
  ticket: { title: "preparing the ticket draft", run: withDetail((ctx, d) => ctx.host.saveText(ticketDraft(d, guidelines(ctx)), ticketFileName(d.path), "Ticket draft")) },
  chore: { title: "preparing the chore", run: withDetail((ctx, d, fn) => ctx.host.copy(chore(d, fn), "chore")) },
  accept: { title: "accepting the function", editsFiles: true, run: withDetail(accept) },
  ignore: { title: "ignoring the file", run: (ctx, rel) => setIgnored(ctx, rel, true) },
  unignore: { title: "showing the file again", run: (ctx, rel) => setIgnored(ctx, rel, false) },
};

async function tickets(ctx: ActionContext): Promise<void> {
  const details = (await Promise.all((await ctx.topFix()).map((s) => ctx.detail(s.path)))).filter((d): d is FileDetail => !!d);
  if (!details.length) return ctx.host.notify("info", "Complexity Lens: nothing to fix right now.");
  await ctx.host.saveText(ticketDrafts(details, guidelines(ctx)), TICKETS_FILE_NAME, `${details.length} ticket drafts`);
}

export const BATCH_ACTIONS: Record<BatchKind, Strategy<[]>> = {
  fixAll: {
    title: "preparing the fix-all prompt",
    run: async (ctx) => ctx.host.copy(fixAllPrompt((await ctx.changeItems()).filter((s) => s.problems.length), guidelines(ctx)), "fix-all prompt"),
  },
  prSummary: { title: "preparing the PR summary", run: async (ctx) => ctx.host.copy(prSummary(await ctx.changeItems()), "PR summary") },
  tickets: { title: "preparing ticket drafts", run: tickets },
  choreList: { title: "preparing the chore list", run: async (ctx) => ctx.host.copy(choreList(await ctx.topFix()), "chore list") },
};
