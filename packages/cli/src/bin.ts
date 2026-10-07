#!/usr/bin/env node
/** The `awh` executable: runs the CLI against the process streams. */
import { run } from "./index.js";

process.exitCode = await run(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
});
