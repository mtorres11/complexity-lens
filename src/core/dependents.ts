// Afferent coupling: which files in the repo import a given file (its "blast radius").

/** target file -> files that import it */
export type DependentsIndex = Map<string, Set<string>>;

export function buildDependents(
  files: readonly string[],
  importsOf: (rel: string) => string[] | undefined,
  resolve: (from: string, spec: string) => string | undefined,
): DependentsIndex {
  const index: DependentsIndex = new Map();
  for (const from of files) {
    for (const spec of importsOf(from) ?? []) {
      const target = resolve(from, spec);
      if (!target || target === from) continue;
      const set = index.get(target) ?? new Set<string>();
      set.add(from);
      index.set(target, set);
    }
  }
  return index;
}

export interface Coupling {
  /** Afferent: files that import this one. */
  ca: number;
  /** Efferent: modules this file imports. */
  ce: number;
  /** Ce / (Ca + Ce): 0 = stable (many depend on it), 1 = unstable (depends on many). */
  instability: number;
}

export function coupling(ca: number, ce: number): Coupling {
  return { ca, ce, instability: ca + ce === 0 ? 0 : Math.round((ce / (ca + ce)) * 100) / 100 };
}
