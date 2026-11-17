// Action buttons. The webview only names the action, the file and the function; the host
// builds every text from its own data.

import type { ActionKind } from "../vscode/protocol";
import { button, h, send } from "./dom";

const BUTTON: Record<ActionKind, { label: string; title?: string }> = {
  fixPrompt: { label: "✨ Fix with AI", title: "Copy a prompt for your AI agent" },
  ticket: { label: "🎫 Ticket draft", title: "Copy or save a ready-to-file ticket" },
  chore: { label: "🧹 Chore", title: "Copy a one-line chore" },
  accept: { label: "Accept…", title: "Keep it as is, with a reason in the code" },
  ignore: { label: "Ignore", title: "Hide it from What to fix (on this machine)" },
  unignore: { label: "Show again", title: "Show it in What to fix again" },
};

/** One action button for a file, or for one of its functions when `fn` is given. */
export function actionButton(kind: ActionKind, path: string, fn?: string, disabled = false): HTMLElement {
  return button(BUTTON[kind].label, () => send({ type: "action", kind, path, fn }), { title: BUTTON[kind].title, disabled });
}

/** A row of action buttons that all act on the same file (and function). */
export const actionButtons = (path: string, fn: string | undefined, kinds: ActionKind[]): HTMLElement =>
  h("div", { class: "actions" }, ...kinds.map((k) => actionButton(k, path, fn)));
