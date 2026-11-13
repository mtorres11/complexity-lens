// The author credit and repository link shown in the sidebar footer.

export interface About {
  author: string;
  version: string;
  /** https URL of the source repository, or "" if unknown. */
  repoUrl: string;
}

/** Author, version and repo link from the extension's package.json. */
export function aboutFrom(pkg: {
  author?: unknown;
  version?: unknown;
  repository?: unknown;
}): About {
  const author =
    typeof pkg.author === "string"
      ? pkg.author
      : ((pkg.author as { name?: unknown } | undefined)?.name ?? "");
  const repo =
    typeof pkg.repository === "string"
      ? pkg.repository
      : ((pkg.repository as { url?: unknown } | undefined)?.url ?? "");
  const url = String(repo)
    .replace(/^git\+/, "")
    .replace(/\.git$/, "");
  return {
    author: String(author),
    version: String(pkg.version ?? ""),
    repoUrl: /^https:\/\/\S+$/.test(url) ? url : "",
  };
}

