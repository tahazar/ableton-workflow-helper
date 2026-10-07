import { describe, expect, it, onTestFinished } from "vitest";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasFields } from "../src/state-file.js";
import { makeTestLibrary, runCli, startFakeGateway } from "./helpers.js";

/**
 * Two commands keep JSON state between runs: `lib audition` (the pending
 * audition, `AWH_AUDITION_STATE`) and `lib export-alc` (the pack identity
 * and revision, `<library>/mirror.json`). A missing file is a first run and
 * stays silent. A file that is there but is not valid state (bad JSON or the
 * wrong shape) is ignored with a warning naming the file, since the next
 * save replaces it. A file that cannot be read at all fails the command.
 */

const TEMPLATE_FIXTURE = fileURLToPath(
  new URL("../../core/test/fixtures/alc-template.xml", import.meta.url),
);

/** What to put at the state file's path: its text, nothing, or a directory
 *  (a path that exists but cannot be read as a file). */
const MISSING = Symbol("missing");
const DIRECTORY = Symbol("directory");
type Fixture = string | typeof MISSING | typeof DIRECTORY;

async function placeFixture(file: string, fixture: Fixture): Promise<void> {
  if (fixture === DIRECTORY) await mkdir(file);
  else if (fixture !== MISSING) await writeFile(file, fixture);
}

async function tempDir(name: string): Promise<string> {
  const { dir } = await makeTestLibrary(name);
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe("lib audition state file", () => {
  async function auditionEnd(state: Fixture) {
    const dir = await tempDir("audition-state");
    const file = join(dir, "audition-state.json");
    await placeFixture(file, state);
    // No gateway: with nothing pending, --end makes no gateway calls.
    const result = await runCli(["-p", "1", "lib", "audition", "--end"], {
      AWH_AUDITION_STATE: file,
    });
    return { file, result };
  }

  it("a missing file means nothing is pending, without a warning", async () => {
    const { result } = await auditionEnd(MISSING);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("nothing to end");
    expect(result.stderr).toBe("");
  });

  it("a file with invalid JSON warns, names the file, and is treated as nothing pending", async () => {
    const { file, result } = await auditionEnd('{"trackPath": "track:0", ');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("nothing to end");
    expect(result.stderr).toMatch(/^warning: /);
    expect(result.stderr).toContain(`audition state at ${file} is not valid`);
    expect(result.stderr).toContain("JSON");
    // --end clears the state, so the bad file does not warn again.
    expect(existsSync(file)).toBe(false);
  });

  it("valid JSON of the wrong shape warns instead of sweeping with it", async () => {
    const { file, result } = await auditionEnd('{"trackPath": 3}');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("nothing to end");
    expect(result.stderr).toContain(`audition state at ${file} is not valid`);
  });

  it("a file that cannot be read fails the command, naming the action", async () => {
    const { file, result } = await auditionEnd(DIRECTORY);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`reading the audition state at ${file} failed`);
    expect(result.stderr).toContain("EISDIR");
  });

  it("a valid file is used: --end sweeps the pending clip and clears the state", async () => {
    const gateway = await startFakeGateway();
    await gateway.caller("clip.create-midi", {
      target: { type: "session", slotPath: "track:0/slot:0" },
      lengthBeats: 4,
      notes: [{ pitch: 60, start: 0, duration: 1 }],
      name: "audition: kick",
    });
    const dir = await tempDir("audition-state");
    const file = join(dir, "audition-state.json");
    await writeFile(
      file,
      JSON.stringify({ trackPath: "track:0", name: "audition: kick", slug: "kick" }),
    );

    const result = await runCli(["-p", String(gateway.port), "lib", "audition", "--end"], {
      AWH_AUDITION_STATE: file,
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("swept 1 clip(s): track:0/slot:0");
    expect(existsSync(file)).toBe(false);
  });
});

describe("lib export-alc mirror config", () => {
  async function exportAlc(mirror: Fixture) {
    const dir = await tempDir("mirror-config");
    const libraryRoot = join(dir, "library");
    await mkdir(join(libraryRoot, "templates"), { recursive: true });
    await copyFile(TEMPLATE_FIXTURE, join(libraryRoot, "templates", "midi-clip.xml"));
    const file = join(libraryRoot, "mirror.json");
    await placeFixture(file, mirror);
    const dest = join(dir, "pack");
    const result = await runCli([
      "--json",
      "lib",
      "export-alc",
      "--library",
      libraryRoot,
      "--dest",
      dest,
    ]);
    return { file, dest, result };
  }

  async function savedConfig(file: string): Promise<Record<string, unknown>> {
    return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  }

  it("a missing file starts from the default pack at revision 1, without a warning", async () => {
    const { file, result } = await exportAlc(MISSING);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ revision: 1, clips: [] });
    expect(await savedConfig(file)).toEqual({
      uniqueId: "org.awh.user-library",
      name: "AWH Library",
      vendor: "awh",
      revision: 1,
    });
  });

  it("a valid file keeps its pack identity and bumps the revision", async () => {
    const config = { uniqueId: "com.me.pack", name: "My Pack", vendor: "me", revision: 7 };
    const { file, dest, result } = await exportAlc(JSON.stringify(config));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ dest, revision: 8 });
    expect(await savedConfig(file)).toEqual({ ...config, revision: 8 });
  });

  it("a file with invalid JSON warns, names the file, and starts from the default pack", async () => {
    const { file, result } = await exportAlc('{"uniqueId": "com.me.pack"');
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/^warning: /);
    expect(result.stderr).toContain(`mirror config at ${file} is not valid`);
    expect(result.stderr).toContain("JSON");
    expect(JSON.parse(result.stdout)).toMatchObject({ revision: 1 });
  });

  it("valid JSON of the wrong shape warns instead of writing a NaN revision", async () => {
    const { file, result } = await exportAlc('{"uniqueId": "com.me.pack", "revision": "7"}');
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(`mirror config at ${file} is not valid`);
    expect(JSON.parse(result.stdout)).toMatchObject({ revision: 1 });
    expect(await savedConfig(file)).toMatchObject({ uniqueId: "org.awh.user-library" });
  });

  it("a file that cannot be read fails before writing the pack", async () => {
    const { file, dest, result } = await exportAlc(DIRECTORY);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`reading the mirror config at ${file} failed`);
    expect(result.stderr).toContain("EISDIR");
    expect(existsSync(dest)).toBe(false);
  });
});

describe("hasFields", () => {
  const fields = { name: "string", revision: "number" } as const;

  it("accepts an object with every field of the right type, extra fields allowed", () => {
    expect(hasFields({ name: "x", revision: 0, extra: true }, fields)).toBe(true);
  });

  it("rejects a missing or mistyped field, null, an array and a primitive", () => {
    expect(hasFields({ name: "x" }, fields)).toBe(false);
    expect(hasFields({ name: "x", revision: "0" }, fields)).toBe(false);
    expect(hasFields(null, fields)).toBe(false);
    expect(hasFields([], fields)).toBe(false);
    expect(hasFields("x", fields)).toBe(false);
  });
});
