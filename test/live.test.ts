import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { Project } from "../src/core/project";

const SIMPLE = "export function f(a: number) {\n  return a + 1;\n}\n";
const BRANCHY =
  "export function f(a: number) {\n  if (a > 1) {\n    if (a > 2) return 2;\n  }\n  return a;\n}\n";

function repo(): { root: string; project: Project } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cl-live-"));
  fs.writeFileSync(path.join(root, "a.ts"), BRANCHY);
  return { root, project: new Project(root, { useGit: false }) };
}

const complexityOf = (p: Project): number | undefined =>
  p.metrics("a.ts")?.functions.find((fn) => fn.key === "f")
    ?.cognitiveComplexity;

test("unsaved editor text is measured instead of the file on disk", () => {
  const { project } = repo();
  assert.equal(complexityOf(project), 3);
  project.setOverlay("a.ts", SIMPLE);
  assert.equal(complexityOf(project), 0);
});

test("clearing the unsaved text goes back to the file on disk", () => {
  const { project } = repo();
  project.setOverlay("a.ts", SIMPLE);
  project.setOverlay("a.ts", undefined);
  assert.equal(complexityOf(project), 3);
});

test("findings follow the unsaved text too", () => {
  const { project } = repo();
  const before = project.evaluate("a.ts").findings.length;
  project.setOverlay("a.ts", SIMPLE);
  const after = project.evaluate("a.ts").findings.length;
  assert.ok(after <= before);
});
