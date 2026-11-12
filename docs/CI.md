# Using Complexity Lens in CI

The checker is a single file, `complexity-lens-cli.js`, attached to every
[release](https://github.com/mtorres11/complexity-lens/releases) with a signed build-provenance attestation.
It needs Node.js 20+ and git, and has no other dependencies.

## GitHub Actions

Copy this into `.github/workflows/complexity.yml`. Pin `CL_VERSION` to a release you have reviewed.

```yaml
name: complexity
on: pull_request
permissions:
  contents: read
jobs:
  complexity:
    runs-on: ubuntu-latest
    env:
      CL_VERSION: v0.1.0
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # full history, so the merge base is available
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

- `--format github` turns problems into annotations on the changed lines.
- The pass/fail behaviour comes from `ci.mode` in `complexity-lens.json` (`warn` by default). Override it for one run with `--mode failOnRegression`.
- With `--base`, only files changed on the branch since it forked from the base are checked, and "existing" code is judged against the merge base.

## Other CI systems

```
node complexity-lens-cli.js check --base origin/main --format text   # human-readable
node complexity-lens-cli.js check --base origin/main --format json   # machine-readable
```

Exit codes: `0` pass, `1` failed (per `ci.mode`), `2` usage or configuration error.

## One-off audit of the whole repo

```
node complexity-lens-cli.js check --all --policy absolute --mode warn
```

This lists everything over the limits, including code that hasn't changed.
