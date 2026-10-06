import { afterEach, describe, expect, it } from "vitest";
import { createGatewayServer, FakeLiveBridge, type GatewayServer, type SetSummary } from "@awh/core";
import type { OpCaller } from "../src/op.js";
import { layerFileName, runLayers, type LayerCaptureFn } from "../src/layers.js";

/**
 * `awh mix layers` state-restoration tests: against a real gateway server
 * backed by FakeLiveBridge (same pattern as op.test.ts/test/server.test.ts).
 * The property under test is that no track is left soloed by mistake
 * (docs/design/analysis-engine.md). It is checked twice: on the happy path,
 * and as a negative control where an injected capture failure aborts the
 * run mid-track. The solo state must come back exactly as it was found
 * either way (docs/lessons-learned.md rule 2).
 */

let server: GatewayServer | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

interface GatewayBody {
  result?: unknown;
  error?: string;
  message?: string;
}

async function startFakeGateway(): Promise<OpCaller> {
  server = createGatewayServer(new FakeLiveBridge(), { port: 0 as number });
  const port = await server.start();
  const base = `http://127.0.0.1:${port}`;
  return async (name, args) => {
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
}

async function soloMap(caller: OpCaller): Promise<Map<string, boolean>> {
  const summary = (await caller("set.summary")) as SetSummary;
  return new Map([...summary.tracks, ...summary.returnTracks].map((t) => [t.path, t.soloed]));
}

// Fast options for tests: no real sleeps; retries pinned explicitly per test
// so each test states its attempt semantics.
const FAST = { sleep: async () => {}, interTrackSettleMs: 0 };

describe("layerFileName", () => {
  it("is order-prefixed and slug-safe", () => {
    expect(layerFileName("track:0", 0)).toBe("00-track-0.wav");
    expect(layerFileName("track:12", 3)).toBe("03-track-12.wav");
  });
});

describe("runLayers — happy path", () => {
  it("solos ONLY the target track during each capture, then restores every track's prior solo state", async () => {
    const caller = await startFakeGateway();
    // Pre-existing state the run must come back to: track:1 already soloed
    // before `awh mix layers` runs, the case the "restore exact prior state"
    // requirement exists for.
    await caller("track.update", { path: "track:1", soloed: true });
    const before = await soloMap(caller);
    expect(before.get("track:1")).toBe(true);
    expect(before.get("track:0")).toBe(false);

    const observedSoloDuringCapture: Record<string, Map<string, boolean>> = {};
    const capture: LayerCaptureFn = async (trackPath) => {
      observedSoloDuringCapture[trackPath] = await soloMap(caller);
      return 1.5;
    };

    const results = await runLayers(caller, ["track:0", "track:2"], "/tmp/awh-layers-test", capture, FAST);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.trackPath)).toEqual(["track:0", "track:2"]);
    expect(results[0]!.outPath).toBe("/tmp/awh-layers-test/00-track-0.wav");
    expect(results[1]!.outPath).toBe("/tmp/awh-layers-test/01-track-2.wav");
    expect(results.every((r) => r.seconds === 1.5)).toBe(true);

    // Isolation during each step: exactly one track soloed, and it's the
    // one being captured. track:1's pre-existing solo was suspended too.
    for (const [trackPath, snap] of Object.entries(observedSoloDuringCapture)) {
      for (const [p, soloed] of snap) {
        expect(soloed).toBe(p === trackPath);
      }
    }

    // Exact restoration, including the pre-existing track:1 solo.
    const after = await soloMap(caller);
    expect(after).toEqual(before);
  });

  it("zero tracks is valid input: no gateway calls, empty result", async () => {
    const caller = await startFakeGateway();
    let calls = 0;
    const countingCaller: OpCaller = async (name, args) => {
      calls++;
      return caller(name, args);
    };
    const capture: LayerCaptureFn = async () => {
      throw new Error("capture must never be called for zero tracks");
    };
    const results = await runLayers(countingCaller, [], "/tmp/awh-layers-test", capture, FAST);
    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });

  it("throws a clear error for an unknown track path and touches no solo state", async () => {
    const caller = await startFakeGateway();
    const before = await soloMap(caller);
    const capture: LayerCaptureFn = async () => 1.0;
    await expect(runLayers(caller, ["track:99"], "/tmp/x", capture, FAST)).rejects.toThrow(/track not found: track:99/);
    expect(await soloMap(caller)).toEqual(before);
  });
});

