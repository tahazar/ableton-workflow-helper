/**
 * LiveBridge is the seam between everything we build and whatever talks to
 * Ableton Live. The SDK-coupled extension shell implements it against the
 * Ableton Extensions SDK; FakeLiveBridge implements it for tests and offline
 * development. Nothing outside packages/extension may import the SDK (ADR-001).
 */

export interface BridgeInfo {
  /** Implementation kind, e.g. "sdk" (inside Live) or "fake" (tests/dev). */
  kind: "sdk" | "fake";
  /** Human-readable implementation name. */
  name: string;
  /** Ableton Extensions API version in use, if applicable. */
  liveApiVersion?: string;
}

/** Minimal M0 summary — grows in M1 (tracks, clips, devices, drum racks). */
export interface SetSummary {
  tempo: number;
  trackCount: number;
  sceneCount: number;
}

export interface LiveBridge {
  describe(): Promise<BridgeInfo>;
  getSetSummary(): Promise<SetSummary>;
}

/** Typed gateway error the server maps to HTTP status codes. */
export class BridgeError extends Error {
  constructor(
    public readonly code:
      | "not_found"
      | "bad_request"
      | "unavailable"
      | "internal",
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}
