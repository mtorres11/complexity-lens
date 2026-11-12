// Minimal, safe glob matching for repo-relative paths.
// Supports: **  (any number of folders), *  (anything except "/"), ?  (one character),
// {a,b,c} (alternatives, not nested). Every other character is matched literally,
// so patterns from a repo config can never become an arbitrary regular expression.

const cache = new Map<string, RegExp>();

// complexity-ok: single-pass tokenizer; the branches mirror the pattern syntax one to one
export function globToRegExp(pattern: string): RegExp {
  const hit = cache.get(pattern);
  if (hit) return hit;
  let re = "";
  let i = 0;
  let inGroup = false;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      const slashAfter = pattern[i + 2] === "/";
      re += slashAfter ? "(?:.*/)?" : ".*";
      i += slashAfter ? 3 : 2;
      continue;
    }
    if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "{" && !inGroup) {
      re += "(?:";
      inGroup = true;
    } else if (c === "}" && inGroup) {
      re += ")";
      inGroup = false;
    } else if (c === "," && inGroup) re += "|";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    i++;
  }
  if (inGroup) re += ")";
  const out = new RegExp(`^${re}$`);
  cache.set(pattern, out);
  return out;
}

/** Normalises a path to forward slashes without a leading "./". */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function matchesAny(path: string, patterns: readonly string[]): boolean {
  const p = normalizePath(path);
  return patterns.some((g) => globToRegExp(normalizePath(g)).test(p));
}
