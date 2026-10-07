import { onTestFinished } from "vitest";
import { mkdtemp, mkdir, symlink } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createGatewayServer, FakeLiveBridge } from "@awh/core";
import type { OpCaller } from "../src/op.js";
import { run } from "../src/index.js";

/**
 * Helpers shared by the CLI test files: running the CLI in-process or as
 * the built binary, an in-process fake gateway, an isolated test library,
 * and a WAV writer for synthetic audio fixtures.
 */

export const CLI_BIN = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
export const hasBuiltCli = existsSync(CLI_BIN);

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs `awh <args>` in this process through `run()`, so the command code
 * counts toward coverage, with `env` set on `process.env` for the run and
 * restored afterwards. Tests in a file run one at a time, so no other
 * test sees the change. `status` is the exit code the binary would exit
 * with.
 */
export async function runCli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  const saved = Object.entries(env).map(([key]) => [key, process.env[key]] as const);
  Object.assign(process.env, env);
  let stdout = "";
  let stderr = "";
  try {
    const status = await run(args, {
      stdout: { write: (chunk: string) => (stdout += chunk) },
      stderr: { write: (chunk: string) => (stderr += chunk) },
    });
    return { status, stdout, stderr };
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/**
 * Spawns the built binary (`dist/bin.js`) with `env` layered over this
 * process's environment. Only the smoke test needs this; everything else
 * uses `runCli`.
 *
 * Async on purpose (not spawnSync): a caller running an in-process fake
 * gateway (`startFakeGateway`) needs this event loop free to answer the
 * child's requests, and `spawnSync` would block it until undici's
 * ~5-minute fetch timeout.
 */
export function runBuiltCli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
  });
}

export interface FakeGateway {
  /** For `awh -p <port>` when the test spawns the CLI against it. */
  port: number;
  /** Calls a gateway op over HTTP, as the CLI does. */
  caller: OpCaller;
}

interface GatewayBody {
  result?: unknown;
  error?: string;
  message?: string;
}

/**
 * Starts a real gateway server backed by FakeLiveBridge on a free port,
 * stopped when the current test finishes (after its `afterEach` hooks).
 * Call it inside a test. Pass a `bridge` (a FakeLiveBridge subclass that
 * fails one op) to drive the CLI's error paths.
 */
export async function startFakeGateway(
  bridge: FakeLiveBridge = new FakeLiveBridge(),
): Promise<FakeGateway> {
  const server = createGatewayServer(bridge, { port: 0 });
  const port = await server.start();
  onTestFinished(() => server.stop());
  const base = `http://127.0.0.1:${port}`;
  const caller: OpCaller = async (name, args) => {
    const res = await fetch(`${base}/api/ops/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: args === undefined ? undefined : JSON.stringify(args),
    });
    const body = (await res.json()) as GatewayBody;
    if (!res.ok) {
      throw new Error(`${body.error ?? "gateway error"}${body.message ? `: ${body.message}` : ""}`);
    }
    return body.result;
  };
  return { port, caller };
}

// `analysisPython()` (src/analysis-python.ts) derives its python `cwd` as
// `dirname(AWH_LIBRARY)/analysis`, so a test library whose commands run the
// analysis engine needs an `analysis` sibling too, or `python -m
// awh_analysis` can't find the package. Symlinking the real analysis/ dir
// alongside a scratch `library/` keeps each test's fixtures isolated
// without touching the repo's actual library/ directory.
const REPO_ANALYSIS_DIR = fileURLToPath(new URL("../../../analysis", import.meta.url));

/**
 * Creates `<tmp>/awh-<name>-cli-XXXX/library` for use as `AWH_LIBRARY`.
 * The caller removes `dir` when done.
 */
export async function makeTestLibrary(
  name: string,
  options: { linkAnalysis?: boolean } = {},
): Promise<{ dir: string; libraryRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), `awh-${name}-cli-`));
  if (options.linkAnalysis) await symlink(REPO_ANALYSIS_DIR, join(dir, "analysis"), "dir");
  const libraryRoot = join(dir, "library");
  await mkdir(libraryRoot, { recursive: true });
  return { dir, libraryRoot };
}

/** Writes `samples` (clamped to [-1, 1]) as a 16-bit PCM mono WAV. */
export function writeWavMono16(path: string, samples: number[], sr: number): void {
  const n = samples.length;
  const buffer = Buffer.alloc(44 + n * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + n * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sr, 24);
  buffer.writeUInt32LE(sr * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  writeFileSync(path, buffer);
}
