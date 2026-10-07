import { onTestFinished } from "vitest";
import { mkdtemp, mkdir, symlink } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createGatewayServer, FakeLiveBridge } from "@awh/core";
import type { OpCaller } from "../src/op.js";

/**
 * Helpers shared by the CLI test files: spawning the built CLI, an
 * in-process fake gateway, an isolated test library, and a WAV writer for
 * synthetic audio fixtures.
 */

export const CLI_DIST = fileURLToPath(new URL("../dist/index.js", import.meta.url));
export const hasBuiltCli = existsSync(CLI_DIST);

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the built CLI with `env` layered over this process's environment.
 *
 * Async on purpose (not spawnSync): many callers run an in-process fake
 * gateway (`startFakeGateway`) in this same event loop for the child to
 * talk to. `spawnSync` blocks the whole Node event loop while the child
 * runs, so the in-process HTTP server could never answer the child's
 * requests. That deadlock hangs for undici's ~5-minute default fetch
 * timeout and then fails. Spawning async keeps this process's event loop
 * free to service the gateway while the child CLI process runs.
 */
export function runCli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [CLI_DIST, ...args], {
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
 * stopped when the current test finishes. Call it inside a test.
 */
export async function startFakeGateway(): Promise<FakeGateway> {
  const server = createGatewayServer(new FakeLiveBridge(), { port: 0 });
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
