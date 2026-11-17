// Bundles the extension and the CLI into single files (no node_modules shipped).
import { build } from "esbuild";
import { readFileSync } from "fs";

// Build id baked into the bundles: the on-disk analysis cache is dropped whenever it changes.
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const buildId = `${version}+${Date.now().toString(36)}`;

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false,
  minify: true,
  legalComments: "external",
  logLevel: "info",
  define: { "process.env.CL_BUILD": JSON.stringify(buildId) },
};

await build({ ...common, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js", external: ["vscode"] });
await build({ ...common, entryPoints: ["src/cli/bin.ts"], outfile: "dist/cli.js", banner: { js: "#!/usr/bin/env node\n// complexity-lens-cli" } });
await build({ ...common, platform: "browser", format: "iife", target: "es2022", entryPoints: ["src/webview/main.ts"], outfile: "media/dist/webview.js" });
