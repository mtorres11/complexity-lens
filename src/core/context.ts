// Context load: estimated tokens an AI agent reads to work on a file (the file plus its imports).

import type { FileMetrics } from "./analyze";

export interface ContextLoad {
  /** Tokens of the file itself. */
  own: number;
  /** Tokens of the counted imports. */
  fromImports: number;
  total: number;
  /** Counted imports, largest first. */
  imports: { path: string; tokens: number }[];
  /** Imports matched by tokens.ignoreImports: listed, not counted. */
  ignored: string[];
}

/** Context load of one version of a file: its own tokens plus today's imports (a baseline reuses them). */
export const contextTokensOf = (m: FileMetrics, ctx: ContextLoad): number => m.fileTokens + ctx.fromImports;
