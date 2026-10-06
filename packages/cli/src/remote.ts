/**
 * AWH Remote (m4l/): the M4L device that closes the "press play"/"launch a
 * clip" gap the Extensions SDK leaves open (docs/design/live-remote.md,
 * docs/sdk-feedback.md). This module is the OSC send/receive logic behind
 * `awh play`/`awh stop`/`awh jump`/`awh launch`/`awh stop-clips`/`awh lib
 * audition`, kept out of packages/cli/src/index.ts so it's testable
 * against a real UDP socket without spawning the CLI
 * (packages/cli/test/remote.test.ts).
 *
 * Ports and protocol are a superset of the AWH Capture Tap this device
 * supersedes (9720 listen / 9721 reply). record/stop/loop/play are
 * fire-and-forget (no reply besides pong). fire/scene/stopclips/jump each
 * reply with `/awh/status ...` (success) or `/awh/error <text>` (bad
 * indices).
 */
import type { OpCaller } from "./op.js";
import type { SetSummary } from "@awh/core";
import { parseNotation } from "@awh/core";
import {
  TAP_PORT,
  oscFloat,
  sendAndAwaitAnyReply,
  sendAndAwaitReply,
  sendToTap,
  type OscArg,
} from "./osc.js";

export const REMOTE_PORT = TAP_PORT; // 9720, same port as the AWH Capture Tap it supersedes
export const REMOTE_REPLY_PORT = 9721;

export interface RemoteOscOpts {
  port?: number;
  replyPort?: number;
  timeoutMs?: number;
}

function resolveOscOpts(opts: RemoteOscOpts): { port: number; replyPort: number; timeoutMs: number } {
  return {
    port: opts.port ?? REMOTE_PORT,
    replyPort: opts.replyPort ?? REMOTE_REPLY_PORT,
    timeoutMs: opts.timeoutMs ?? 1000,
  };
}

/** Ping the AWH Remote device; resolves with its reported version, or
 *  throws a clear "requires the AWH Remote device" error within ~1s. Every
 *  remote-send function below calls this first (ping-first convention,
 *  as in `mix duck push`; see docs/design/live-remote.md's CLI section). */
export async function remotePing(opts: RemoteOscOpts = {}): Promise<string> {
  const { port, replyPort, timeoutMs } = resolveOscOpts(opts);
  const pongArgs = await sendAndAwaitReply({
    address: "/awh/ping",
    sendPort: port,
    replyPort,
    matchAddress: "/awh/pong",
    timeoutMs,
  }).catch((err: Error) => {
    throw new Error(
      `${err.message} — requires the AWH Remote device loaded and listening on port ${port} ` +
        "(m4l/README.md)",
    );
  });
  return pongArgs.length > 0 ? String(pongArgs[0]) : "";
}

/** Send one of the replying action messages (fire/scene/stopclips/jump):
 *  ping first, then await either `/awh/status ...` (resolves with its args)
 *  or `/awh/error <text>` (thrown as an Error). The device replies the same
 *  way regardless of which action was sent. */
async function sendRemoteAction(
  address: string,
  args: OscArg[],
  opts: RemoteOscOpts,
): Promise<(string | number)[]> {
  const { port, replyPort, timeoutMs } = resolveOscOpts(opts);
  await remotePing({ port, replyPort, timeoutMs });
  const reply = await sendAndAwaitAnyReply({
    address,
    args,
    sendPort: port,
    replyPort,
    matchAddresses: ["/awh/status", "/awh/error"],
    timeoutMs,
  });
  if (reply.address === "/awh/error") {
    throw new Error(`AWH Remote: ${reply.args[0] ?? "error"}`);
  }
  return reply.args;
}

export interface RemotePlayResult {
  /** `/awh/status jump ...` args, if --from-bar (or an explicit fromBeats) was given. */
  jumped?: (string | number)[];
}

/** Start the transport (`/awh/play 1`), optionally jumping the arrangement
 *  playhead first. `/awh/play` itself is fire-and-forget, as on the Capture
 *  Tap: no reply beyond the ping's pong. */
