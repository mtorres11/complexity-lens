# Complexity Lens

See how complex your code is, and how much it costs an AI agent to read, for every file and function.
Then keep AI-generated code simple: an **agent hook** gives the agent feedback right after it edits code,
and a **CI check** catches anything that slipped through.

Created by **Marco Torres C** · <https://github.com/mtorres11/complexity-lens>

📖 **[Full user manual and tutorials](docs/MANUAL.md)**: every metric and control, the agent hook, CI, team rollout, troubleshooting and FAQ.

- **Local only.** No telemetry, no network calls. Your code never leaves your machine.
- **TypeScript and JavaScript** (`.ts .tsx .js .jsx .mts .cts .mjs .cjs`).

## What you get

| Piece | What it does |
|---|---|
| **Report** | Every changed file (or the whole repo) with a **FIX / PLAN / LEAVE / OK** verdict and seven bars (cognitive, cyclomatic, nesting, churn, coupling, cohesion, context load), coloured green → mustard → red. Click a file to open it, or 🔍 for its deep analysis. |
| **Deep analysis** | Per file: why it matters, every metric against its limit, churn trend, who depends on it, functions, a suggested split. Per function: where the complexity is (line by line) and how to fix it. |
| **Your change** | Did my change make anything more complex? With *Fix all with AI* and *Copy PR summary*. |
| **What to fix** | The whole repo ranked by payoff: complex × changed often × depended on. FIX / PLAN / LEAVE. |
| **Actions** | ✨ Fix with AI (a ready prompt), 🎫 Ticket draft (copy or save as Markdown), 🧹 Chore, Accept (adds a `complexity-ok` comment), Ignore. |
| **Inline scores** | A small line above each function: `complexity 18 ⚠ · 62 lines · nesting 3`. |
| **Status bar** | The current file at a glance: highest complexity and estimated tokens. |
| **Agent hook** | For AI coding agents with command hooks. After each edit, the agent is told about new problems and fixes them in the same turn. Before it finishes, it can be asked to clean up what's left. |
| **CI check** | `complexity-lens check --base main` annotates pull requests, and can fail them. |

### What is measured

| Metric | Meaning |
|---|---|
| Cognitive complexity | How hard a function is to follow: branches, loops, `catch`, ternaries, mixed `&&`/`||`, plus extra for nesting ([SonarSource method](https://www.sonarsource.com/docs/CognitiveComplexity.pdf)). |
| Cyclomatic complexity | Independent paths through a function (McCabe): about the number of tests to cover it. |
| Lines, nesting depth, parameters | Size and shape of each function. |
| Churn | Commits, lines changed and authors per file from recent git history, with a weekly trend. |
| Coupling | Afferent (Ca: files that import it), efferent (Ce: what it imports) and instability. |
| Cohesion (LCOM4) | Unrelated groups of code in a class or file; also drives the suggested split. |
| Context load | Estimated tokens an AI agent reads to work on a file: the file plus its imports (≈3.5 characters per token, an estimate). |
| File lines | Size of each file. |

## Install

Full guide: **[docs/INSTALL.md](docs/INSTALL.md)**.

```
gh release download --repo mtorres11/complexity-lens --pattern '*.vsix' --dir /tmp --clobber
code --install-extension /tmp/complexity-lens.vsix --force
```

Then click the magnifier icon in the Activity Bar.

## Configure

Run **Complexity Lens: Open or Create Repo Config** and pick a preset. This creates `complexity-lens.json`
in the repo root, with every option commented. In VS Code, hovering an option explains it.

| Preset | For |
|---|---|
| `relaxed` | Trying it on a big existing codebase: higher limits, the hook only informs, CI off. |
| `recommended` | Day-to-day: nudge after each edit, block on finish ("don't make it worse"), CI warns. |
| `strict` | New projects: lower limits, everything must be under the limits, CI fails. |

The key idea is the **ratchet** policy: new code must be under the limits, and existing code may stay over
them but can't get worse. You can adopt it in any codebase on day one without noise about old code.

Every option is explained in **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)**.

## Agent hook

Run **Complexity Lens: Install Agent Hook**. It asks for your agent's hook settings file (once, if you choose to remember it), shows exactly what it will add, then:

1. copies the checker to `~/.complexity-lens/cli.js` (kept up to date by the extension), and
2. adds two hooks (`PostToolUse` after edits, `Stop` before finishing) to that file.

Works with agents that run command hooks with JSON on stdin and the `PostToolUse` / `Stop` events.
Set the file once in the `complexityLens.hookSettingsFile` user setting.

What the agent sees after an edit that made things worse:

```
Complexity Lens: src/finder/query.ts
  src/finder/query.ts
    ✖ line 42  buildQuery: cognitive complexity 14 → 28 (limit 15, got worse)
  How to fix:
    - extract branches into well-named helpers, return early, or replace nested conditions with a lookup
Simplify before continuing, or add "// complexity-ok: <reason>" above a function if this complexity is necessary.
```

Need to keep a complex function as is? Put `// complexity-ok: <reason>` above it.

## CI

See **[docs/CI.md](docs/CI.md)** for a ready-to-copy GitHub Actions workflow.

```
node complexity-lens-cli.js check --base origin/main --format github
```

## Personal settings (VS Code)

| Setting | Default | What it does |
|---|---|---|
| `complexityLens.scope` | `changed` | What the sidebar lists: changed files, whole repo, or current file. |
| `complexityLens.sort` | `payoff` | Sort by payoff, context load, complexity, churn or name. |
| `complexityLens.inlineScores` | `true` | Scores above each function. |
| `complexityLens.statusBar` | `true` | Current-file summary in the status bar. |
| `complexityLens.maxFiles` | `3000` | Cap for the whole-repo view. |
| `complexityLens.hookSettingsFile` | *(empty)* | Your agent's hook settings file, relative to the repo root, used by **Install Agent Hook**. Empty = ask. |

## Security and privacy

No telemetry and no network access. Git is run read-only, with repository-configurable command hooks
switched off. In VS Code Restricted Mode, git features and hook installation are disabled.
Details: [SECURITY.md](SECURITY.md) and [docs/SECURITY_ASSESSMENT.md](docs/SECURITY_ASSESSMENT.md).

## Develop

```
npm install
npm test            # unit + end-to-end hook tests
npm run build       # dist/extension.js and dist/cli.js
npm run selfcheck   # Complexity Lens checking itself
npm run package     # complexity-lens.vsix
```

Contributions are welcome through pull requests; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Marco Torres C
