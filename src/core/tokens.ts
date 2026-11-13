/** Rough token estimate for source code (~3.5 characters per token). Never exact. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
