# Configuration

Complexity Lens reads **`complexity-lens.json`** from the repository root. Comments are allowed.
Every option is optional: anything you leave out comes from the **preset**.

Create the file with **Complexity Lens: Open or Create Repo Config** in VS Code, or `complexity-lens init --preset recommended`.
In VS Code, hovering any option in the file shows its explanation, and typing shows the allowed values.

## Full example

```jsonc
{
  "preset": "recommended",
  "include": ["src/**/*.{ts,tsx,js,jsx}"],
  "exclude": ["**/*.test.*", "**/generated/**", "dist/**"],
  "limits": {
    "cognitiveComplexity": 15,
    "functionLines": 60,
    "nestingDepth": 4,
    "parameters": 5,
    "fileLines": 400,
    "fileTokens": 8000,
    "imports": 15
  },
  "policy": "ratchet",
  "allowComment": { "marker": "complexity-ok", "requireReason": true },
  "hook": { "afterEdit": "nudge", "onFinish": "block", "maxRetries": 2 },
  "ci": { "mode": "warn" },
  "tokens": { "includeImports": 1 },
  "hotspots": { "historyDays": 90 },
  "overrides": [
    { "files": ["src/legacy/**"], "hook": { "onFinish": "inform" } }
  ]
}
```

## `preset`: the starting point

| Value | Limits | Policy | Hook after edit / on finish | CI |
|---|---|---|---|---|
| `relaxed` | high | ratchet | inform / off | off |
| `recommended` *(default)* | balanced | ratchet | nudge / block | warn |
| `strict` | low | absolute | nudge / block | failOverLimit |

Anything you set explicitly overrides the preset.

## `include` / `exclude`: which files are measured

Patterns relative to the repo root. `**` matches any number of folders, `*` anything except `/`, `?` one character,
`{a,b}` alternatives. Patterns can't start with `/` or contain `..`.

Default `include`: every TypeScript/JavaScript file in the repo. Default `exclude`: tests, `__tests__`, `generated/`, `.d.ts`, `dist/`, `build/`, `out/`, `coverage/`, `node_modules/`, `vendor/`, `*.min.js`.

## `limits`: when something counts as "too much"

| Limit | Measures | Why it matters for AI | relaxed | recommended | strict |
|---|---|---|---|---|---|
| `cognitiveComplexity` | How hard a function is to follow | High scores are where AI edits introduce bugs | 25 | 15 | 10 |
| `functionLines` | Length of one function | Long functions must be read in full to edit safely | 100 | 60 | 40 |
| `nestingDepth` | `if`/loop/`switch`/`try` inside each other | Deep nesting is a top source of AI logic mistakes | 5 | 4 | 3 |
| `parameters` | Inputs a function takes | Many parameters usually means it does too much | 7 | 5 | 4 |
| `fileLines` | Length of a file | Big files cost tokens every time an AI opens them | 800 | 400 | 300 |
| `fileTokens` | Estimated tokens to read the file | The direct "AI reading cost" | 16000 | 8000 | 6000 |
| `imports` | Modules this file depends on (efferent coupling) | Each import is more code an AI may need to read | 25 | 15 | 12 |
| `cyclomaticComplexity` | Independent paths through a function | More paths, more cases to get right and test | 20 | 10 | 8 |
| `lcom` | Unrelated groups in a class (3+ methods) or in a file at least half the `fileLines` limit | The file does several jobs; an agent loads all of them | 4 | 1 | 1 |
| `contextTokens` | Tokens to read the file plus its imports | What an agent really reads to change it | 40000 | 20000 | 15000 |

Set a limit to `null` to turn that check off.

**How cognitive complexity is counted:** +1 for `if`, `else if`, `else`, ternary, `switch`, each loop, `catch`, labelled
`break`/`continue`, and each run of mixed `&&` / `||` / `??`. Structures nested inside others add +1 per level of nesting.
Named functions (declarations, methods, functions assigned to a name) are measured on their own. Anonymous callbacks
count toward the function that contains them, one nesting level deeper.

## `policy`: what gets judged

| Value | Meaning |
|---|---|
| `ratchet` *(default)* | **Don't make it worse.** New functions and files must be under the limits. Existing ones may stay over them, but a change can't push them higher. Code you don't touch is never flagged. |
| `absolute` | **Everything must be under the limits.** Anything over a limit in the checked files is flagged, even if it wasn't changed. |

