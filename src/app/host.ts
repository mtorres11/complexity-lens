// What the sidebar needs from the editor that hosts it. The VS Code adapter implements it;
// everything else in src/app is host-neutral.

import type { ToWebview } from "../shared/protocol";

export type HostCommand = "openConfig" | "installHook" | "openRepo";

export interface HostPort {
  /** Sends a message to the panel. */
  post(message: ToWebview): void;
  /** Whether the panel is on screen (refreshes are skipped when it isn't). */
  visible(): boolean;
  /** Per-repo panel state (tab, compared branch, ignored files). */
  getState<T>(key: string, fallback: T): T;
  setState(key: string, value: unknown): Promise<void>;
  /** The user's settings for the extension (scope, sort, maxFiles, fixPromptGuidelines). */
  getSetting<T>(key: string, fallback: T): T;
  setSetting(key: string, value: unknown): Promise<void>;
  openFile(absPath: string, line: number): Promise<void>;
  /** Copies text and says so; `what` names it ("fix prompt"). */
  copy(text: string, what: string): Promise<void>;
  /** Copies Markdown, or saves it as a file the user picks (suggested name in the repo root). */
  saveText(text: string, suggestedName: string, what: string): Promise<void>;
  /** Asks for a line of text; undefined when cancelled. */
  prompt(options: { title: string; prompt: string; validate: (value: string) => string | undefined }): Promise<string | undefined>;
  /** Inserts a line above `line` (1-based) with that line's indentation, and shows it. */
  insertLine(absPath: string, line: number, text: string): Promise<void>;
  notify(level: "info" | "warning" | "error", text: string): void;
  /** Runs a user action while showing progress. */
  withProgress(title: string, run: () => Promise<void>): Promise<void>;
  run(command: HostCommand): void;
}
