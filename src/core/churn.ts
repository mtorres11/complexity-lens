// Code churn (volatility) per file from git history: how often and how much it changes.

export interface Churn {
  commits: number;
  added: number;
  deleted: number;
  authors: number;
  /** Unix time (seconds) of the latest change, or 0. */
  lastChange: number;
  /** Commits per week, oldest first. */
  weekly: number[];
}

type Acc = { commits: number; added: number; deleted: number; authors: Set<string>; last: number; weekly: number[] };

export const emptyChurn = (weeks: number): Churn => ({ commits: 0, added: 0, deleted: 0, authors: 0, lastChange: 0, weekly: new Array(weeks).fill(0) });

function weekIndex(ts: number, now: number, weeks: number): number {
  const ago = Math.floor((now - ts) / (7 * 86400));
  return Math.min(weeks - 1, Math.max(0, weeks - 1 - ago));
}

/** Parses `logNumstat` output. `now` is in unix seconds (injectable for tests). */
export function parseChurn(raw: string, days: number, now = Math.floor(Date.now() / 1000)): Map<string, Churn> {
  const weeks = Math.min(26, Math.max(1, Math.ceil(days / 7)));
  const acc = new Map<string, Acc>();
  let ts = 0;
  let author = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("\x01")) {
      [ts, author] = ((p) => [Number(p[0]) || 0, p[1] ?? ""] as [number, string])(line.slice(1).split("\t"));
      continue;
    }
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    const a = acc.get(m[3]) ?? { commits: 0, added: 0, deleted: 0, authors: new Set<string>(), last: 0, weekly: new Array(weeks).fill(0) };
    a.commits += 1;
    a.added += Number(m[1]) || 0;
    a.deleted += Number(m[2]) || 0;
    a.authors.add(author);
    a.last = Math.max(a.last, ts);
    a.weekly[weekIndex(ts, now, weeks)] += 1;
    acc.set(m[3], a);
  }
  const out = new Map<string, Churn>();
  for (const [file, a] of acc) {
    out.set(file, { commits: a.commits, added: a.added, deleted: a.deleted, authors: a.authors.size, lastChange: a.last, weekly: a.weekly });
  }
  return out;
}
