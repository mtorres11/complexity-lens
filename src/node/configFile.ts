// Creating the repo config file (complexity-lens.json) from the commented template.

import * as fs from "fs";
import * as path from "path";
import type { PresetName } from "../core/config";
import { configTemplate } from "../core/template";
import { CONFIG_FILE } from "../core/project";

/** Writes the commented config for `preset` and returns its path. Throws (code EEXIST) if it already exists. */
export function createConfigFile(root: string, preset: PresetName): string {
  const file = path.join(root, CONFIG_FILE);
  fs.writeFileSync(file, configTemplate(preset), { flag: "wx" });
  return file;
}
