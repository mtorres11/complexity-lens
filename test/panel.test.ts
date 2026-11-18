// The host-neutral panel controller, driven through a fake host.
import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import type { HostCommand, HostPort } from "../src/app/host";
import { Current, PanelController } from "../src/app/panel";
import { Project } from "../src/node/project";
import type { ToWebview, UpdateMessage } from "../src/shared/protocol";
import { COMPLEX, gitRepo, SIMPLE } from "./helpers";

class FakeHost implements HostPort {
  posted: ToWebview[] = [];
  state = new Map<string, unknown>();
  settings = new Map<string, unknown>([["fixPromptGuidelines", ["Use the repo logger", 3, " "]]]);
  copied: { text: string; what: string }[] = [];
  saved: { text: string; name: string; what: string }[] = [];
  opened: { abs: string; line: number }[] = [];
  inserted: { abs: string; line: number; text: string }[] = [];
  notes: string[] = [];
  commands: HostCommand[] = [];
  reason: string | undefined = "parser state machine";
  prompts: { prompt: string; problem?: string }[] = [];
  isVisible = true;
  post(m: ToWebview) { this.posted.push(m); }
  visible() { return this.isVisible; }
  getState<T>(key: string, fallback: T): T { return (this.state.has(key) ? this.state.get(key) : fallback) as T; }
  async setState(key: string, value: unknown) { this.state.set(key, value); }
  getSetting<T>(key: string, fallback: T): T { return (this.settings.has(key) ? this.settings.get(key) : fallback) as T; }
  async setSetting(key: string, value: unknown) { this.settings.set(key, value); }
  async openFile(abs: string, line: number) { this.opened.push({ abs, line }); }
  async copy(text: string, what: string) { this.copied.push({ text, what }); }
  async saveText(text: string, name: string, what: string) { this.saved.push({ text, name, what }); }
  async prompt(o: { prompt: string; validate: (v: string) => string | undefined }) {
    this.prompts.push({ prompt: o.prompt, problem: o.validate("x") });
    return this.reason;
  }
  async insertLine(abs: string, line: number, text: string) { this.inserted.push({ abs, line, text }); }
  notify(level: string, text: string) { this.notes.push(`${level}: ${text}`); }
  async withProgress(_title: string, run: () => Promise<void>) { await run(); }
  run(command: HostCommand) { this.commands.push(command); }
  last<T extends ToWebview["type"]>(type: T) { return this.posted.filter((m) => m.type === type).at(-1) as Extract<ToWebview, { type: T }> | undefined; }
}

const WORDING = { untrusted: "untrusted", trustFirst: "trust first", truncated: "truncated" };

function setup(trusted = true) {
  const root = gitRepo({ "a.ts": SIMPLE, "b.ts": COMPLEX, "complexity-lens.json": '{ "allowComment": { "marker": "keep-it" } }' });
  fs.writeFileSync(path.join(root, "a.ts"), COMPLEX);
  const project = new Project(root);
  const host = new FakeHost();
  const current: Current = { project, rel: "a.ts", errors: [], trusted };
  const panel = new PanelController(host, () => current, { about: { author: "A", version: "1", hasRepo: true }, wording: WORDING });
  return { root, project, host, panel, current };
}

const update = (host: FakeHost) => host.last("update") as UpdateMessage;

test("refresh posts loading, then the tab's data with host wording and state", async () => {
  const { host, panel } = setup();
  await panel.onMessage({ type: "ready" });
  const loading = host.posted.find((m) => m.type === "update") as UpdateMessage;
  assert.equal(loading.loading, true);
  const u = update(host);
  assert.equal(u.loading, false);
  assert.deepEqual([u.tab, u.scope, u.sort, u.compare], ["report", "changed", "payoff", "HEAD"]);
  assert.deepEqual(u.wording, WORDING);
  assert.equal(u.fixCommits, 6);
  assert.deepEqual(u.refs, ["main"]);
  assert.deepEqual(u.data.report?.map((r) => r.path), ["a.ts"]);
  host.isVisible = false;
  const count = host.posted.length;
  await panel.refresh();
  assert.equal(host.posted.length, count, "hidden panels are not refreshed");
});

