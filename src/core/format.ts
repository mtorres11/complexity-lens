// Number formatting shared by every output.

/** Token counts for people: 950, 1.2k, 12k, 1.5M. */
export function formatTokens(n: number): string {
  if (n >= 1e6) return `${Math.round(n / 1e5) / 10}M`;
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return `${n}`;
}

/** "cognitive" → "Cognitive". */
export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);
