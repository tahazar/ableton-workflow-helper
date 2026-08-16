import type { BridgeInfo, LiveBridge, SetSummary } from "../bridge/types.js";

/**
 * In-memory LiveBridge for tests and Live-less development (`awh serve-fake`).
 * Grows alongside the real adapter: every op added in M1+ gets a fake
 * implementation here first, so core logic and CLI are testable in CI.
 */
export class FakeLiveBridge implements LiveBridge {
  constructor(
    private readonly state: SetSummary = {
      tempo: 128,
      trackCount: 8,
      sceneCount: 4,
    },
  ) {}

  describe(): Promise<BridgeInfo> {
    return Promise.resolve({ kind: "fake", name: "FakeLiveBridge" });
  }

  getSetSummary(): Promise<SetSummary> {
    return Promise.resolve({ ...this.state });
  }
}