test("tab, scope, sort and compare accept only known values", async () => {
  const { host, panel } = setup();
  await panel.onMessage({ type: "ready" });
  await panel.onMessage({ type: "tab", value: "todo" });
  assert.ok(update(host).data.todo);
  await panel.onMessage({ type: "tab", value: "evil" });
  assert.equal(host.state.get("tab"), "todo");
  await panel.onMessage({ type: "scope", value: "repo" });
  await panel.onMessage({ type: "sort", value: "name" });
  await panel.onMessage({ type: "sort", value: "random" });
  assert.deepEqual([host.settings.get("scope"), host.settings.get("sort")], ["repo", "name"]);
  await panel.onMessage({ type: "compare", value: "main" });
  await panel.onMessage({ type: "compare", value: "unknown-branch" });
  assert.equal(host.state.get("compare"), "main");
  assert.equal(update(host).compare, "main");
  for (const junk of [null, 3, "ready", {}, { type: "constructor" }, { type: "__proto__" }]) await panel.onMessage(junk);
});

test("open and detail only work for repo paths; detail opens up its imports and dependents", async () => {
  const { root, host, panel } = setup();
  await panel.onMessage({ type: "ready" });
  await panel.onMessage({ type: "open", path: "a.ts", line: 3 });
  await panel.onMessage({ type: "open", path: "b.ts", line: -1 });
  await panel.onMessage({ type: "open", path: "../outside.ts" });
  await panel.onMessage({ type: "open", path: 42 });
  assert.deepEqual(host.opened, [{ abs: path.join(root, "a.ts"), line: 3 }, { abs: path.join(root, "b.ts"), line: 1 }]);
  await panel.onMessage({ type: "detail", path: "a.ts" });
  assert.equal(host.last("detail")?.detail.path, "a.ts");
  await panel.onMessage({ type: "detail", path: "gone.ts" });
  assert.equal(host.last("detailError")?.path, "gone.ts");
  await panel.onMessage({ type: "detail", path: "/etc/passwd" });
  assert.equal(host.last("detailError")?.path, "gone.ts", "no answer for a path outside the repo");
});

test("file actions copy or save the right text with the repo's guidelines", async () => {
  const { host, panel } = setup();
  await panel.onMessage({ type: "ready" });
  await panel.onMessage({ type: "action", kind: "fixPrompt", path: "a.ts" });
  await panel.onMessage({ type: "action", kind: "fixPrompt", path: "a.ts", fn: "f" });
  await panel.onMessage({ type: "action", kind: "chore", path: "a.ts" });
  await panel.onMessage({ type: "action", kind: "explainRed", path: "a.ts", fn: "f" });
  await panel.onMessage({ type: "action", kind: "ticket", path: "a.ts" });
  await panel.onMessage({ type: "action", kind: "nuke", path: "a.ts" });
  await panel.onMessage({ type: "action", kind: "chore", path: "../x.ts" });
  assert.deepEqual(host.copied.map((c) => c.what), ["fix prompt", "fix prompt", "chore", "red-metrics prompt"]);
  assert.match(host.copied[3].text, /^Explain and fix only the red metrics of `f` in a\.ts/);
  assert.ok(host.copied[3].text.includes("- Use the repo logger"));
  assert.match(host.copied[0].text, /^Refactor a\.ts/);
  assert.match(host.copied[1].text, /^Refactor `f` in a\.ts/);
  assert.ok(host.copied[0].text.includes("- Use the repo logger"));
  assert.deepEqual(host.saved.map((s) => [s.name, s.what]), [["a-complexity.md", "Ticket draft"]]);
});