export async function remotePlay(
  params: RemoteOscOpts & { fromBeats?: number },
): Promise<RemotePlayResult> {
  const { port, replyPort, timeoutMs } = resolveOscOpts(params);
  await remotePing({ port, replyPort, timeoutMs });
  let jumped: (string | number)[] | undefined;
  if (params.fromBeats !== undefined) {
    jumped = await sendRemoteAction("/awh/jump", [oscFloat(params.fromBeats)], {
      port,
      replyPort,
      timeoutMs,
    });
  }
  await sendToTap("/awh/play", [1], port);
  return { jumped };
}

/** Stop the transport (`/awh/play 0`). Fire-and-forget, no reply. */
export async function remoteStop(opts: RemoteOscOpts = {}): Promise<void> {
  const { port, replyPort, timeoutMs } = resolveOscOpts(opts);
  await remotePing({ port, replyPort, timeoutMs });
  await sendToTap("/awh/play", [0], port);
}

/** Set the arrangement playhead (`/awh/jump <beats>`, `current_song_time`). */
export async function remoteJump(
  params: RemoteOscOpts & { beats: number },
): Promise<(string | number)[]> {
  return sendRemoteAction("/awh/jump", [oscFloat(params.beats)], params);
}

/** Fire a session clip slot (`/awh/fire <trackIdx> <slotIdx>`). */
export async function remoteFire(
  params: RemoteOscOpts & { trackIdx: number; slotIdx: number },
): Promise<(string | number)[]> {
  return sendRemoteAction("/awh/fire", [params.trackIdx, params.slotIdx], params);
}

/** Fire a scene (`/awh/scene <sceneIdx>`). */
export async function remoteScene(
  params: RemoteOscOpts & { sceneIdx: number },
): Promise<(string | number)[]> {
  return sendRemoteAction("/awh/scene", [params.sceneIdx], params);
}

/** Stop all clips on a track, or the whole Set when `trackIdx` is -1
 *  (`/awh/stopclips <trackIdx>`). */
export async function remoteStopClips(
  params: RemoteOscOpts & { trackIdx: number },
): Promise<(string | number)[]> {
  return sendRemoteAction("/awh/stopclips", [params.trackIdx], params);
}

// ---------------------------------------------------------------------------
// `awh launch` target parsing
// ---------------------------------------------------------------------------

export type LaunchTarget =
  | { kind: "fire"; trackIdx: number; slotIdx: number }
  | { kind: "scene"; sceneIdx: number };

/** Parse `awh launch`'s target argument: `track:N/slot:M` (fire) or
 *  `scene:N` (scene fire), using the CLI's shared path grammar
 *  (packages/core/src/bridge/paths.ts). */
export function parseLaunchTarget(target: string): LaunchTarget {
  const fireMatch = target.match(/^track:(\d+)\/slot:(\d+)$/);
  if (fireMatch) {
    return { kind: "fire", trackIdx: Number(fireMatch[1]), slotIdx: Number(fireMatch[2]) };
  }
  const sceneMatch = target.match(/^scene:(\d+)$/);
  if (sceneMatch) {
    return { kind: "scene", sceneIdx: Number(sceneMatch[1]) };
  }
  throw new Error(
    `awh launch needs a target like track:2/slot:0 (fire) or scene:1 (scene fire), got "${target}"`,
  );
}

// ---------------------------------------------------------------------------
// `awh lib audition`: place (gateway) + fire (OSC), with sweep-on-next
// cleanup for auditions that weren't --keep (docs/design/live-remote.md).
// ---------------------------------------------------------------------------

/** The one clip the CLI is tracking as "auditioned, not yet swept": enough
 *  to find and delete it later by its exact clip name (never a prefix
 *  sweep; see docs/lessons-learned.md's `--prefix ""` lesson). The caller
 *  (index.ts) persists it between CLI invocations; this module has no file
 *  I/O. */
export interface AuditionState {
  trackPath: string;
  name: string;
  slug: string;
}

export interface AuditionSource {
  slug: string;
  notation: string;
  lengthBeats: number;
  beatsPerBar: number;
}

export interface AuditionOutcome {
  path: string;
  name: string;
  trackIdx: number;
  slotIdx: number;
  fireArgs: (string | number)[];
  /** Paths deleted because a previous (non---keep) audition was pending. */
  swept?: string[];
  /** Persist this as the new pending state (undefined when --keep was
   *  passed: nothing to auto-sweep later). */
  nextPending?: AuditionState;
}

