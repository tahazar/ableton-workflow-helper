import { describe, expect, it, onTestFinished } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { analysisPythonPath, hasAnalysisPython } from "./analysis-venv.js";
import {
  hasBuiltCli,
  makeTestLibrary,
  runBuiltCli,
  runCli,
  startFakeGateway,
  writeWavMono16,
} from "./helpers.js";

/**
 * `run()` (src/index.ts) is the whole CLI as a function: it writes to the
 * io it is given and resolves to the exit code the binary exits with.
 * These tests pin that contract; the command tests elsewhere go through
 * it via `runCli`. One smoke test spawns the built binary so the bin
 * entry itself stays covered.
 */

describe("run", () => {
  it("--help writes usage to stdout and returns 0", async () => {
    const result = await runCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^Usage: awh /);
    expect(result.stderr).toBe("");
  });

  it("a usage error writes commander's message to stderr and returns 1", async () => {
    const result = await runCli(["transforms", "--no-such-option"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/unknown option '--no-such-option'/);
    expect(result.stdout).toBe("");
  });

  it("an error thrown by a command writes its message to stderr and returns 1", async () => {
    // Port 1 is privileged and unused, so the connection is refused at once.
    const result = await runCli(["-p", "1", "ping"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^Could not reach the gateway at http:\/\/127\.0\.0\.1:1\/ping/);
    expect(result.stdout).toBe("");
  });

  it("options parsed in one run do not carry over into the next", async () => {
    const json = await runCli(["--json", "transforms"]);
    expect(json.status).toBe(0);
    const transforms = JSON.parse(json.stdout) as { name: string }[];
    expect(transforms.length).toBeGreaterThan(0);

    // Without --json the same list prints as "<name> <description>" lines.
    const pretty = await runCli(["transforms"]);
    expect(pretty.status).toBe(0);
    expect(pretty.stdout.split("\n")[0]).toMatch(new RegExp(`^${transforms[0]!.name} +\\S`));
  });

  it("returns 0 and writes the command's output to stdout on success", async () => {
    const { port } = await startFakeGateway();
    const result = await runCli(["-p", String(port), "ping"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^gateway OK — bridge: /);
  });
});

describe.skipIf(!hasAnalysisPython)("integ: run with the analysis engine", () => {
  it("the engine's exit code and stderr come back through run", async () => {
    const missing = join("no-such-dir", "missing.wav");
    const result = await runCli(["mix", "ab", missing, missing], {
      AWH_PYTHON: analysisPythonPath(),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^error: .*missing\.wav/m);
  }, 20_000);

  it("the engine's stdout comes back through run", async () => {
    const { dir } = await makeTestLibrary("run");
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    const wav = join(dir, "sine.wav");
    writeWavMono16(
      wav,
      Array.from({ length: 44100 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 300 * i) / 44100)),
      44100,
    );
    const result = await runCli(["mix", "ab", wav, wav], { AWH_PYTHON: analysisPythonPath() });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^A: sine\.wav {2}B: sine\.wav$/m);
  }, 20_000);
});

describe.skipIf(!hasBuiltCli)("built awh binary (smoke)", () => {
  it("exits 0 with output on success and 1 with a message on failure", async () => {
    const { port } = await startFakeGateway();
    const ok = await runBuiltCli(["-p", String(port), "ping"]);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toMatch(/^gateway OK — bridge: /);

    const failed = await runBuiltCli(["transforms", "--no-such-option"]);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(/unknown option '--no-such-option'/);
  });
});
