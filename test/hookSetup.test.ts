import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { HOOKS, mergeHooks, refreshShim, shimPath, validateSettingsPath } from "../src/node/hookSetup";
import { tempDir } from "./helpers";

test("mergeHooks adds both hooks once, keeps everything else, and never mutates its input", () => {
  const settings = { model: "x", hooks: { PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "lint" }] }] } };
  const before = structuredClone(settings);
  const first = mergeHooks(settings);
  assert.deepEqual(first.added, ["PostToolUse", "Stop"]);
  assert.deepEqual(settings, before);
  const hooks = first.merged.hooks as Record<string, unknown[]>;
  assert.equal(hooks.PostToolUse.length, 2);
  assert.deepEqual(hooks.Stop, [HOOKS.Stop]);
  assert.equal(first.merged.model, "x");
  const second = mergeHooks(first.merged);
  assert.deepEqual(second.added, []);
  assert.deepEqual(second.merged, first.merged);
});

test("mergeHooks replaces a malformed hooks value", () => {
  assert.deepEqual(mergeHooks({ hooks: "nope" }).added, ["PostToolUse", "Stop"]);
  assert.deepEqual(mergeHooks({ hooks: { Stop: "nope" } }).added, ["PostToolUse", "Stop"]);
});

test("validateSettingsPath accepts repo-relative .json paths only", () => {
  assert.equal(validateSettingsPath("config/agent.json"), undefined);
  assert.equal(validateSettingsPath("config\\agent.JSON"), undefined);
  assert.match(validateSettingsPath("  ") ?? "", /Enter the path/);
  assert.match(validateSettingsPath("/etc/agent.json") ?? "", /inside the repo/);
  assert.match(validateSettingsPath("../agent.json") ?? "", /inside the repo/);
  assert.match(validateSettingsPath("agent.yaml") ?? "", /must be a \.json file/);
});

test("refreshShim copies the CLI only when asked, updates only its own file, and refuses a foreign one", () => {
  const home = process.env.HOME;
  process.env.HOME = tempDir("cl-home-");
  try {
    const ext = tempDir("cl-ext-");
    fs.mkdirSync(path.join(ext, "dist"));
    fs.writeFileSync(path.join(ext, "dist", "cli.js"), "// complexity-lens-cli v1");
    refreshShim(ext, false);
    assert.equal(fs.existsSync(shimPath()), false, "never created unless asked");
    refreshShim(ext, true);
    assert.equal(fs.readFileSync(shimPath(), "utf8"), "// complexity-lens-cli v1");
    fs.writeFileSync(path.join(ext, "dist", "cli.js"), "// complexity-lens-cli v2");
    refreshShim(ext, false);
    assert.equal(fs.readFileSync(shimPath(), "utf8"), "// complexity-lens-cli v2", "kept current");
    refreshShim(ext, false);
    fs.writeFileSync(shimPath(), "someone else's file");
    assert.throws(() => refreshShim(ext, true), /was not created by Complexity Lens/);
  } finally {
    process.env.HOME = home;
  }
});
