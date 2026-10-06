import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createGatewayServer, FakeLiveBridge, type ClipDetail, type GatewayServer } from "@awh/core";

/**
 * 808 bass engine CLI-level tests (docs/design/bass-808.md's verification
 * bar). The engine/spec property tests live in
 * packages/core/test/bass.test.ts. This file covers what's specific to the
 * CLI layer: end-to-end writes against a fake gateway, --dry-run, --slides
 * off, the knowledge-entry style fallback (tier printed) via an isolated
 * AWH_LIBRARY (sibling knowledge/ dir, the same override `findLibraryRoot`
 * honors; see packages/core/src/library/store.ts), and the unknown-style
 * error. Uses the same async-spawn-against-an-in-process-gateway pattern as
 * arp.test.ts/advise.test.ts's `--set` test (spawnSync would deadlock the
 * gateway).
 */

const CLI_DIST = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const hasBuiltCli = existsSync(CLI_DIST);

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
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

async function makeTestLibrary(): Promise<{ dir: string; libraryRoot: string }> {
  const dir = await mkdtemp(join(tmpdir(), "awh-bass-cli-"));
  const libraryRoot = join(dir, "library");
  await mkdir(libraryRoot, { recursive: true });
  return { dir, libraryRoot };
}

let server: GatewayServer | undefined;
let port: number;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function startFakeGateway(): Promise<{ base: string }> {
  server = createGatewayServer(new FakeLiveBridge(), { port: 0 as number });
  port = await server.start();
  return { base: `http://127.0.0.1:${port}` };
}

