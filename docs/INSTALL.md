# Installing Complexity Lens

About 2 minutes. Works on macOS, Linux and Windows. The agent hook needs a POSIX shell: macOS, Linux, or Git Bash/WSL on Windows.

## Requirements

- **VS Code 1.95 or newer**
- **Node.js 20+** on your `PATH`, only for the agent hook and CI (`node --version`)
- **git**, for "changed files", comparisons and hotspots
- Optional: the [GitHub CLI](https://cli.github.com/), for the one-command install and to verify downloads

## 1. Install the extension

**One command** (macOS/Linux):

```
gh release download --repo mtorres11/complexity-lens --pattern '*.vsix' --dir /tmp --clobber
code --install-extension /tmp/complexity-lens.vsix --force
```

**By hand:** download `complexity-lens.vsix` from the [latest release](https://github.com/mtorres11/complexity-lens/releases/latest),
then in VS Code go to Extensions (**Cmd/Ctrl+Shift+X**) → `…` → **Install from VSIX…**.

**Verify the download (optional):**

```
gh attestation verify /tmp/complexity-lens.vsix --repo mtorres11/complexity-lens
```

## 2. Open it

1. **Cmd/Ctrl+Shift+P → Developer: Reload Window**.
2. Click the **magnifier** icon in the Activity Bar, or run **View: Show Complexity Lens**.
3. Optional: right-click the icon → **Move To → Secondary Side Bar** to keep it on the right.

The sidebar starts with **Changed files**. Switch **Scope** to **Whole repo** for a full picture.

## 3. Add rules for your repo (optional)

**Cmd/Ctrl+Shift+P → Complexity Lens: Open or Create Repo Config**, then pick a preset.
This creates `complexity-lens.json` with every option commented. Hover any option for its explanation.
Commit the file so your team and CI use the same rules. All options: [CONFIGURATION.md](CONFIGURATION.md).

Without a config file, the `recommended` preset applies.

## 4. Install the agent hook (optional, for AI coding agents)

**Cmd/Ctrl+Shift+P → Complexity Lens: Install Agent Hook** (or the **Agent hook…** button in the sidebar).
It works with agents that run command hooks (JSON on stdin) with `PostToolUse` and `Stop` events.

1. Enter your agent's hook settings file, relative to the repo root (a file that isn't committed applies to just you; a committed one applies to the whole team). You can remember it in the `complexityLens.hookSettingsFile` user setting.
2. Review exactly what will be added, then click **Install**.
3. Start a **new** agent session in that repo.

What it changes:
- **`~/.complexity-lens/cli.js`:** a copy of the checker, updated automatically when the extension updates.
- **Two hook entries** in the chosen settings file. They're guarded: a teammate without the extension gets a silent no-op, not an error.

To remove it, delete the two `complexity-lens` entries from that settings file, and optionally `~/.complexity-lens/`.

## Company or project-specific settings

The extension ships with no company-specific defaults. Put your organisation's rules in that repo's `complexity-lens.json`.
Personal preferences go in your VS Code **user** settings (`complexityLens.*`).

## Updating

Install the newer `.vsix` the same way. Your settings and the hook are kept; the hook's checker copy updates itself.

## Uninstalling

Extensions view → **Complexity Lens** → **Uninstall**, or `code --uninstall-extension mtorres11.complexity-lens`.
Then remove the hook entries (see step 4) and `~/.complexity-lens/` if you installed the hook.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Sidebar is empty on **Changed files** | Nothing changed since the last commit. Edit a file, or switch Scope to **Whole repo**. |
| "Restricted Mode" notice | Trust the folder (**Manage Workspace Trust**) to enable git features and the hook installer. |
| A file isn't listed | Check `include`/`exclude` in `complexity-lens.json` (tests, build output and `node_modules` are skipped by default). |
| The hook does nothing | Start a **new** agent session; check `node --version` works in a terminal; check `~/.complexity-lens/cli.js` exists. |
| The agent keeps being sent back | Lower `hook.maxRetries`, switch `onFinish` to `inform`, or accept the function with `// complexity-ok: <reason>`. |
| Config problems | They're shown at the top of the sidebar, and `complexity-lens check` exits with code 2 and lists them. |
