// What each sidebar tab shows: scope, sort, verdict groups, truncation and cancellation.
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { Project } from "../src/core/project";
import { DataBuilder, Progress } from "../src/vscode/data";
import { commit, COMPLEX, git, gitRepo, SIMPLE } from "./helpers";

const progress: Progress = { onProgress: () => undefined, isCancelled: () => false };
const variant = (n: number) => COMPLEX.replace("return 5;", `return ${n};`);

/** fix.ts changed 3×, plan.ts 2×, leave.ts once (all over the limits); ok.ts is simple. */
function repo(): Project {
  const root = gitRepo({
    "complexity-lens.json": JSON.stringify({ verdicts: { fixCommits: 3, planCommits: 2 } }),
    "fix.ts": variant(1),
    "plan.ts": variant(1),
    "leave.ts": variant(1),
    "ok.ts": SIMPLE,
  });
  commit(root, { "fix.ts": variant(2), "plan.ts": variant(2) });
  commit(root, { "fix.ts": variant(3) });
  return new Project(root);
}

test("report: whole repo sorted by the chosen order; changed and current-file scopes", async () => {
  const p = repo();
  const b = new DataBuilder(p, 3000);
  const names = async (...args: Parameters<DataBuilder["report"]>) => (await b.report(...args))!.data.report!.map((r) => r.path);
  assert.deepEqual(await names("repo", "name", undefined, progress), ["fix.ts", "leave.ts", "ok.ts", "plan.ts"]);
  assert.deepEqual((await names("repo", "churn", undefined, progress)).slice(0, 2), ["fix.ts", "plan.ts"]);
  assert.equal((await names("repo", "complexity", undefined, progress)).at(-1), "ok.ts");
  assert.equal((await names("repo", "payoff", undefined, progress))[0], "fix.ts");
  assert.equal((await names("repo", "aiCost", undefined, progress)).length, 4);
  assert.deepEqual(await names("changed", "name", undefined, progress), []);
  fs.writeFileSync(path.join(p.root, "ok.ts"), COMPLEX);
  b.invalidate();
  assert.deepEqual(await names("changed", "name", undefined, progress), ["ok.ts"]);
  assert.deepEqual(await names("current", "name", "leave.ts", progress), ["leave.ts"]);
  assert.deepEqual(await names("current", "name", "complexity-lens.json", progress), [], "not an included file");
  assert.deepEqual(await names("current", "name", undefined, progress), []);
});

test("todo: FIX / PLAN / LEAVE by churn, payoff order, ignored files left out", async () => {
  const b = new DataBuilder(repo(), 3000);
  const t = (await b.todo([], progress))!.data.todo!;
  assert.deepEqual([t.fix.map((r) => r.path), t.plan.map((r) => r.path), t.leave.map((r) => r.path)], [["fix.ts"], ["plan.ts"], ["leave.ts"]]);
  const ignored = (await b.todo(["fix.ts"], progress))!.data.todo!;
  assert.deepEqual(ignored.fix, []);
  assert.deepEqual(ignored.ignored, ["fix.ts"]);
  assert.deepEqual((await b.topFix(progress, [])).map((r) => r.path), ["fix.ts", "plan.ts"]);
  assert.deepEqual((await b.topFix(progress, [], 1)).map((r) => r.path), ["fix.ts"]);
});

test("truncation: only maxFiles files are analysed, and the result says so", async () => {
  const b = new DataBuilder(repo(), 2);
  const r = (await b.report("repo", "name", undefined, progress))!;
  assert.equal(r.data.report!.length, 2);
  assert.equal(r.truncated, true);
  assert.equal((await b.todo([], progress))!.truncated, true);
  assert.equal((await b.report("changed", "name", undefined, progress))!.truncated, false, "only the repo scope is truncated");
});

test("change: compared with the last commit or the merge base of a branch, problems first", async () => {
  const p = repo();
  git(p.root, "checkout", "-q", "-b", "feature");
  commit(p.root, { "ok.ts": COMPLEX });
  fs.writeFileSync(path.join(p.root, "leave.ts"), variant(9));
  const b = new DataBuilder(p, 3000);
  const head = (await b.change("HEAD", progress))!.data.change!;
  assert.equal(head.compare, "HEAD");
  assert.deepEqual(head.items.map((r) => r.path), ["leave.ts"]);
  const branch = await b.changeItems("main", progress);
  assert.deepEqual(branch.map((r) => r.path), ["ok.ts", "leave.ts"]);
  assert.ok(branch[0].problems.length > 0);
});

test("detail and cancellation", async () => {
  const b = new DataBuilder(repo(), 3000);
  assert.equal((await b.detail("fix.ts", progress))?.path, "fix.ts");
  const cancelled: Progress = { onProgress: () => undefined, isCancelled: () => true };
  const fresh = new DataBuilder(repo(), 3000);
  assert.equal(await fresh.report("repo", "name", undefined, cancelled), undefined);
  assert.equal(await fresh.detail("fix.ts", cancelled), undefined);
  assert.deepEqual(await fresh.changeItems("HEAD", cancelled), []);
  assert.deepEqual(await fresh.topFix(cancelled, []), []);
});
