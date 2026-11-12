# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.
Report privately via GitHub: **Security** tab → **Report a vulnerability**
(<https://github.com/mtorres11/complexity-lens/security/advisories/new>).

## How Complexity Lens handles your code

- **Nothing leaves your machine.** No telemetry, no analytics, no network requests of any kind.
- **Source code is parsed, never executed.** It uses the TypeScript parser only: no type checking, no module loading, no evaluation.
- **Git is run read-only and safely**: directly (never through a shell), with arguments as a list, with
  repository-configurable command hooks switched off (`core.fsmonitor`, `core.hooksPath`, external diff, pager), and
  without taking optional locks.
- **The repo config is data, not code.** `complexity-lens.json` can only change thresholds, modes and file patterns. It
  can't name a command, a URL or a path outside the repository.
- **VS Code Restricted Mode**: git features and hook installation are disabled until you trust the folder.
- **The agent hook** is only added after you confirm the exact change, and only to the settings file you choose.

Full details: [docs/SECURITY_ASSESSMENT.md](docs/SECURITY_ASSESSMENT.md).

## Verifying a release

```
gh attestation verify complexity-lens.vsix --repo mtorres11/complexity-lens
gh attestation verify complexity-lens-cli.js --repo mtorres11/complexity-lens
```

`SHA256SUMS.txt` on each release lists the files' checksums.