describe("runLayers — negative control: a mid-run capture failure must still restore solo state", () => {
  it("restores ALL tracks' solo state (including the failing track's own) when capture() throws", async () => {
    const caller = await startFakeGateway();
    await caller("track.update", { path: "track:3", soloed: true }); // unrelated pre-existing solo
    const before = await soloMap(caller);

    let captureCalls = 0;
    const capture: LayerCaptureFn = async (trackPath) => {
      captureCalls++;
      if (trackPath === "track:1") {
        // Simulate the real failure mode: the AWH Capture Tap
        // device isn't loaded (captureSpan's own error shape).
        throw new Error(`/tmp/out.wav was not created — is the AWH Capture Tap device loaded?`);
      }
      return 1.0;
    };

    await expect(runLayers(caller, ["track:0", "track:1", "track:2"], "/tmp/x", capture, { ...FAST, retries: 0 })).rejects.toThrow(
      /AWH Capture Tap/,
    );

    // track:2 must never have been reached: the run aborts instead of
    // continuing past a failed step.
    expect(captureCalls).toBe(2);

    // Every track's solo state reads back exactly as it was before the run:
    // track:0 (soloed then un-soloed before the failure), track:1 (soloed,
    // then the capture threw), and track:3 (untouched pre-existing solo).
    // Checked with a set.summary read-back, not an in-memory assertion.
    const after = await soloMap(caller);
    expect(after).toEqual(before);
    expect(after.get("track:3")).toBe(true);
    expect(after.get("track:0")).toBe(false);
    expect(after.get("track:1")).toBe(false);
    // Exactly one track soloed overall (the pre-existing track:3), with no
    // leftover solo from the aborted run.
    expect([...after.values()].filter(Boolean)).toEqual([true]);
  });

  it("a track further down the list is never touched after an earlier failure", async () => {
    const caller = await startFakeGateway();
    const before = await soloMap(caller);
    const seen: string[] = [];
    const capture: LayerCaptureFn = async (trackPath) => {
      seen.push(trackPath);
      if (trackPath === "track:0") throw new Error("boom");
      return 1.0;
    };
    await expect(runLayers(caller, ["track:0", "track:1"], "/tmp/x", capture, { ...FAST, retries: 0 })).rejects.toThrow("boom");
    expect(seen).toEqual(["track:0"]);
    expect(await soloMap(caller)).toEqual(before);
  });
});

describe("runLayers — retry on the known rapid-capture flake", () => {
  it("retries a failed capture once, marks the result, keeps solo state exact throughout", async () => {
    const caller = await startFakeGateway();
    await caller("track.update", { path: "track:3", soloed: true });
    const before = await soloMap(caller);

    let attempts = 0;
    const retriedTracks: string[] = [];
    const capture: LayerCaptureFn = async (trackPath) => {
      attempts++;
      // First attempt on track:1 aborts (the live-observed intermittent
      // race in rapid back-to-back sfrecord~ cycles); the retry succeeds.
      if (trackPath === "track:1" && attempts === 2) throw new Error("recording aborted");
      return 2.0;
    };

    const results = await runLayers(caller, ["track:0", "track:1"], "/tmp/x", capture, {
      ...FAST,
      retries: 1,
      onRetry: (trackPath) => retriedTracks.push(trackPath),
    });

    expect(attempts).toBe(3); // track:0 once, track:1 twice
    expect(retriedTracks).toEqual(["track:1"]);
    expect(results).toHaveLength(2);
    expect(results[0]!.retried).toBe(false);
    expect(results[1]!.retried).toBe(true);
    expect(results[1]!.seconds).toBe(2.0);
    expect(await soloMap(caller)).toEqual(before);
  });

  it("exhausted retries still throw and still restore solo state", async () => {
    const caller = await startFakeGateway();
    const before = await soloMap(caller);
    let attempts = 0;
    const capture: LayerCaptureFn = async () => {
      attempts++;
      throw new Error("recording aborted");
    };
    await expect(
      runLayers(caller, ["track:0"], "/tmp/x", capture, { ...FAST, retries: 1 }),
    ).rejects.toThrow("recording aborted");
    expect(attempts).toBe(2); // initial + one retry, then give up
    expect(await soloMap(caller)).toEqual(before);
  });
});
