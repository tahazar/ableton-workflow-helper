import { BridgeError } from "./types.js";

/**
 * Stable-format path strings addressing objects in the Live Set.
 *
 * Grammar (all indices 0-based):
 *   track:<i>            regular track            e.g. track:2
 *   return:<i>           return track
 *   main                 main/master track
 *   scene:<i>            scene
 * Sub-segments (joined with "/"), owner must be a track/chain as appropriate:
 *   slot:<i>             session clip slot        track:2/slot:4
 *   arr:<i>              arrangement clip         track:2/arr:1
 *   lane:<i>             take lane                track:2/lane:0
 *   dev:<i>              device                   track:2/dev:0
 *   chain:<i>            rack chain               track:2/dev:0/chain:3
 *                        (chains nest devices:    track:2/dev:0/chain:3/dev:1)
 *
 * Paths are ADDRESSES, not identities: they are re-resolved against the
 * current Set on every call, and indices shift when the user moves or
 * deletes objects. Callers should re-read the summary after structural edits.
 */

export type PathSegment =
  | { kind: "track" | "return" | "scene"; index: number }
  | { kind: "main" }
  | { kind: "slot" | "arr" | "lane" | "dev" | "chain"; index: number };

const ROOT_KINDS = new Set(["track", "return", "scene", "main"]);
const SUB_KINDS = new Set(["slot", "arr", "lane", "dev", "chain"]);

export function parsePath(path: string): PathSegment[] {
  if (typeof path !== "string" || path.length === 0) {
    throw new BridgeError("bad_request", "path must be a non-empty string");
  }
  const parts = path.split("/");
  const segments: PathSegment[] = [];

  parts.forEach((part, i) => {
    if (part === "main") {
      if (i !== 0) {
        throw new BridgeError("bad_request", `"main" must be the path root: ${path}`);
      }
      segments.push({ kind: "main" });
      return;
    }
    const match = part.match(/^(track|return|scene|slot|arr|lane|dev|chain):(\d+)$/);
    if (!match) {
      throw new BridgeError("bad_request", `invalid path segment "${part}" in ${path}`);
    }
    const kind = match[1]!;
    const index = Number(match[2]);
    const expectedRoot = i === 0;
    if (expectedRoot && !ROOT_KINDS.has(kind)) {
      throw new BridgeError("bad_request", `"${kind}" cannot be a path root: ${path}`);
    }
    if (!expectedRoot && !SUB_KINDS.has(kind)) {
      throw new BridgeError("bad_request", `"${kind}" cannot be a sub-segment: ${path}`);
    }
    segments.push({ kind, index } as PathSegment);
  });

  return segments;
}

export function formatPath(segments: PathSegment[]): string {
  return segments
    .map((s) => (s.kind === "main" ? "main" : `${s.kind}:${s.index}`))
    .join("/");
}

/** Convenience for building child paths. */
export function childPath(parent: string, kind: string, index: number): string {
  return `${parent}/${kind}:${index}`;
}

export function indexAt(
  segments: PathSegment[],
  position: number,
  expectedKind: PathSegment["kind"],
  path: string,
): number {
  const seg = segments[position];
  if (!seg || seg.kind !== expectedKind || !("index" in seg)) {
    throw new BridgeError(
      "bad_request",
      `expected ${expectedKind} at segment ${position} of ${path}`,
    );
  }
  return seg.index;
}
