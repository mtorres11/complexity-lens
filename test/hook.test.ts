// End-to-end hook behaviour in a throwaway git repository.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { onFinish, postEdit } from "../src/cli/hook";

function tempRepo(config?: object): string {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "cl-test-")),
  );
  const g = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "test@example.com");
  g("config", "user.name", "Test");
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(
    path.join(dir, "src/a.ts"),
    "export function simple(x: number) { return x + 1; }\n",
  );
  if (config)
    fs.writeFileSync(
      path.join(dir, "complexity-lens.json"),
      JSON.stringify(config),
    );
  g("add", "-A");
  g("commit", "-q", "-m", "init");
  return dir;
}

const COMPLEX = `export function simple(x: number) {
  if (x > 1) { if (x > 2) { if (x > 3) { if (x > 4) { if (x > 5) { return 5; } } } } }
  return x && x > 0 || x < -1 ? 1 : 0;
}\n`;

test("post-edit: nudge returns a blocking reason for a regression", () => {
  const dir = tempRepo();
  fs.writeFileSync(path.join(dir, "src/a.ts"), COMPLEX);
  const out = postEdit({
    cwd: dir,
    tool_name: "Edit",
    tool_input: { file_path: path.join(dir, "src/a.ts") },
  }) as { decision?: string; reason?: string };
  assert.equal(out?.decision, "block");
  assert.match(
    out.reason ?? "",
    /simple: cognitive complexity 0 → \d+ \(limit 15, got worse\)/,
  );
  assert.match(out.reason ?? "", /nesting depth/);
});

test("post-edit: inform uses additionalContext; off and unrelated tools return nothing", () => {
  const dir = tempRepo({ hook: { afterEdit: "inform" } });
  fs.writeFileSync(path.join(dir, "src/a.ts"), COMPLEX);
  const file = path.join(dir, "src/a.ts");
  const out = postEdit({
    cwd: dir,
    tool_name: "Write",
    tool_input: { file_path: file },
  }) as { hookSpecificOutput?: { additionalContext?: string } };
  assert.match(
    out?.hookSpecificOutput?.additionalContext ?? "",
    /Complexity Lens/,
  );
  assert.equal(
    postEdit({ cwd: dir, tool_name: "Bash", tool_input: { file_path: file } }),
    undefined,
  );
  const off = tempRepo({ hook: { afterEdit: "off" } });
  fs.writeFileSync(path.join(off, "src/a.ts"), COMPLEX);
  assert.equal(
    postEdit({
      cwd: off,
      tool_name: "Edit",
      tool_input: { file_path: path.join(off, "src/a.ts") },
    }),
    undefined,
  );
});

test("post-edit: ignores files outside the repo or not included", () => {
  const dir = tempRepo();
  assert.equal(
    postEdit({
      cwd: dir,
      tool_name: "Edit",
      tool_input: { file_path: "/etc/hosts" },
    }),
    undefined,
  );
  fs.mkdirSync(path.join(dir, "dist"));
  fs.writeFileSync(path.join(dir, "dist/notes.ts"), COMPLEX);
  assert.equal(
    postEdit({
      cwd: dir,
      tool_name: "Edit",
      tool_input: { file_path: path.join(dir, "dist/notes.ts") },
    }),
    undefined,
  );
  assert.equal(
    postEdit({
      cwd: dir,
      tool_name: "Edit",
      tool_input: { file_path: "relative/path.ts" },
    }),
    undefined,
  );
});

test("stop: blocks up to maxRetries, then reports to the user and resets", () => {
  const dir = tempRepo({ hook: { onFinish: "block", maxRetries: 2 } });
  fs.writeFileSync(path.join(dir, "src/a.ts"), COMPLEX);
  const input = { cwd: dir, session_id: "s1" };
  const r1 = onFinish(input) as { decision?: string; reason?: string };
  assert.equal(r1.decision, "block");
  assert.match(r1.reason ?? "", /Retry 1 of 2/);
  const r2 = onFinish(input) as { decision?: string; reason?: string };
  assert.match(r2.reason ?? "", /Retry 2 of 2/);
  const r3 = onFinish(input) as { decision?: string; systemMessage?: string };
  assert.equal(r3.decision, undefined);
  assert.match(r3.systemMessage ?? "", /couldn't; please review/);
  const r4 = onFinish(input) as { decision?: string };
  assert.equal(r4.decision, "block", "counter was reset after reporting");
});

test("stop: clean changes finish normally; allow comment is respected", () => {
  const dir = tempRepo({ hook: { onFinish: "block" } });
  assert.equal(onFinish({ cwd: dir, session_id: "s" }), undefined);
  fs.writeFileSync(
    path.join(dir, "src/a.ts"),
    `// complexity-ok: lookup table generator\n${COMPLEX}`,
  );
  assert.equal(onFinish({ cwd: dir, session_id: "s" }), undefined);
});
