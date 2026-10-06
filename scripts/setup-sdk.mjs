/**
 * Locates the Ableton Extensions SDK tarballs the owner placed under
 * vendor/ableton-sdk/ (in whatever layout the Centercode zip extracted to),
 * and extracts the SDK package to vendor/ableton-sdk/sdk/ where the extension
 * build expects it. Never copies anything outside vendor/ (the SDK is
 * non-redistributable and vendor/ableton-sdk/ is gitignored).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = path.join(repoRoot, "vendor/ableton-sdk");
const sdkOutDir = path.join(vendorDir, "sdk");

if (!existsSync(vendorDir)) {
  fail(
    `vendor/ableton-sdk/ does not exist.\n` +
      `Download the SDK zip from Ableton's beta program (Centercode) and extract it there.`,
  );
}

const tarballs = findFiles(vendorDir, (name) => name.endsWith(".tgz"));
if (tarballs.length === 0) {
  fail(
    `No .tgz tarballs found under vendor/ableton-sdk/.\n` +
      `Expected the SDK zip contents (e.g. ableton-extensions-sdk-<version>.tgz).`,
  );
}

const sdkTarball = pickTarball(tarballs, "sdk");
const cliTarball = pickTarball(tarballs, "cli");

if (!sdkTarball) {
  fail(
    `Could not identify the SDK tarball among:\n  ${tarballs.join("\n  ")}\n` +
      `Expected a filename containing "sdk".`,
  );
}

rmSync(sdkOutDir, { recursive: true, force: true });
mkdirSync(sdkOutDir, { recursive: true });
execFileSync("tar", ["-xzf", sdkTarball, "-C", sdkOutDir]);

const pkgDir = path.join(sdkOutDir, "package");
if (!existsSync(path.join(pkgDir, "package.json"))) {
  fail(
    `Extracted the tarball but vendor/ableton-sdk/sdk/package/package.json is missing —\n` +
      `unexpected tarball layout. Inspect ${sdkOutDir} manually.`,
  );
}

console.log(`SDK extracted to ${rel(pkgDir)}`);
console.log(`  → extension builds will bundle from here (pnpm build:extension)`);

if (cliTarball) {
  console.log(`\nSDK dev CLI found: ${rel(cliTarball)}`);
  console.log(`  Install it globally (needs Node >= 24):`);
  console.log(`    npm install -g "${cliTarball}"`);
  console.log(`  Then run the extension in dev mode with: extensions-cli run`);
} else {
  console.log(`\nNote: no CLI tarball ("...cli...tgz") found — dev-mode hot reload needs it.`);
}

function findFiles(dir, predicate, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (full === sdkOutDir) continue; // don't re-scan our own output
    if (statSync(full).isDirectory()) findFiles(full, predicate, acc);
    else if (predicate(entry)) acc.push(full);
  }
  return acc;
}

function pickTarball(candidates, kind) {
  return (
    candidates.find((f) => path.basename(f).includes(`-${kind}-`)) ??
    candidates.find((f) => path.basename(f).includes(kind)) ??
    null
  );
}

function rel(p) {
  return path.relative(repoRoot, p);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
