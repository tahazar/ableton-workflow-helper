import type { ExtensionContext } from "@ableton-extensions/sdk";
import type { BridgeInfo, LiveBridge, SetSummary } from "@awh/core";

const LIVE_API_VERSION = "1.0.0";

/**
 * LiveBridge adapter over the Ableton Extensions SDK. This file and main.ts
 * are the ONLY places the SDK may be touched (ADR-001).
 *
 * Song is reached via `ctx.application.song` (not `ctx.song`); tempo/tracks/
 * scenes are getters, not methods — confirmed against
 * vendor/ableton-sdk/sdk/package/dist/index.d.mts on first build.
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
    const song = this.ctx.application.song;
    return {
      tempo: song.tempo,
      trackCount: song.tracks.length,
      sceneCount: song.scenes.length,
    };
  }
}

export { LIVE_API_VERSION };
