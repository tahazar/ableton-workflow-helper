/**
 * AWH Ducker (m4l/): the "full-auto" duck strategy from
 * docs/design/analysis-engine.md's Duck strategies section: a
 * transport-synced gain-envelope M4L device driven over OSC, so there's no
 * routing to click through in Live. This module is the OSC push logic
 * behind `awh mix duck push`, kept out of packages/cli/src/index.ts so
 * it's testable against a real UDP socket without spawning the CLI
 * (packages/core/test/duck-push.test.ts).
 */
import { oscFloat, sendAndAwaitReply, sendToTap } from "./osc.js";

export const DUCK_PORT = 9722;
export const DUCK_REPLY_PORT = 9723;

export interface DuckShape {
  attackMs: number;
  holdMs: number;
  releaseMs: number;
  /** Positive dB of gain reduction at the trough (protocol convention). */
  depthDb: number;
}

export interface DuckTriggerSet {
  patternLengthBeats: number;
  /** Trigger positions in beats within the pattern, ascending. */
  beats: number[];
}

export interface DuckPushSummary {
  /** false only for the zero-trigger no-op state: nothing was sent. */
  sent: boolean;
  on: boolean;
  port: number;
  replyPort: number;
  version?: string;
  shape?: DuckShape;
  triggerCount?: number;
  patternLengthBeats?: number;
}

/** Read a `duck fit` --json save (recommendation.{depth_db,attack_ms,hold_ms,release_ms}). */
export function shapeFromFitJson(fit: unknown): DuckShape {
  const rec = (fit as { recommendation?: Record<string, number> } | undefined)?.recommendation;
  if (!rec || typeof rec.depth_db !== "number") {
    throw new Error(
      "not a duck-fit JSON file — expected a top-level \"recommendation\" object " +
        "(the shape `awh mix duck fit --json` prints)",
    );
  }
  if (typeof rec.release_ms !== "number") {
    throw new Error('duck-fit JSON is missing "recommendation.release_ms"');
  }
  return {
    attackMs: rec.attack_ms ?? 0,
    holdMs: rec.hold_ms ?? 0,
    releaseMs: rec.release_ms,
    depthDb: rec.depth_db,
  };
}

/**
 * Push a duck envelope (or bypass it) to the Ducker device. Zero-trigger is
 * a state, not an error (docs/lessons-learned.md rule 5): pass
 * `triggers: undefined` or an empty beats array with `off: false` and
 * nothing is sent. The caller should print the "nothing to duck" message
 * and exit 0.
 */
export async function pushDuck(params: {
  port?: number;
  replyPort?: number;
  timeoutMs?: number;
  off?: boolean;
  shape?: DuckShape;
  triggers?: DuckTriggerSet;
}): Promise<DuckPushSummary> {
  const port = params.port ?? DUCK_PORT;
  const replyPort = params.replyPort ?? DUCK_REPLY_PORT;
  const timeoutMs = params.timeoutMs ?? 1000;

  if (!params.off && (!params.triggers || params.triggers.beats.length === 0)) {
    return { sent: false, on: false, port, replyPort };
  }

  const pongArgs = await sendAndAwaitReply({
    address: "/awh/duck/ping",
    sendPort: port,
    replyPort,
    matchAddress: "/awh/duck/pong",
    timeoutMs,
  }).catch((err: Error) => {
    throw new Error(
      `${err.message} — is the AWH Ducker device loaded (on the Sidechain bus) and ` +
        `listening on port ${port}? (m4l/README.md)`,
    );
  });
  const version = pongArgs.length > 0 ? String(pongArgs[0]) : "";

  if (params.off) {
    await sendToTap("/awh/duck/on", [0], port);
    return { sent: true, on: false, port, replyPort, version };
  }

  const shape = params.shape!;
  const triggers = params.triggers!;
  await sendToTap(
    "/awh/duck/triggers",
    [oscFloat(triggers.patternLengthBeats), ...triggers.beats.map(oscFloat)],
    port,
  );
  await sendToTap(
    "/awh/duck/shape",
    [oscFloat(shape.attackMs), oscFloat(shape.holdMs), oscFloat(shape.releaseMs), oscFloat(shape.depthDb)],
    port,
  );
  await sendToTap("/awh/duck/on", [1], port);

  return {
    sent: true,
    on: true,
    port,
    replyPort,
    version,
    shape,
    triggerCount: triggers.beats.length,
    patternLengthBeats: triggers.patternLengthBeats,
  };
}
