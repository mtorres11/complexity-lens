// "Preview fix": asks the AI for the fixed files, shows them next to the current ones without
// writing anything, and applies them only when the user says so (Apply / Try again / Discard).

import { fixPromptFor, redPromptFor } from "../core/actionText";
import type { FileDetail, FunctionDetail } from "../core/insights";
import { hasRed } from "../core/limits";
import { metricChanges, parseProposal, previewPrompt, proposalSummary } from "../core/preview";
import type { Project } from "../node/project";
import type { ActionContext } from "./actions";
import type { ReviewFile } from "./host";

type Kind = "red" | "fix";

const KINDS: { id: Kind; label: string; detail: string }[] = [
  { id: "red", label: "🎯 Only the red metrics", detail: "Explain red: the smallest change that brings them within their limits, with no new findings" },
  { id: "fix", label: "✨ Full refactor", detail: "Fix with AI: the design rules, including a file split when one is suggested" },
];
const PROMPTS: Record<Kind, (d: FileDetail, fn: FunctionDetail | undefined, extra: readonly string[]) => string> = { red: redPromptFor, fix: fixPromptFor };

/** Files bigger than this are not previewed: the AI would have to write them out in full. */
const DEFAULT_MAX_TOKENS = 8000;

/** The proposed files that differ from what is there now; refuses paths outside the repo. */
export function proposedFiles(project: Project, answer: string): ReviewFile[] {
  return parseProposal(answer).flatMap(({ path, content }) => {
    const rel = path.replace(/^\.\//, "");
    const absPath = project.absolute(rel);
    if (!absPath) throw new Error(`The answer proposes a file outside the repository (${path}), so it was not used.`);
    const before = project.readWorking(rel);
    return before === content ? [] : [{ rel, absPath, before, after: content }];
  });
}

/** The headline and per-file metrics before → after, measured with the repo's own rules. */
export function reviewSummary(project: Project, files: readonly ReviewFile[]): string {
  return proposalSummary(
    files.map((f) => {
      if (!project.includes(f.rel)) return { path: f.rel };
      const after = project.metrics(f.rel, f.after);
      const before = f.before === undefined ? undefined : project.metrics(f.rel, f.before);
      return { path: f.rel, changes: after && metricChanges(before, after, project.settings(f.rel)) };
    }),
  );
}

/** Writes the files, unless one changed on disk after the preview was made. */
async function apply(ctx: ActionContext, files: ReviewFile[]): Promise<void> {
  const moved = files.find((f) => ctx.project.readWorking(f.rel) !== f.before);
  if (moved) throw new Error(`${moved.rel} changed after the preview was made. Run Preview fix again.`);
  await ctx.host.writeFiles(files.map((f) => ({ absPath: f.absPath, content: f.after })));
}

export async function previewFix(ctx: ActionContext, d: FileDetail, fn: FunctionDetail | undefined, extra: readonly string[]): Promise<void> {
  const max = d.limits.fileTokens ?? DEFAULT_MAX_TOKENS;
  if (d.fileTokens > max) return ctx.host.notify("info", `Complexity Lens: ${d.path} is too big to preview (over ${max} tokens). Use Fix with AI instead.`);
  const red = fn ? fn.over : hasRed(d);
  const kind = await ctx.host.choose("Preview which fix?", red ? KINDS : KINDS.filter((k) => k.id === "fix"));
  if (!kind) return;
  const prompt = previewPrompt(PROMPTS[kind](d, fn, extra));
  for (;;) {
    let files: ReviewFile[] = [];
    await ctx.host.withProgress("Complexity Lens: asking Claude for a fix (this can take a minute)…", async () => {
      files = proposedFiles(ctx.project, await ctx.askAi(prompt));
    });
    if (!files.length) throw new Error("The answer had no changed files in the expected format. Try Preview fix again.");
    const decision = await ctx.host.review(files, reviewSummary(ctx.project, files));
    if (decision === "apply") await apply(ctx, files);
    if (decision !== "retry") return;
  }
}