"Existing" means "present in the baseline": the last commit for the hook and the editor, and the branch's merge base for CI.
Functions are matched by name (`Class.method`, `functionName`). A renamed function counts as new.

## `allowComment`: the escape hatch

```ts
// complexity-ok: hand-written parser state machine
function parse(input: string) { ... }
```

| Option | Default | Meaning |
|---|---|---|
| `marker` | `complexity-ok` | The word to look for in a comment directly above the function (3–40 lowercase letters, digits or hyphens). |
| `requireReason` | `true` | A reason must follow the marker (`// complexity-ok: <reason>`), so reviewers can see why. |

Accepted functions still show in the sidebar (marked ✓), but never block the hook or CI.

## `hook`: the agent hook

| Option | Values | What happens |
|---|---|---|
| `afterEdit` | `off` | No check after edits. |
| | `inform` | The agent gets a note about new problems and may act on it or not. |
| | `nudge` *(recommended)* | The agent gets the problems as something it must respond to (fix it, or explain) before continuing. The edit is kept. |
| `onFinish` | `off` | No check at the end. |
| | `inform` | You get a summary of anything still over the limits. |
| | `block` *(recommended)* | The agent can't end its turn while a file changed since the last commit has problems (judged by `policy`). |
| `maxRetries` | `0`–`10` (default `2`) | How many times `block` sends the agent back. After that it may finish, and the problems are reported to you instead. This prevents loops when something genuinely can't be simplified. |

Notes:
- The hook checks files changed since the last commit, including your own uncommitted changes in the same repo.
- If the hook itself fails for any reason (broken config, unexpected input), it stays silent and never blocks the agent.

## `ci`: the pull request check

| `mode` | What happens |
|---|---|
| `off` | No check. |
| `warn` *(recommended)* | Annotations appear on changed lines that got worse; the check passes. |
| `failOnRegression` | The check fails if the pull request made something worse beyond a limit. |
| `failOverLimit` | The check fails if any changed file has anything over a limit. |

`complexity-lens check --mode <mode>` overrides it for one run. See [CI.md](CI.md).

## `tokens.includeImports`

How many levels of relative imports to add when estimating **AI cost** (`0` = the file alone, max `3`). Default `1`.
Only relative imports (`./x`, `../y`) inside the repo are followed; packages are not counted.

## `verdicts`: FIX / PLAN / LEAVE

Files over a limit are classified for the badges and *What to fix*:

| Option | Default | Meaning |
|---|---|---|
| `fixCommits` | `6` | Changed at least this many times in `hotspots.historyDays` → **FIX** (hotspot) |
| `planCommits` | `2` | Changed at least this many times → **PLAN**; fewer → **LEAVE** (complex but stable) |

A file the current change made worse is always **FIX**.

## `hotspots.historyDays`

How far back in git to count changes per file for **hotspots**. Default `90`.

## `overrides`: different rules for parts of the repo

A list of `{ "files": [...], ... }` entries applied in order on top of the top-level settings. Each can set `limits`,
`policy`, `hook` and `allowComment`.

```jsonc
"overrides": [
  // Old code: don't hold the agent back at the end, just tell me.
  { "files": ["src/legacy/**"], "hook": { "onFinish": "inform" } },
  // Generated-but-committed code: no function limits.
  { "files": ["src/api/client/**"], "limits": { "cognitiveComplexity": null, "functionLines": null } }
]
```

## Personal VS Code settings

These affect only how the sidebar looks for you. They're user-level only, so a repository can't change them.

| Setting | Values | Default |
|---|---|---|
| `complexityLens.scope` | `changed`, `repo`, `current` | `changed` |
| `complexityLens.sort` | `payoff`, `aiCost`, `complexity`, `churn`, `name` | `payoff` |
| `complexityLens.inlineScores` | `true` / `false` | `true` |
| `complexityLens.statusBar` | `true` / `false` | `true` |
| `complexityLens.maxFiles` | 100–20000 | `3000` |
| `complexityLens.hookSettingsFile` | repo-relative `.json` path | *(empty: ask)* |

## Validation

Unknown options are ignored with a warning. Invalid values fall back to the preset and are reported in the sidebar,
and by `complexity-lens check`, which then exits with code 2.
