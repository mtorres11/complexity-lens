# Complexity Lens: user manual

**Version 0.1.1** · Created by Marco Torres C · [Repository](https://github.com/mtorres11/complexity-lens)

Complexity Lens shows **how complex your code is** and **how much it costs an AI agent to read**, for every file and
function. It then keeps AI-written code simple with an **agent hook** (feedback right after each edit) and a
**CI check** (a guard on pull requests).

It runs **locally only**: no telemetry, no network calls. It supports **TypeScript and JavaScript**
(`.ts .tsx .js .jsx .mts .cts .mjs .cjs`).

This manual is a complete, tutorial-style guide. For quick reference see also
[INSTALL.md](INSTALL.md), [CONFIGURATION.md](CONFIGURATION.md) and [CI.md](CI.md).

---

## Contents

1. [Why it exists](#1-why-it-exists)
2. [Install](#2-install)
3. [Five-minute tour](#3-five-minute-tour)
4. [What is measured](#4-what-is-measured)
5. [The sidebar](#5-the-sidebar)
6. [In the editor: inline scores and status bar](#6-in-the-editor-inline-scores-and-status-bar)
7. [Rules for your repository: `complexity-lens.json`](#7-rules-for-your-repository-complexity-lensjson)
8. [The ratchet: adopt it on day one](#8-the-ratchet-adopt-it-on-day-one)
9. [Tutorial A: find what to fix first](#9-tutorial-a-find-what-to-fix-first)
10. [Tutorial B: keep an AI agent's code simple (agent hook)](#10-tutorial-b-keep-an-ai-agents-code-simple-agent-hook)
11. [Tutorial C: guard pull requests (CI)](#11-tutorial-c-guard-pull-requests-ci)
12. [Tutorial D: roll it out to a team](#12-tutorial-d-roll-it-out-to-a-team)
13. [The escape hatch: `complexity-ok`](#13-the-escape-hatch-complexity-ok)
14. [Command-line reference](#14-command-line-reference)
15. [VS Code commands and settings](#15-vs-code-commands-and-settings)
16. [Security and privacy](#16-security-and-privacy)
17. [Troubleshooting](#17-troubleshooting)
18. [FAQ](#18-faq)
19. [Using it with Change Map](#19-using-it-with-change-map)

---

## 1. Why it exists

AI agents write code quickly and tend to make it **longer and more nested** than needed. Two costs follow:

- **Bugs:** deeply nested, branchy functions are where both people and AI make logic mistakes.
- **Tokens:** every time an agent opens a file, it pays to read it *and* what it imports. Big, tangled files make every
  later task slower and more expensive.

Complexity Lens makes both visible, and closes the loop. The agent is told about a problem **right after the edit that
caused it**, while fixing it is cheap. CI catches anything that slipped through.

---

## 2. Install

### Requirements

| Need | For |
| --- | --- |
| VS Code 1.95+ | The extension |
| git | Changed files, comparisons and hotspots |
| Node.js 20+ on `PATH` | The agent hook and CI only |
| GitHub CLI (`gh`), optional | One-command install and verifying downloads |
| A POSIX shell (macOS, Linux, Git Bash/WSL on Windows) | The agent hook only |

### Install the extension

```sh
gh release download --repo mtorres11/complexity-lens --pattern '*.vsix' --dir /tmp --clobber
code --install-extension /tmp/complexity-lens.vsix --force
```

Or download `complexity-lens.vsix` from the [latest release](https://github.com/mtorres11/complexity-lens/releases/latest)
and use **Extensions → `…` → Install from VSIX…**.

**Optional: check the download is genuine**

```sh
gh attestation verify /tmp/complexity-lens.vsix --repo mtorres11/complexity-lens
```

Then **Developer: Reload Window**, and click the **magnifier** icon in the Activity Bar.
Tip: right-click the icon → **Move To → Secondary Side Bar** to keep it on the right, next to your code.

### Update and uninstall

- **Update:** install the newer `.vsix` the same way. Settings and the hook are kept, and the hook's checker copy updates itself.
- **Uninstall:** `code --uninstall-extension mtorres11.complexity-lens`, then remove the two `complexity-lens` hook entries
  from your agent's hook settings file and delete `~/.complexity-lens/` (if you installed the hook).

---

## 3. Five-minute tour

1. Open a TypeScript or JavaScript repository and click the **magnifier** in the Activity Bar.
2. **Scope: Changed files** lists files changed since the last commit. Edit any function and it appears.
3. Switch **Scope** to **Whole repo** and **Sort** to **Complexity**. Your most complicated files are now at the top.
4. Click a file's **▸ N problem(s)** to expand it, then click **line 42** to jump to the problem.
5. In the editor, look above each function: `complexity 18 ⚠ · 62 lines · nesting 3`.
6. Look at the **status bar** for the current file's highest complexity and AI cost. Click an inline score for the full breakdown.
7. Click **Rules…** → pick **recommended** to create `complexity-lens.json`, then commit it.
8. If you use an AI coding agent with command hooks, click **Agent hook…** and follow the prompts (see [Tutorial B](#10-tutorial-b-keep-an-ai-agents-code-simple-agent-hook)).

---

## 4. What is measured

### Per function

| Metric | What it means | Default limit (recommended) |
| --- | --- | --- |
| **Cognitive complexity** | How hard the function is to follow ([SonarSource method](https://www.sonarsource.com/docs/CognitiveComplexity.pdf)) | 15 |
| **Lines** | Length of the function | 60 |
| **Nesting depth** | `if` / loop / `switch` / `try` inside each other | 4 |
| **Parameters** | Number of inputs | 5 |

### Per file

| Metric | What it means | Default limit (recommended) |
| --- | --- | --- |
| **File lines** | Length of the file | 400 |
| **Tokens** | Estimated tokens to read the file (about 3.5 characters per token) | 8000 |
| **Imports** | Modules the file depends on (coupling) | 15 |
| **AI cost** | Tokens for the file **plus its direct relative imports**: what an agent realistically reads to change it | (shown, not limited) |
| **Hotspot** | Complexity × how many commits touched the file recently (default 90 days) | (used for sorting) |

### How cognitive complexity is counted

- **+1** for each `if`, `else if`, `else`, ternary `?:`, `switch`, loop, `catch`, labelled `break`/`continue`, and each run
  of mixed `&&` / `||` / `??`.
- Structures **nested** inside others add **+1 per level of nesting** on top. This is what makes deep nesting expensive.
- **Named** functions (declarations, methods, functions assigned to a name) are measured on their own.
- **Anonymous callbacks** count towards the function that contains them, one nesting level deeper.

A worked example:

```ts
function ship(order) {                 // complexity:
  if (!order) return;                  // +1  if
  for (const item of order.items) {    // +1  loop
    if (item.fragile && !item.boxed) { // +2  if (nested 1 level) +1 for &&  → +3
      wrap(item);
    } else {                           // +1  else
      pack(item);
    }
  }
}                                      // total = 6
```

---

## 5. The sidebar

```
Scope  [ Changed files ▾ ]            ← Changed files · Whole repo · Current file
Sort   [ AI cost ▾ ]                  ← AI cost · Complexity · Hotspot · Name
Repo   [ Rules… ]  [ Agent hook… ]

4 file(s) · 3 problem(s) · AI context ≈21.4k tokens

┌ src/finder/query.ts                         ▲ 14 → 28 ┐
│ Complexity 28 │ Size 312 │ Coupling 9 │ AI cost ≈6.1k │   ← four bars: green → mustard → red
│ ▸ 2 problem(s), 1 note(s)                            │
└──────────────────────────────────────────────────────┘
Created by Marco Torres C · GitHub · v0.1.1 · local only, no telemetry
```

### Controls

| Control | Options |
| --- | --- |
| **Scope** | **Changed files**: changed since the last commit, including uncommitted and untracked files. **Whole repo**: every included file, up to `complexityLens.maxFiles`. **Current file**: the file open in the editor. |
| **Sort** | **AI cost**: most expensive to read first. **Complexity**: worst function first. **Hotspot**: complex *and* frequently changed first. **Name**. |
| **Rules…** | Opens `complexity-lens.json`, or creates it from a preset |
| **Agent hook…** | Installs the agent hook. Disabled in Restricted Mode. |

### Each file card

- **Path:** click to open the file.
- **▲ / ▼ before → after** *(Changed files scope)*: the highest function complexity compared with the last commit.
  ▲ red is worse, ▼ green is better.
- **Four bars**, each coloured **green → mustard → red** as it approaches and passes its limit. Hover for the exact values and limits:
  - **Complexity:** highest function complexity, and which function it is
  - **Size:** file lines
  - **Coupling:** imports
  - **AI cost:** ≈ tokens for the file and its direct imports
- **N commit(s) recently · hotspot score N** *(Whole repo scope or Hotspot sort)*.
- **▸ N problem(s), N note(s):** click to expand. Each line links to the code:
  - **✖** a problem: over a limit, judged by your [policy](#8-the-ratchet-adopt-it-on-day-one)
  - **▼** an improvement: it got better
  - **✓** accepted with a `complexity-ok` comment

### Summary and notices

- **N file(s) · N problem(s) · AI context ≈N tokens** sums up what's listed.
- *Restricted Mode: git features … are off*: trust the folder to enable them.
- *complexity-lens.json: …*: a configuration problem. The preset value is used instead.
- *No changed files to check…*: edit something, or switch Scope.

---

## 6. In the editor: inline scores and status bar

**Inline scores** appear above every function:

```
complexity 18 ⚠ · 62 lines ⚠ · nesting 3
function buildQuery(filters: Filters, opts: Options): Query {
```

- **⚠** marks a value over its limit.
- **Click** the line for the full breakdown: cognitive complexity, lines, nesting and parameters, each with its limit, and *Accepted by comment* when the function has a `complexity-ok` comment.
- Turn them off with `complexityLens.inlineScores: false`.

**Status bar** (bottom): a pulse icon followed by **`18 ⚠ · ≈3.2k tok`** shows the current file's highest function complexity, a warning if it's over
the limit, and its estimated tokens. Hover it for the file's lines, imports and tokens; click it to open the sidebar.
Turn it off with `complexityLens.statusBar: false`.

---

## 7. Rules for your repository: `complexity-lens.json`

Create it with **Rules…** (or **Complexity Lens: Open or Create Repo Config**), or from a terminal:

```sh
node ~/.complexity-lens/cli.js init --preset recommended
```

The file supports comments, and every option is optional. In VS Code, hovering an option explains it and typing
suggests valid values. **Commit it** so everyone, every agent and CI use the same rules.

### Presets

| Preset | Limits | Policy | Hook after edit / on finish | CI | Use for |
| --- | --- | --- | --- | --- | --- |
| `relaxed` | high | ratchet | inform / off | off | Trying it on a big existing codebase |
| `recommended` *(default)* | balanced | ratchet | nudge / block | warn | Day-to-day work |
| `strict` | low | absolute | nudge / block | failOverLimit | New projects |

### Limits by preset

| Limit | relaxed | recommended | strict |
| --- | --- | --- | --- |
| `cognitiveComplexity` | 25 | 15 | 10 |
| `functionLines` | 100 | 60 | 40 |
| `nestingDepth` | 5 | 4 | 3 |
| `parameters` | 7 | 5 | 4 |
| `fileLines` | 800 | 400 | 300 |
| `fileTokens` | 16000 | 8000 | 6000 |
| `imports` | 25 | 15 | 12 |

Set any limit to `null` to switch that check off.

### A complete example

```jsonc
{
  "preset": "recommended",
  "include": ["src/**/*.{ts,tsx,js,jsx}"],
  "exclude": ["**/*.test.*", "**/generated/**", "dist/**"],
  "limits": { "cognitiveComplexity": 15, "functionLines": 60, "fileLines": 400 },
  "policy": "ratchet",
  "allowComment": { "marker": "complexity-ok", "requireReason": true },
  "hook": { "afterEdit": "nudge", "onFinish": "block", "maxRetries": 2 },
  "ci": { "mode": "warn" },
  "tokens": { "includeImports": 1 },
  "hotspots": { "historyDays": 90 },
  "overrides": [
    // Old code: tell me about problems at the end, but don't hold the agent back.
    { "files": ["src/legacy/**"], "hook": { "onFinish": "inform" } },
    // Generated but committed code: no function limits.
    { "files": ["src/api/client/**"], "limits": { "cognitiveComplexity": null, "functionLines": null } }
  ]
}
```

### What each section does

| Section | Summary |
| --- | --- |
| `include` / `exclude` | Repo-relative patterns (`**`, `*`, `?`, `{a,b}`). By default tests, `generated/`, `.d.ts`, build output, `node_modules/`, `vendor/` and `*.min.js` are excluded. |
| `limits` | The thresholds above |
| `policy` | `ratchet` (don't make it worse) or `absolute` (everything under the limits). See [section 8](#8-the-ratchet-adopt-it-on-day-one). |
| `allowComment` | The `complexity-ok` escape hatch. See [section 13](#13-the-escape-hatch-complexity-ok). |
| `hook` | `afterEdit`: `off` / `inform` / `nudge`. `onFinish`: `off` / `inform` / `block`. `maxRetries`: 0–10. |
| `ci.mode` | `off` / `warn` / `failOnRegression` / `failOverLimit` |
| `tokens.includeImports` | Levels of relative imports added to AI cost (0–3, default 1) |
| `hotspots.historyDays` | How far back git history is counted (default 90) |
| `overrides` | Different `limits`, `policy`, `hook` or `allowComment` for matching files, applied in order |

Every option in detail: [CONFIGURATION.md](CONFIGURATION.md). Invalid values fall back to the preset and are reported
in the sidebar, and by `check`, which exits with code 2.

---

## 8. The ratchet: adopt it on day one

Most codebases already have functions over any sensible limit. Flagging all of them would bury everyone in noise.
The default **ratchet** policy avoids that:

| Situation | `ratchet` *(default)* | `absolute` |
| --- | --- | --- |
| **New** function or file over a limit | ✖ problem | ✖ problem |
| **Existing** one over a limit that **got worse** | ✖ problem (`14 → 28, got worse`) | ✖ problem |
| **Existing** one over a limit, **unchanged or better** | fine (better shows ▼) | ✖ problem |
| Code you didn't touch | never flagged | flagged if in the checked files |

- **"Existing"** means present in the baseline: the **last commit** for the editor and the hook, and the **merge base**
  with the target branch for CI (`--base`).
- Functions are matched by name (`Class.method`, `functionName`). **A renamed function counts as new**, so renaming
  an over-limit function makes it a problem until it's under the limit.

The result is that code can only get simpler over time, and nobody is asked to fix old code just because they opened the file.

---

## 9. Tutorial A: find what to fix first

**Goal:** a short, evidence-based list of refactoring targets.

1. **Scope: Whole repo**, **Sort: Hotspot**. The top files are both **complex** and **changed often**, so
   simplifying them pays off on every future change.
2. For each top file, compare the four bars:
   - **Complexity** red: split the worst function (hover the bar to see its name).
   - **Size** or **AI cost** red: split the file by responsibility, so an agent only needs to read the part it changes.
   - **Coupling** red: the file depends on too much. Look for a missing abstraction.
3. Expand **▸ problems** and jump to each one. The inline score above the function shows which limit it breaks.
4. Switch **Sort: AI cost** to find the files that are most expensive to load into an AI's context.
5. For a written report of everything over the limits, including untouched code:

   ```sh
   node ~/.complexity-lens/cli.js check --all --policy absolute --mode warn
   ```

---

## 10. Tutorial B: keep an AI agent's code simple (agent hook)

The hook works with AI coding agents that support **command hooks** which receive JSON on stdin, with a
**`PostToolUse`** event (after a tool runs) and a **`Stop`** event (when the agent tries to finish its turn).

### Install

1. Click **Agent hook…** in the sidebar, or run **Complexity Lens: Install Agent Hook**.
2. Enter your agent's **hook settings file**, relative to the repository root:
   - a file that isn't committed applies only to **you**,
   - a committed one applies to the **whole team**.

   To skip this question next time, set it once in the user setting `complexityLens.hookSettingsFile`.
3. Review exactly what will be added, then click **Install**.
4. Start a **new** agent session in that repository.

What it changes:

- **`~/.complexity-lens/cli.js`:** a copy of the checker, which the extension keeps up to date.
- **Two hook entries** in the settings file you chose: one after edits, one before finishing. They're guarded, so a
  teammate without the extension gets a silent no-op, not an error.

### What happens after an edit (`hook.afterEdit`)

After the agent writes or edits a file that's included by your rules, that file is checked:

| `afterEdit` | Behaviour |
| --- | --- |
| `off` | Nothing |
| `inform` | The agent gets a note ("For information") it may act on |
| `nudge` *(recommended)* | The agent must respond before continuing: simplify, or explain with a `complexity-ok` comment. The edit is kept. |

What the agent sees:

```
Complexity Lens: src/finder/query.ts
  src/finder/query.ts
    ✖ line 42  buildQuery: cognitive complexity 14 → 28 (limit 15, got worse)
  How to fix:
    - extract branches into well-named helpers, return early, or replace nested conditions with a lookup
Simplify before continuing, or add "// complexity-ok: <reason>" above a function if this complexity is necessary.
```

### What happens when the agent tries to finish (`hook.onFinish`)

Every file **changed since the last commit** is checked:

| `onFinish` | Behaviour |
| --- | --- |
| `off` | Nothing |
| `inform` | You get a summary of anything still over the limits |
| `block` *(recommended)* | The agent is sent back to fix the problems, up to `maxRetries` times (default 2). After that it may finish, and the remaining problems are **reported to you** instead. This avoids endless loops. |

### Good to know

- The finish check looks at **every uncommitted change in the repository**, including yours and other tools'. If it
  flags code the agent didn't write, commit or stash that work first, or use an `overrides` entry with
  `"hook": { "onFinish": "inform" }` for those paths.
- If the hook itself fails for any reason (broken config, unexpected input), it **stays silent** and never blocks the agent.
- The retry counter is kept per session under `.git/complexity-lens/` and resets once the problems are gone.

### Remove it

Delete the two `complexity-lens` entries from the hook settings file, and optionally `~/.complexity-lens/`.

---

## 11. Tutorial C: guard pull requests (CI)

The checker is one file, `complexity-lens-cli.js`, attached to every
[release](https://github.com/mtorres11/complexity-lens/releases) with a signed build-provenance attestation. It needs Node.js 20+ and git.

### GitHub Actions

Save as `.github/workflows/complexity.yml`. Pin `CL_VERSION` to a release you have reviewed.

```yaml
name: complexity
on: pull_request
permissions:
  contents: read
jobs:
  complexity:
    runs-on: ubuntu-latest
    env:
      CL_VERSION: v0.1.1
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0            # full history, so the merge base is available
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Download and verify the checker
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release download "$CL_VERSION" --repo mtorres11/complexity-lens --pattern complexity-lens-cli.js
          gh attestation verify complexity-lens-cli.js --repo mtorres11/complexity-lens
      - name: Check complexity
        run: node complexity-lens-cli.js check --base "origin/${{ github.base_ref }}" --format github
```

- `--format github` puts problems as **annotations on the changed lines** of the pull request.
- Pass or fail comes from `ci.mode` in `complexity-lens.json`:

| `ci.mode` | Result |
| --- | --- |
| `off` | No check |
| `warn` *(recommended to start)* | Annotations only; the check passes |
| `failOnRegression` | Fails if the pull request made something worse beyond a limit |
| `failOverLimit` | Fails if any changed file has anything over a limit |

- `--mode <ciMode>` overrides it for one run, for example to try `failOnRegression` before committing to it.
- With `--base`, only files changed since the branch forked from the base are checked, and "existing" means "in the merge base".

### Other CI systems

```sh
node complexity-lens-cli.js check --base origin/main --format text   # human-readable
node complexity-lens-cli.js check --base origin/main --format json   # machine-readable
```

Exit codes: **0** pass, **1** failed (per `ci.mode`), **2** usage or configuration error.

---

## 12. Tutorial D: roll it out to a team

A low-friction path that never blocks anyone on old code:

| Week | Step |
| --- | --- |
| 1 | Commit `complexity-lens.json` with the **`relaxed`** preset. Everyone installs the extension and just looks. |
| 2 | Switch to **`recommended`**: ratchet policy, hook `nudge` / `block`, CI `warn`. Add the CI workflow. |
| 3–4 | Watch the annotations. Tune `limits` and add `overrides` for legacy or generated folders. |
| Later | Move CI to **`failOnRegression`**. New projects can start on **`strict`**. |

Tips:

- Put **company- or project-specific rules only in the repository's `complexity-lens.json`**. The extension ships with no organisation-specific defaults.
- Personal preferences (scope, sort, inline scores) are **user settings**, so a repository can't change how *your* editor looks.
- Agree as a team on when `complexity-ok` is acceptable, and review those reasons in pull requests.

---

## 13. The escape hatch: `complexity-ok`

Some code is complex for good reasons: a parser, a state machine, a performance-critical loop. Accept it explicitly:

```ts
// complexity-ok: hand-written parser state machine; splitting it would hide the transitions
function parse(input: string) { … }
```

- The comment must be **directly above** the function.
- With `requireReason: true` (default), a reason must follow the marker, so reviewers see *why*.
- Accepted functions still appear in the sidebar marked **✓**, but never block the hook or CI.
- Change the marker word with `allowComment.marker` (3–40 lowercase letters, digits or hyphens).

---

## 14. Command-line reference

The CLI is `~/.complexity-lens/cli.js` once the hook is installed, or `complexity-lens-cli.js` from a release.

```text
complexity-lens check [--base <ref>] [--all] [--policy ratchet|absolute] [--format text|github|json] [--mode <ciMode>] [files...]
complexity-lens hook post-edit      # agent hook: after each file edit (JSON on stdin)
complexity-lens hook stop           # agent hook: when the agent tries to finish
complexity-lens init [--preset relaxed|recommended|strict]
```

| `check` option | Meaning |
| --- | --- |
| *(none)* | Files changed since the last commit |
| `--base <ref>` | Files changed since the branch forked from `<ref>`. "Existing" code is judged against the merge base. |
| `--all` | Every included file |
| `files...` | Only these files |
| `--policy absolute` | Audit existing code too (ignores the repository's policy) |
| `--format` | `text` (default), `github` (annotations) or `json` |
| `--mode` | Override `ci.mode`: `off`, `warn`, `failOnRegression`, `failOverLimit` |

Examples:

```sh
node ~/.complexity-lens/cli.js check                                   # my uncommitted changes
node ~/.complexity-lens/cli.js check --base origin/main                # my whole branch
node ~/.complexity-lens/cli.js check src/finder/query.ts               # one file
node ~/.complexity-lens/cli.js check --all --policy absolute --mode warn   # full audit
node ~/.complexity-lens/cli.js init --preset strict                    # new project
```

---

## 15. VS Code commands and settings

### Commands (Cmd/Ctrl+Shift+P)

| Command | Does |
| --- | --- |
| **Complexity Lens: Refresh** | Re-analyse |
| **Complexity Lens: Open or Create Repo Config (complexity-lens.json)** | Open the rules, or create them from a preset |
| **Complexity Lens: Install Agent Hook** | See [Tutorial B](#10-tutorial-b-keep-an-ai-agents-code-simple-agent-hook) |
| **Complexity Lens: Personal Settings** | Open the `complexityLens.*` user settings |
| **View: Show Complexity Lens** | Open the sidebar |

### Personal settings (user-level only)

| Setting | Values | Default |
| --- | --- | --- |
| `complexityLens.scope` | `changed`, `repo`, `current` | `changed` |
| `complexityLens.sort` | `aiCost`, `complexity`, `hotspot`, `name` | `aiCost` |
| `complexityLens.inlineScores` | `true` / `false` | `true` |
| `complexityLens.statusBar` | `true` / `false` | `true` |
| `complexityLens.maxFiles` | 100–20000 | `3000` |
| `complexityLens.hookSettingsFile` | repo-relative `.json` path | *(empty: ask)* |

---

## 16. Security and privacy

- **No telemetry, no network access.** Analysis happens in VS Code or in the local Node process.
- git is run **read-only**, with repository-configurable command hooks switched off.
- In **Restricted Mode** (untrusted folders), git features and hook installation are disabled.
- The hook installer shows exactly what it will write before writing it, and only touches the file you choose.
- CI downloads can be verified with `gh attestation verify`.

Details: [SECURITY.md](../SECURITY.md) and [SECURITY_ASSESSMENT.md](SECURITY_ASSESSMENT.md).

---

## 17. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Sidebar is empty on **Changed files** | Nothing has changed since the last commit. Edit a file, or switch Scope to **Whole repo**. |
| *Restricted Mode* notice | **Manage Workspace Trust** → trust the folder. |
| A file isn't listed | Check `include` / `exclude`. Tests, build output and `node_modules` are skipped by default. |
| *complexity-lens.json: …* notice | Fix the reported option. Until then the preset value is used, and `check` exits with code 2. |
| The hook does nothing | Start a **new** agent session. Check that `node --version` works in a terminal, that `~/.complexity-lens/cli.js` exists, and that the file is included by your rules. |
| The agent keeps being sent back | Lower `hook.maxRetries`, set `onFinish` to `inform`, or accept the function with `// complexity-ok: <reason>`. |
| The finish check flags code the agent didn't write | It checks every uncommitted change in the repository. Commit or stash other work first. |
| A renamed function is suddenly a problem | Renames count as new under the ratchet. Bring it under the limit, or accept it with `complexity-ok`. |
| Numbers look different from another tool | Cognitive complexity is not cyclomatic complexity. See [section 4](#4-what-is-measured). Tokens are an estimate (about 3.5 characters per token). |
| Whole repo is slow or incomplete | Narrow `include`, or lower or raise `complexityLens.maxFiles`. A *Showing the first files only* note means the cap was hit. |

---

## 18. FAQ

**Does it send my code anywhere?** No. There are no network calls and no telemetry.

**Which AI agents work with the hook?** Any agent that runs command hooks with JSON on stdin and has `PostToolUse` and
`Stop` events. Point **Install Agent Hook** at that agent's hook settings file.

**Will teammates without the extension get errors from a committed hook?** No. The entries are guarded and do nothing if the checker isn't installed.

**Is the AI cost exact?** No. It's an estimate (about 3.5 characters per token) of the file plus its direct relative imports.
Use it to compare files, not as a bill.

**Why ratchet by default?** So you can adopt it in any codebase on day one without noise about code nobody touched.

**Can I use it without VS Code?** Yes. The CLI (`check`, `init`, `hook`) works on its own, which is how CI uses it.

---

## 19. Using it with Change Map

[Change Map](https://github.com/mtorres11/change-map) is a companion extension by the same author. It draws a package as a
zoomable diagram, shows an AI plan on that diagram before any code is written, and compares any two branches the same way.

1. **Before coding:** in Change Map's Plan mode, check where the ticket will land. Turn on 🔥 Heat to spot plans that touch
   the most complex code.
2. **While coding:** Complexity Lens's agent hook keeps each edit under the limits.
3. **Before merging:** Change Map's Compare mode shows complexity before → after per function, and Complexity Lens's CI check guards the pull request.

Change Map's `cx` is *cyclomatic* complexity (number of paths). Complexity Lens uses *cognitive* complexity (how hard the code is to follow).
The scores differ, but they usually agree on which functions are the worst.
