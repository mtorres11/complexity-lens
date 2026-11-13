# Security Assessment: Complexity Lens

| | |
|---|---|
| Version assessed | 0.2.0 |
| Date | 2026-11-12 |
| Scope | Extension (`src/extension.ts`, `src/vscode/`), checker (`src/core/`, `src/cli/`), webview (`media/`), manifest, build and release pipeline, dependencies |
| Result | No open high or medium findings. 0 known dependency vulnerabilities. No runtime dependencies outside the bundle. |

## 1. Architecture

```
 VS Code extension host                         AI agent hook / CI       
 ┌──────────────────────────────────────┐       ┌───────────────────────────────┐
 │ extension.ts ─ sidebar / CodeLens /   │       │ hook: node ~/.complexity-lens │
 │                status bar             │       │       /cli.js hook post-edit  │
 │        │                              │       │ CI:   node complexity-lens-   │
 │        ▼                              │       │       cli.js check --base ... │
 │ core/ (shared with the CLI)           │◀──────┤       (same core/ code)       │
 │  analyze  - TypeScript parser only    │       └───────────────────────────────┘
 │  config   - validated repo rules      │
 │  evaluate - ratchet / absolute        │       Reads: source files, complexity-lens.json,
 │  git      - read-only, no shell       │              git history (read-only)
 │  project  - paths confined to repo    │       Writes: only what the user confirms
 └──────────────────────────────────────┘               (config file, hook settings,
 Webview: strict CSP, nonce script, no network,          ~/.complexity-lens/cli.js) and a
          DOM built with textContent only                 retry counter inside .git/
```

**Network:** none. The extension, the CLI and the hook make no network requests.

**Data written:**

| What | Where | When |
|---|---|---|
| `complexity-lens.json` | Repo root | Only via the "Open or Create Repo Config" command or `init`; never overwrites an existing file |
| Hook entries | The agent settings file the user chooses (inside the repo, `.json` only) | Only after a modal showing the exact JSON |
| Checker copy | `~/.complexity-lens/cli.js` (folder `0700`) | On hook install; refreshed on activation only if it already exists and carries the Complexity Lens marker |
| Agent session state (files the session edited, retry counter) | `.git/complexity-lens/session-<hash>.json` (`0600`) | During agent sessions |
| Ticket drafts | A Markdown file the user picks in a save dialog | Only when the user chooses *Save as Markdown file…* |
| `// complexity-ok: <reason>` comment | Above the chosen function | Only via *Accept…*, after the user types the reason; disabled in Restricted Mode |
| Ignored files list | VS Code workspace state (local) | Only via *Ignore* |

## 2. Threat model and controls

| Threat | Control |
|---|---|
| **A cloned repo runs commands through git** (`core.fsmonitor`, hooks, external diff, textconv, pager) | Every git call adds `-c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.external= -c core.pager=cat --no-pager --no-optional-locks`. Blobs are read with `git cat-file blob` (no filters). Verified with a test repo whose `core.fsmonitor` command runs on plain `git status` but not with Complexity Lens. |
| **Shell or option injection** | Git runs via `execFile` (no shell) with argument arrays. User-supplied refs (`--base`) must match a strict pattern, can't start with `-` and can't contain `..`. |
| **Malicious `complexity-lens.json`** | Treated as data. Strict validation (types, ranges, enums, max sizes); unknown keys ignored. Patterns must be relative and can't contain `..`. The file is capped at 256 KB. It can't name commands, URLs or paths. |
| **Regex denial of service** | Patterns are converted to regular expressions with every non-pattern character escaped; no user-supplied regex. The allow-comment marker is restricted to `[a-z0-9-]`. |
| **Reading outside the repo / symlink tricks** | All paths are resolved and checked to stay inside the repo root; files are read only if `lstat` says they're regular files (no symlinks), and are capped at 2 MB. |
| **Hook input abuse** | The hook reads at most 1 MB of JSON, only reacts to `Write`/`Edit`/`MultiEdit`, requires an absolute file path inside the repo and included by the config, and fails open (silent, exit 0) on any error. |
| **Git history** | Churn reads `git log --numstat` (same safe git flags). Author emails are only counted per file in memory; they're never stored, shown or exported. |
| **Clipboard** | Prompts, tickets and summaries are built in the extension host from its own analysis and written only when the user clicks a button. |
| **Agent loops** | `onFinish: "block"` is capped by `maxRetries` (max 10, default 2), with a per-session counter, then reports to the user instead. |
| **Hook installer abuse** | Disabled in Restricted Mode. Shows the exact JSON and target file in a modal before writing. Merges into existing settings without removing anything, and refuses to touch a settings file that isn't valid JSON. The hook command is a fixed string with no repo data interpolated, and is guarded so it's a no-op when the checker isn't installed. Never overwrites a `~/.complexity-lens/cli.js` it didn't create. |
| **XSS in the sidebar** (file paths, function names) | DOM built with `textContent`/`createElement` only. CSP `default-src 'none'`, script by nonce (`crypto.randomBytes`), styles from the extension only. |
| **Forged webview messages** | Only enum values (scope, sort) are accepted, and files can only be opened if they're in the current report, at a validated line number. |
| **Restricted Mode** | `untrustedWorkspaces: limited`: source files are analysed, but git is never invoked and the hook can't be installed. |
| **Large repositories** | Whole-repo scope is capped (`complexityLens.maxFiles`), work runs in batches that yield to the editor, results are cached by modification time, and git calls time out after 30 s. |

## 3. Dependencies

- **Shipped:** the extension and the CLI are each a single bundled file containing this repo's code plus the
  **TypeScript** parser (Apache-2.0, license notice included in `dist/*.LEGAL.txt`). No `node_modules` are shipped.
- **Build only:** `typescript`, `esbuild`, `@vscode/vsce` (with a patched `minimatch` pinned through `overrides`), `@types/*`.
- `npm audit`: **0 vulnerabilities** at the time of assessment. All packages resolve from `registry.npmjs.org`.
- CI installs with `npm ci --ignore-scripts`; Dependabot proposes weekly updates for npm and GitHub Actions.

## 4. Build and release

- Releases are built only by GitHub Actions from a `v*` tag matching `package.json`'s version. Tests must pass first.
- Third-party actions are pinned to full commit SHAs, and workflows default to `contents: read`.
- The `.vsix` and the standalone `complexity-lens-cli.js` carry signed **build-provenance attestations** and `SHA256SUMS.txt`.
- Marketplace publishing (optional) runs in a protected environment that needs the owner's approval, verifies the
  attestation, and publishes that exact file.
- CI also runs Complexity Lens on its own source under the strict absolute policy.

## 5. Residual risks (accepted)

- **Token counts are estimates** (about 3.5 characters per token), not a real tokenizer.
- **Functions are matched by name across versions**, so a renamed function counts as new under the ratchet policy.
- **The hook checks all uncommitted changes** in the repo, including the user's own, not only the agent's edits.
- **The hook command needs a POSIX shell** (macOS, Linux, Git Bash/WSL on Windows).