/** Delete every clip on `trackPath` (session and arrangement) whose name is
 *  exactly `name` (not a prefix match). Does nothing if the track no longer
 *  exists or nothing matches; the caller decides whether that's worth
 *  reporting. */
async function sweepByExactName(
  caller: OpCaller,
  trackPath: string,
  name: string,
): Promise<string[]> {
  const summary = (await caller("set.summary")) as SetSummary;
  const track = [...summary.tracks, ...summary.returnTracks].find((t) => t.path === trackPath);
  if (!track) return [];
  const doomed = [...track.sessionClips, ...track.arrangementClips].filter((c) => c.name === name);
  // Descending index order, same as `awh sweep`, so earlier deletions can't
  // shift the paths of later ones.
  doomed.sort((a, b) => {
    const index = (p: string) => Number(p.match(/(\d+)$/)?.[1] ?? 0);
    return index(b.path) - index(a.path);
  });
  for (const c of doomed) await caller("clip.delete", { path: c.path });
  return doomed.map((c) => c.path);
}

/** `awh lib audition <slug> <track>`: sweep a pending previous audition (if
 *  any), place `source` into an empty session slot on `trackPath`, and fire
 *  it over OSC. The clip is named "audition: <slug>" (not the bare slug) so
 *  it can't collide with a same-named clip placed by hand. Zero empty
 *  slots is a thrown error, as in `lib place`/`drop respond`'s track-target
 *  resolution. */
export async function auditionSlug(params: {
  caller: OpCaller;
  source: AuditionSource;
  trackPath: string;
  keep?: boolean;
  pending?: AuditionState;
  osc?: RemoteOscOpts;
}): Promise<AuditionOutcome> {
  const trackMatch = params.trackPath.match(/^track:(\d+)$/);
  if (!trackMatch) {
    throw new Error(
      `awh lib audition needs a plain track path like track:2 (got "${params.trackPath}") — ` +
        "session-clip fire only addresses regular tracks",
    );
  }
  const trackIdx = Number(trackMatch[1]);

  const swept = params.pending
    ? await sweepByExactName(params.caller, params.pending.trackPath, params.pending.name)
    : undefined;

  const summary = (await params.caller("set.summary")) as SetSummary;
  const track = [...summary.tracks, ...summary.returnTracks].find((t) => t.path === params.trackPath);
  if (!track) throw new Error(`track not found: ${params.trackPath}`);
  const occupied = new Set(
    track.sessionClips.map((c) => Number(c.path.match(/slot:(\d+)$/)?.[1])),
  );
  const slotIdx = Array.from({ length: track.slotCount }, (_, i) => i).find((i) => !occupied.has(i));
  if (slotIdx === undefined) {
    throw new Error(
      `no empty session slot on ${params.trackPath} — free one up (or \`awh sweep\`) before auditioning`,
    );
  }

  const { notes } = parseNotation(params.source.notation, { beatsPerBar: params.source.beatsPerBar });
  const name = `audition: ${params.source.slug}`;
  const path = `${params.trackPath}/slot:${slotIdx}`;
  await params.caller("clip.create-midi", {
    target: { type: "session", slotPath: path },
    lengthBeats: params.source.lengthBeats,
    notes,
    name,
  });

  let fireArgs: (string | number)[];
  try {
    fireArgs = await remoteFire({ trackIdx, slotIdx, ...(params.osc ?? {}) });
  } catch (err) {
    throw new Error(`placed ${params.source.slug} -> ${path} but could not fire it: ${(err as Error).message}`);
  }

  return {
    path,
    name,
    trackIdx,
    slotIdx,
    fireArgs,
    swept,
    nextPending: params.keep ? undefined : { trackPath: params.trackPath, name, slug: params.source.slug },
  };
}

/** `awh lib audition --end`: sweep the pending (non---keep) audition, if
 *  any. No pending state is a normal state, not an error (returns
 *  undefined), like `mix duck push`'s empty-trigger no-op
 *  (docs/lessons-learned.md rule 5). */
export async function auditionEnd(params: {
  caller: OpCaller;
  pending?: AuditionState;
}): Promise<string[] | undefined> {
  if (!params.pending) return undefined;
  return sweepByExactName(params.caller, params.pending.trackPath, params.pending.name);
}
