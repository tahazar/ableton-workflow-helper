import type { ExtensionContext } from "@ableton-extensions/sdk";
import type { BridgeInfo, LiveBridge, SetSummary } from "@awh/core";

const LIVE_API_VERSION = "1.0.0";

/**
 * LiveBridge adapter over the Ableton Extensions SDK. This file and main.ts
 * are the ONLY places the SDK may be touched (ADR-001).
 *
 * VERIFY-ON-MACHINE: accessor names (getTempo/getTracks/getScenes vs
 * properties) are reconstructed from the API reference; confirm against the
 * real SDK types on first build and update the shim to match.
 */
export class SdkLiveBridge implements LiveBridge {
  constructor(private readonly ctx: ExtensionContext) {}

  describe(): Promise<BridgeInfo> {
    return Promise.resolve({
      kind: "sdk",
      name: "AWH Gateway (Ableton Extensions SDK)",
      liveApiVersion: LIVE_API_VERSION,
    });
  }

  async getSetSummary(): Promise<SetSummary> {
    const song = this.ctx.song;
    return {
      tempo: song.getTempo(),
      trackCount: song.getTracks().length,
      sceneCount: song.getScenes().length,
    };
  }
}

export { LIVE_API_VERSION };
