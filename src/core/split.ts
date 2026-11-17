// How to split a file that does unrelated jobs: which declarations go into which new file.

import type { FileMetrics } from "./analyze";
import type { CohesionGroup } from "./cohesion";
import type { FileSettings } from "./config";
import { isOver, judgedLcom } from "./limits";

export interface SplitPart {
  file: string;
  members: string[];
  tokens: number;
}

export interface SplitSuggestion {
  parts: SplitPart[];
  /** Tokens an agent no longer reads per edit (whole file minus the largest part). */
  savesTokens: number;
}

const STOP = new Set([
  "get",
  "set",
  "to",
  "from",
  "is",
  "has",
  "create",
  "build",
  "handle",
  "make",
  "on",
  "the",
  "with",
  "for",
  "of",
  "and",
  "new",
  "default",
  "init",
  "run",
  "do",
]);

const words = (name: string) =>
  name
    .replace(/^.*\./, "")
    .split(/(?=[A-Z])|[_\-\s]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 2 && !STOP.has(w));

/**
 * Prefix for the new files. A file named like `name.role.ts` (e.g. `orders.tool.ts`) follows a
 * naming pattern, so its parts are `name.<word>.ts`; a plain `orders.ts` gets plain `<word>.ts`.
 */
function partPrefix(path: string): string {
  const parts = (path.split("/").pop() ?? "").split(".");
  return parts.length > 2 ? `${parts[0]}.` : "";
}

/** Words after the first: the leading verb (resolve, format, parse…) says nothing about the subject. */
const subjectWords = (name: string) => words(name.replace(/^[a-z]+(?=[A-Z0-9_])/, ""));

const sharedWords = (a: string[], b: string[]) => {
  const wb = new Set(b.flatMap(subjectWords));
  return new Set(a.flatMap(subjectWords).filter((w) => wb.has(w))).size;
};

/** A single declaration this long is worth a file of its own. */
const MIN_STANDALONE_LINES = 40;

/**
 * A small group with one member would make a file with one small declaration (e.g. one constant).
 * Merge it into the group whose names share the most words with it; when none do, it stays in the file.
 */
function mergeSingles(groups: CohesionGroup[]): CohesionGroup[] {
  const out = groups.map((g) => ({ ...g, members: [...g.members] }));
  const smallSingles = out.filter((g) => g.members.length === 1 && g.lines < MIN_STANDALONE_LINES);
  for (const single of smallSingles) {
    const target = out
      .filter((g) => g !== single && g.members.length > 0)
      .map((g) => ({ g, shared: sharedWords(single.members, g.members) }))
      .filter((c) => c.shared > 0)
      .sort((a, b) => b.shared - a.shared)[0]?.g;
    if (target) {
      target.members.push(...single.members);
      target.lines += single.lines;
      target.tokens += single.tokens;
    }
    single.members = [];
  }
  return out.filter((g) => g.members.length > 0);
}

/** The most common meaningful word in the members' names: what the group is about. */
function subject(members: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const w of members.flatMap(words))
    counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0]?.[0];
}

interface NamedGroup {
  name: string | undefined;
  group: CohesionGroup;
}

/** Groups about the same subject belong in one file, not in name, name2, name3. */
function mergeBySubject(groups: CohesionGroup[]): NamedGroup[] {
  const out: NamedGroup[] = [];
  const byName = new Map<string, NamedGroup>();
  for (const group of groups) {
    const name = subject(group.members);
    const same = name === undefined ? undefined : byName.get(name);
    if (same) {
      same.group = {
        members: [...same.group.members, ...group.members],
        lines: same.group.lines + group.lines,
        tokens: same.group.tokens + group.tokens,
      };
      continue;
    }
    const entry = { name, group };
    out.push(entry);
    if (name !== undefined) byName.set(name, entry);
  }
  return out;
}

export function suggestSplit(
  m: FileMetrics,
  s: FileSettings,
): SplitSuggestion | undefined {
  const mod = m.cohesion.find((c) => c.scope === "module");
  if (!mod || mod.groups.length < 2) return undefined;
  const L = s.limits;
  const big = isOver(m.fileLines, L.fileLines) || isOver(m.fileTokens, L.fileTokens) || isOver(judgedLcom(m, s), L.lcom);
  if (!big) return undefined;
  const ext = (/\.[^.]+$/.exec(m.path) ?? [".ts"])[0];
  const prefix = partPrefix(m.path);
  const groups = mergeBySubject(mergeSingles(mod.groups));
  if (groups.length < 2) return undefined;
  const parts = groups
    .slice(0, 5)
    .map(({ name, group }, i) => ({
      file: `${prefix}${name ?? `part${i + 1}`}${ext}`,
      members: group.members,
      tokens: group.tokens,
    }));
  const largest = Math.max(...parts.map((p) => p.tokens));
  return { parts, savesTokens: Math.max(0, m.fileTokens - largest) };
}