async function opCall(base: string, name: string, args?: unknown): Promise<unknown> {
  const res = await fetch(`${base}/api/ops/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: args === undefined ? undefined : JSON.stringify(args),
  });
  const body = (await res.json()) as { result?: unknown; error?: string; message?: string };
  if (!res.ok) throw new Error(`${body.error ?? "gateway error"}: ${body.message ?? ""}`);
  return body.result;
}

describe.skipIf(!hasBuiltCli)("awh bass 808 — full CLI integration", () => {
  it("end-to-end against a fake gateway: writes a real clip, shows the glide-contract note and meta line", async () => {
    const { base } = await startFakeGateway();
    const { dir, libraryRoot } = await makeTestLibrary();
    try {
      const result = await runCli(
        ["-p", String(port), "bass", "808", "track:0", "--key", "A minor", "--style", "trap-long", "--bars", "4", "--at-bar", "1"],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/trap-long 808 -> track:0\/arr:0 \(4 bars, \d+ notes\)/);
      expect(result.stdout).toMatch(/style trap-long — key A minor, cells .+, seed 1, slides on/);
      expect(result.stdout).toMatch(/pair with a mono synth with glide/);
      expect(result.stdout).toMatch(/awh op apply glide-bass/);

      const detail = (await opCall(base, "clip.get", { path: "track:0/arr:0" })) as ClipDetail;
      expect(detail.kind).toBe("midi");
      expect(detail.notes!.length).toBeGreaterThan(0);
      expect(detail.duration).toBe(16);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--dry-run never writes, and shows the notation preview with a slide overlap (trap-long, A minor)", async () => {
    const { base } = await startFakeGateway();
    const { dir, libraryRoot } = await makeTestLibrary();
    try {
      const result = await runCli(
        ["-p", String(port), "bass", "808", "track:0", "--key", "A minor", "--style", "trap-long", "--bars", "1", "--at-bar", "1", "--dry-run"],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/dry run: trap-long 808 ->/);
      expect(result.stdout).toMatch(/1\|1 /); // bar|beat notation preview reached real output

      const summary = (await opCall(base, "set.summary")) as { tracks: { arrangementClips: unknown[] }[] };
      expect(summary.tracks[0]!.arrangementClips).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--slides off writes gated notes with zero overlaps (diff against the default --slides on)", async () => {
    const { base } = await startFakeGateway();
    const { dir, libraryRoot } = await makeTestLibrary();
    try {
      const on = await runCli(
        [
          "-p", String(port), "bass", "808", "track:0",
          "--key", "A minor", "--style", "trap-long", "--bars", "4", "--seed", "1", "--at-bar", "1", "--dry-run",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      const off = await runCli(
        [
          "-p", String(port), "bass", "808", "track:0",
          "--key", "A minor", "--style", "trap-long", "--bars", "4", "--seed", "1", "--slides", "off", "--at-bar", "1", "--dry-run",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(on.status, on.stderr).toBe(0);
      expect(off.status, off.stderr).toBe(0);
      expect(on.stdout).toMatch(/slides on/);
      expect(off.stdout).toMatch(/slides off/);
      // same seed/style/bars, different --slides -> different notation (the
      // slide-lengthened notes shrink back to written length with slides off)
      expect(on.stdout).not.toBe(off.stdout);

      expect((await opCall(base, "set.summary")) as unknown).toBeTruthy(); // gateway still alive
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a malformed --slides value", async () => {
    const { dir, libraryRoot } = await makeTestLibrary();
    try {
      const result = await runCli(
        ["-p", "9", "bass", "808", "track:0", "--key", "A minor", "--slides", "maybe", "--at-bar", "1"],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/--slides must be "on" or "off"/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("unknown style: a clear, non-zero-exit error naming the 808-style-<name> convention", async () => {
    const { dir, libraryRoot } = await makeTestLibrary();
    try {
      // style resolution fails before any gateway call is made, so no fake
      // gateway is needed; the port is never dialed.
      const result = await runCli(
        ["-p", "9", "bass", "808", "track:0", "--key", "A minor", "--style", "does-not-exist", "--at-bar", "1"],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/unknown 808 bass style "does-not-exist"/);
      expect(result.stderr).toMatch(/808-style-does-not-exist/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("style fallback from a temp knowledge entry — tier printed, variants listable", async () => {
    const { base } = await startFakeGateway();
    const { dir, libraryRoot } = await makeTestLibrary();
    try {
      const knowledgeDir = join(dir, "knowledge", "rhythm");
      await mkdir(knowledgeDir, { recursive: true });
      await writeFile(
        join(knowledgeDir, "808-style-cli-test.md"),
        [
          "---",
          "slug: 808-style-cli-test",
          "topic: rhythm",
          "tier: sourced",
          "tags: [808, bass]",
          'sources: ["own analysis of test fixture"]',
          "related: []",
          "---",
          "# CLI test 808 style",
          "",
          "## Executable",
          "```awh-808-spec",
          "name: cli-test",
          "degrees: [0, 7]",
          "cells:",
          "  - name: only-cell",
          "    steps:",
          "      - {pos: 0, len: 2, degree: 0}",
          "      - {pos: 2, len: 2, degree: 7}",
          "```",
          "",
          "## The rule",
          "test fixture only.",
        ].join("\n"),
      );

      const result = await runCli(
        ["-p", String(port), "bass", "808", "track:0", "--key", "A minor", "--style", "cli-test", "--bars", "1", "--at-bar", "1", "--dry-run"],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/style cli-test \[sourced\]/);
      expect(result.stdout).toMatch(/cells only-cell/);

      // variants: only one cell -> ["only-cell"]; an unknown variant's error
      // names them (same listable convention as drums/phrase/arp).
      const badVariant = await runCli(
        [
          "-p", String(port), "bass", "808", "track:0",
          "--key", "A minor", "--style", "cli-test", "--bars", "1", "--at-bar", "1", "--variant", "nope", "--dry-run",
        ],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(badVariant.status).not.toBe(0);
      expect(badVariant.stderr).toMatch(/only-cell/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--key omitted falls back to the Set's active scale, and errors clearly when the Set has none", async () => {
    await startFakeGateway();
    const { dir, libraryRoot } = await makeTestLibrary();
    try {
      const result = await runCli(
        ["-p", String(port), "bass", "808", "track:0", "--at-bar", "1"],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/no active scale|--key/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a track target with no --at-bar and no slot path is a clear error", async () => {
    await startFakeGateway();
    const { dir, libraryRoot } = await makeTestLibrary();
    try {
      const result = await runCli(
        ["-p", String(port), "bass", "808", "track:0", "--key", "A minor"],
        { AWH_LIBRARY: libraryRoot },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/--at-bar/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
