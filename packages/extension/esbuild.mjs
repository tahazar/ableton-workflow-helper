import { build } from "esbuild";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

// The real SDK, extracted by `pnpm setup:sdk` (never committed; see ADR-001/002).
// package.json only declares "exports" (no "main"), which Node/esbuild only
// resolve for bare-specifier imports of a real package, not for a plain
// directory path substituted via esbuild's `alias`. Point straight at the
// CJS entry file (matches this build's `format: "cjs"`) to sidestep that.
const sdkDir = path.join(repoRoot, "vendor/ableton-sdk/sdk/package");
const sdkEntry = path.join(sdkDir, "dist/index.cjs");

if (!existsSync(sdkDir)) {
  console.error(
    [
      "Ableton Extensions SDK not found.",
      "",
      "The extension can only be built on a machine with the SDK:",
      "  1. Download the SDK zip from Ableton's beta program (Centercode).",
      "  2. Place/extract it under vendor/ableton-sdk/ in this repo.",
      "  3. Run: pnpm setup:sdk",
      "  4. Re-run: pnpm build:extension",
      "",
      "(core and cli build fine without it: pnpm build)",
    ].join("\n"),
  );
  process.exit(1);
}

await build({
  entryPoints: [path.join(here, "src/main.ts")],
  outfile: path.join(here, "dist/main.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: "inline",
  logLevel: "info",
  alias: {
    "@ableton-extensions/sdk": sdkEntry,
  },
});

console.log(
  "\nBundled dist/main.js. Package with the SDK CLI (see docs/dev-loop.md),\n" +
    "or run in dev mode: extensions-cli run",
);
