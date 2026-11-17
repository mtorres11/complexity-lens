// Process entry point of the command line (bundled to dist/cli.js).

import { readStdin } from "./hook";
import { run } from "./main";

// Set exitCode instead of calling process.exit(), so large outputs to a pipe are fully flushed.
void run(process.argv.slice(2), {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  stdin: readStdin,
}).then((code) => {
  process.exitCode = code;
});
