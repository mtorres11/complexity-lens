import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultConfig, PRESETS } from "../src/core/config";
import { resolveConfig } from "../src/core/configParse";
import { parseJsonc } from "../src/core/jsonc";
import { configTemplate } from "../src/core/template";
import type { PresetName } from "../src/core/config";

for (const preset of Object.keys(PRESETS) as PresetName[]) {
  test(`template for "${preset}" parses with no errors and equals the preset`, () => {
    const r = resolveConfig(parseJsonc(configTemplate(preset)));
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.config, defaultConfig(preset));
  });
}

test("template defaults to the recommended preset", () => {
  assert.equal(configTemplate(), configTemplate("recommended"));
});

test("config validation: wrong types and values are reported and fall back to the preset", () => {
  const r = resolveConfig({
    include: "src/**",
    exclude: 5,
    limits: { functionLines: null, parameters: 0, bogus: 1 },
    hook: "loud",
    allowComment: { marker: "No Spaces Allowed", requireReason: "yes" },
    ci: [],
    tokens: { includeImports: 9 },
    overrides: [{ files: [] }, 3, { files: ["a/**"], allowComment: 1 }],
  });
  assert.deepEqual(r.config.include, ["src/**"], "a single pattern becomes a list");
  assert.equal(r.config.limits.functionLines, null);
  assert.equal(r.config.limits.parameters, 5);
  assert.equal(r.config.overrides.length, 1);
  for (const e of [
    "exclude: must be a list of up to 200 file patterns",
    "limits.parameters: must be a whole number from 1 to 1000000",
    "hook: must be an object",
    "allowComment.marker: 3-40 lowercase letters, digits or hyphens",
    "allowComment.requireReason: must be true or false",
    "ci: must be an object",
    "tokens.includeImports: must be a whole number from 0 to 3",
    "overrides[0].files: at least one pattern is required",
    "overrides[1]: must be an object",
    "overrides[2].allowComment: must be an object",
  ])
    assert.ok(r.errors.includes(e), `missing "${e}" in ${JSON.stringify(r.errors)}`);
  assert.deepEqual(r.warnings, ["limits.bogus: unknown option, ignored"]);
  assert.deepEqual(resolveConfig({ overrides: {} }).errors, ["overrides: must be a list of up to 100 entries"]);
  assert.deepEqual(resolveConfig({ limits: 1 }).errors, ["limits: must be an object"]);
  assert.deepEqual(resolveConfig([]).errors, ["complexity-lens.json must contain a JSON object"]);
});
