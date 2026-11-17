import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { DiskCache } from "../src/core/diskCache";
import { Project } from "../src/core/project";

const SIMPLE = "export function a(x: number) {\n  return x + 1;\n}\n";
const BRANCHY =
  "export function a(x: number) {\n  if (x > 1) {\n    if (x > 2) return 3;\n    return 2;\n  }\n  return x + 1;\n}\n";

function gitRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cl-cache-"));
  const run = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
      { cwd: root, stdio: "ignore" },
    );
  run("init", "-q");
  fs.writeFileSync(path.join(root, "a.ts"), SIMPLE);
  run("add", "a.ts");
  run("commit", "-q", "-m", "init");
  return root;
}

const cacheFile = (root: string) =>
  path.join(root, ".git", "complexity-lens", "metrics-cache.json");

test("disk cache: a new project reads saved metrics instead of starting empty", () => {
  const root = gitRepo();
  const first = new Project(root);
  const m1 = first.metrics("a.ts");
  first.saveCache();
  assert.ok(fs.existsSync(cacheFile(root)));
  const saved = JSON.parse(fs.readFileSync(cacheFile(root), "utf8"));
  assert.ok(saved.files["a.ts"], "the file's metrics are on disk");
  const m2 = new Project(root).metrics("a.ts");
  assert.deepEqual(m2, JSON.parse(JSON.stringify(m1))); // undefined fields are not stored
});

test("disk cache: an edited file is analyzed again, never served stale", () => {
  const root = gitRepo();
  const first = new Project(root);
  const before = first.metrics("a.ts");
  first.saveCache();
  fs.writeFileSync(path.join(root, "a.ts"), BRANCHY);
  const after = new Project(root).metrics("a.ts");
  assert.ok(before && after);
  assert.ok(
    after.functions[0].cyclomaticComplexity >
      before.functions[0].cyclomaticComplexity,
  );
});

test("disk cache: a corrupt or foreign cache file is ignored", () => {
  const root = gitRepo();
  fs.mkdirSync(path.dirname(cacheFile(root)), { recursive: true });
  fs.writeFileSync(
    cacheFile(root),
    '{"format":1,"build":"dev","files":{"a.ts":{"mtimeMs":"x"}},"__proto__":{"polluted":true}}',
  );
  const m = new Project(root).metrics("a.ts");
  assert.equal(m?.functions[0].name, "a");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  fs.writeFileSync(cacheFile(root), "not json");
  assert.ok(new Project(root).metrics("a.ts"));
});

test("baseline: an unchanged file reuses its current metrics; an edited one is read from git", () => {
  const root = gitRepo();
  const project = new Project(root);
  assert.equal(project.baselineMetrics("a.ts"), project.metrics("a.ts"));
  fs.writeFileSync(path.join(root, "a.ts"), BRANCHY);
  const fresh = new Project(root);
  const base = fresh.baselineMetrics("a.ts");
  const now = fresh.metrics("a.ts");
  assert.ok(base && now && base !== now);
  assert.ok(
    now.functions[0].cyclomaticComplexity >
      base.functions[0].cyclomaticComplexity,
  );
  assert.equal(fresh.baselineMetrics("missing.ts"), undefined);
});

test("evaluate returns the baseline it compared against", () => {
  const root = gitRepo();
  fs.writeFileSync(path.join(root, "a.ts"), BRANCHY);
  const r = new Project(root).evaluate("a.ts");
  assert.ok(r.base && r.metrics);
  assert.equal(r.base.functions[0].cyclomaticComplexity, 1);
});

test("churn is cached per HEAD and survives a new project", () => {
  const root = gitRepo();
  const first = new Project(root);
  const c1 = first.churn();
  first.saveCache();
  const saved = JSON.parse(fs.readFileSync(cacheFile(root), "utf8"));
  assert.ok(
    saved.churn?.key.startsWith(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
    ),
  );
  assert.deepEqual([...new Project(root).churn()], [...c1]);
});

test("a cache without a directory stays in memory and never writes", () => {
  const cache = new DiskCache(undefined);
  cache.setChurn("k", new Map());
  cache.save();
  assert.ok(cache.getChurn("k"));
});