test("accept inserts the file's own allow comment, after asking for a reason", async () => {
  const { root, host, panel } = setup();
  await panel.onMessage({ type: "ready" });
  await panel.onMessage({ type: "action", kind: "accept", path: "a.ts", fn: "f" });
  assert.deepEqual(host.inserted, [{ abs: path.join(root, "a.ts"), line: 1, text: "// keep-it: parser state machine" }]);
  assert.match(host.prompts[0].prompt, /"\/\/ keep-it: <reason>"/);
  assert.match(host.prompts[0].problem ?? "", /at least 3 characters/);
  host.reason = undefined;
  await panel.onMessage({ type: "action", kind: "accept", path: "a.ts" });
  assert.equal(host.inserted.length, 1, "cancelled");
});

test("accept needs a trusted workspace and something over the limits", async () => {
  const untrusted = setup(false);
  await untrusted.panel.onMessage({ type: "ready" });
  await untrusted.panel.onMessage({ type: "action", kind: "accept", path: "a.ts" });
  assert.deepEqual(untrusted.host.notes, ["warning: Complexity Lens: trust this workspace to edit files."]);
  assert.equal(untrusted.host.prompts.length, 0);
  const { root, host, panel } = setup();
  fs.writeFileSync(path.join(root, "a.ts"), SIMPLE);
  await panel.onMessage({ type: "ready" });
  await panel.onMessage({ type: "action", kind: "accept", path: "a.ts" });
  assert.deepEqual(host.notes, ["info: Complexity Lens: nothing to accept in this file."]);
});

test("ignore and show again update the per-repo list", async () => {
  const { root, host, panel } = setup();
  await panel.onMessage({ type: "ready" });
  await panel.onMessage({ type: "action", kind: "ignore", path: "b.ts" });
  await panel.onMessage({ type: "action", kind: "ignore", path: "a.ts" });
  assert.deepEqual(host.state.get(`ignored:${root}`), ["a.ts", "b.ts"]);
  await panel.onMessage({ type: "action", kind: "unignore", path: "b.ts" });
  assert.deepEqual(host.state.get(`ignored:${root}`), ["a.ts"]);
});

test("batch actions, failures and host commands", async () => {
  const { host, panel, current } = setup();
  await panel.onMessage({ type: "ready" });
  for (const kind of ["fixAll", "prSummary", "choreList", "tickets", "bogus"]) await panel.onMessage({ type: "batch", kind });
  assert.deepEqual(host.copied.map((c) => c.what), ["fix-all prompt", "PR summary", "chore list"]);
  assert.match(host.copied[0].text, /a\.ts line 1:/);
  assert.equal(host.saved[0]?.name, "complexity-tickets.md");
  await panel.onMessage({ type: "action", kind: "ticket", path: "deleted.ts" });
  assert.match(host.notes.at(-1) ?? "", /^error: Complexity Lens: preparing the ticket draft failed: deleted\.ts could not be analysed/);
  for (const type of ["openConfig", "installHook", "openRepo"]) await panel.onMessage({ type });
  assert.deepEqual(host.commands, ["openConfig", "installHook", "openRepo"]);
  current.project = undefined;
  await panel.onMessage({ type: "refresh" });
  assert.equal(update(host).empty, "Open a folder to see its complexity.");
  await panel.onMessage({ type: "batch", kind: "fixAll" });
  assert.equal(host.copied.length, 3, "no project: nothing runs");
});

test("tickets with nothing to fix say so", async () => {
  const root = gitRepo({ "a.ts": SIMPLE });
  const host = new FakeHost();
  const panel = new PanelController(host, () => ({ project: new Project(root), errors: [], trusted: true }), { about: { author: "", version: "", hasRepo: false }, wording: WORDING });
  await panel.onMessage({ type: "batch", kind: "tickets" });
  assert.deepEqual(host.notes, ["info: Complexity Lens: nothing to fix right now."]);
});
