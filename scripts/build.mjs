// Bundles the extension and the CLI into single files (no node_modules shipped).
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false,
  minify: true,
  legalComments: "external",
  logLevel: "info",
};

await build({ ...common, entryPoints: ["src/extension.ts"], outfile: "dist/extension.js", external: ["vscode"] });
await build({ ...common, entryPoints: ["src/cli/main.ts"], outfile: "dist/cli.js", banner: { js: "#!/usr/bin/env node\n// complexity-lens-cli" } });
