// The repo config file (complexity-lens.json): reading it safely, and creating it from the template.

import * as fs from "fs";
import * as path from "path";
import type { LoadResult, PresetName } from "../core/config";
import { resolveConfig } from "../core/configParse";
import { parseJsonc } from "../core/jsonc";
import { configTemplate } from "../core/template";

export const CONFIG_FILE = "complexity-lens.json";
const MAX_CONFIG_BYTES = 256 * 1024;

/** Reads and validates the config; a missing, too large or broken file falls back to the preset (with errors). */
export function loadConfig(root: string): LoadResult {
  const file = path.join(root, CONFIG_FILE);
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile()) return resolveConfig(undefined);
    if (st.size > MAX_CONFIG_BYTES) {
      const r = resolveConfig(undefined);
      r.errors.push(
        `${CONFIG_FILE} is larger than ${MAX_CONFIG_BYTES / 1024} KB and was ignored`,
      );
      return r;
    }
    return resolveConfig(parseJsonc(fs.readFileSync(file, "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return resolveConfig(undefined);
    const r = resolveConfig(undefined);
    r.errors.push(`${CONFIG_FILE}: ${(e as Error).message}`);
    return r;
  }
}

/** Writes the commented config for `preset` and returns its path. Throws (code EEXIST) if it already exists. */
export function createConfigFile(root: string, preset: PresetName): string {
  const file = path.join(root, CONFIG_FILE);
  fs.writeFileSync(file, configTemplate(preset), { flag: "wx" });
  return file;
}
