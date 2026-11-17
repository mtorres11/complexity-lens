// Repository access: import resolution, file listing, path safety, config loading, git changes.
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import * as git from "../src/core/git";
import { CONFIG_FILE, loadConfig, Project } from "../src/core/project";
import { commit, folder, git as run, gitRepo, SIMPLE, tempDir } from "./helpers";

test("resolveImport: extensions, index files, .js written for .ts, and nothing outside the repo", () => {
  const root = folder({ "src/a.ts": "", "src/lib/index.tsx": "", "src/b.mts": "", "node_modules/x/index.ts": "", "src/node_modules/y.ts": "" });
  const p = new Project(root, { useGit: false });
  assert.equal(p.resolveImport("src/main.ts", "./a"), "src/a.ts");
  assert.equal(p.resolveImport("src/main.ts", "./a.js"), "src/a.ts");
  assert.equal(p.resolveImport("src/main.ts", "./b.mjs"), "src/b.mts");
  assert.equal(p.resolveImport("src/main.ts", "./lib"), "src/lib/index.tsx");
  assert.equal(p.resolveImport("src/main.ts", "./missing"), undefined);
  assert.equal(p.resolveImport("src/main.ts", "./node_modules/y"), undefined);
  assert.equal(p.resolveImport("src/main.ts", "../../outside"), undefined);
  assert.equal(p.resolveImport("src/main.ts", "./lib/"), "src/lib/index.tsx");
});

test("relative / absolute refuse paths that escape the repo", () => {
  const root = folder({ "a.ts": "" });
  const p = new Project(root, { useGit: false });
  assert.equal(p.relative(path.join(root, "src", "x.ts")), "src/x.ts");
  assert.equal(p.relative(root), undefined);
  assert.equal(p.relative(path.dirname(root)), undefined);
  assert.equal(p.absolute("../x.ts"), undefined);
  assert.equal(p.absolute("/etc/passwd"), undefined);
  assert.equal(p.absolute("a.ts"), path.join(root, "a.ts"));
  assert.equal(p.metrics("../x.ts"), undefined);
  assert.equal(p.readWorking("../x.ts"), undefined);
});

test("without git: files are walked (skipping dot folders and node_modules); nothing counts as changed", () => {
  const root = folder({ "a.ts": SIMPLE, "src/b.ts": SIMPLE, ".hidden/c.ts": SIMPLE, "node_modules/d.ts": SIMPLE, "readme.md": "" });
  const p = new Project(root, { useGit: false });
  assert.deepEqual(p.files("all").sort(), ["a.ts", "src/b.ts"]);
  assert.deepEqual(p.files("changed"), []);
  assert.deepEqual(p.files("all", "HEAD", 1).length, 1, "capped at max");
  assert.equal(p.baselineMetrics("a.ts"), undefined);
  assert.deepEqual([...p.churn()], []);
});

test("symlinks and missing files are not read", () => {
  const root = folder({ "a.ts": SIMPLE });
  fs.symlinkSync(path.join(root, "a.ts"), path.join(root, "link.ts"));
  const p = new Project(root, { useGit: false });
  assert.equal(p.readWorking("link.ts"), undefined);
  assert.equal(p.readWorking("nope.ts"), undefined);
  assert.equal(p.metrics("nope.ts"), undefined);
  assert.deepEqual(p.evaluate("nope.ts"), { findings: [] });
});

test("loadConfig: missing, a folder, too large, and invalid JSON fall back to the preset", () => {
  assert.deepEqual(loadConfig(folder({})).errors, []);
  const dir = folder({});
  fs.mkdirSync(path.join(dir, CONFIG_FILE));
  assert.deepEqual(loadConfig(dir).errors, []);
  const big = loadConfig(folder({ [CONFIG_FILE]: `{"x": "${"a".repeat(300 * 1024)}"}` }));
  assert.match(big.errors[0], /larger than 256 KB and was ignored/);
  assert.equal(big.config.preset, "recommended");
  const bad = loadConfig(folder({ [CONFIG_FILE]: "{ not json" }));
  assert.match(bad.errors[0], new RegExp(`^${CONFIG_FILE}: `));
  assert.equal(loadConfig(folder({ [CONFIG_FILE]: '{ "preset": "strict", }' })).config.preset, "strict", "JSONC");
});

test("changed files against a branch: the branch's commits since the fork plus uncommitted and new files", () => {
  const root = gitRepo({ "a.ts": SIMPLE, "b.ts": SIMPLE });
  run(root, "checkout", "-q", "-b", "feature");
  commit(root, { "a.ts": SIMPLE + "// edited\n" });
  fs.writeFileSync(path.join(root, "b.ts"), SIMPLE + "// dirty\n");
  fs.writeFileSync(path.join(root, "new.ts"), SIMPLE);
  assert.deepEqual(git.changedFiles(root, "main").sort(), ["a.ts", "b.ts", "new.ts"]);
  assert.deepEqual(git.changedFiles(root).sort(), ["b.ts", "new.ts"]);
  assert.throws(() => git.changedFiles(root, "--evil"), /Unsafe git ref/);
  assert.throws(() => git.mergeBase(root, "a..b"), /Unsafe git ref/);
  assert.equal(git.mergeBase(root, "main"), run(root, "rev-parse", "main").trim());
  const p = new Project(root);
  assert.deepEqual(p.files("changed", "main").sort(), ["a.ts", "b.ts", "new.ts"]);
  assert.deepEqual(p.files("all").sort(), ["a.ts", "b.ts", "new.ts"]);
});

test("git helpers: branches, commits and blobs; nothing in a repo without commits", () => {
  const root = gitRepo({ "a.ts": SIMPLE });
  run(root, "branch", "feature");
  assert.deepEqual(git.listBranches(root).sort(), ["feature", "main"]);
  assert.equal(git.resolveCommit(root, "nope"), undefined);
  assert.equal(git.resolveCommit(root, "-x"), undefined);
  assert.equal(git.hasCommit(root, "-x"), false);
  assert.equal(git.blobText(root, "not-a-blob"), undefined);
  assert.equal(git.blobText(root, "0".repeat(40)), undefined);
  assert.equal(git.treeBlobs(root, "HEAD").size, 0, "only full commit ids");
  const empty = tempDir();
  run(empty, "init", "-q");
  assert.deepEqual(git.listBranches(empty), []);
  assert.equal(git.logNumstat(empty, 30), "");
  assert.equal(git.repoRoot(path.dirname(empty)), undefined);
  assert.deepEqual(new Project(empty).files("changed"), []);
});

test("churn comes from git history", () => {
  const root = gitRepo({ "a.ts": SIMPLE });
  commit(root, { "a.ts": SIMPLE + "// 2\n" });
  const churn = new Project(root).churn();
  assert.equal(churn.get("a.ts")?.commits, 2);
});
