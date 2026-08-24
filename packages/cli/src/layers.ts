/**
 * `awh mix layers`: the solo -> capture -> unsolo choreography the gap
 * report found being done entirely by hand during a real masking-analysis
 * session (docs/design/analysis-engine.md, "Future work" section,
 * 2026-08-23) — "real risk of leaving a track soloed by mistake between
 * steps." `runLayers` isolates that risky bookkeeping (read/restore solo
 * state) from the CLI's I/O (the gateway, the M4L capture tap) so it's
 * unit-testable against a fake gateway AND against an injected FAILING
 * capture — the negative control that proves solo state comes back exactly
 * as it was even when a step throws mid-run. Split out of index.ts, same
 * spirit as duck.ts/op.ts.
 */
import { join } from "node:path";
import type { SetSummary, TrackSummary } from "@awh/core";
import { slugify } from "@awh/core";
import type { OpCaller } from "./op.js";

/** Records/captures one track (already soloed-in-isolation by the time
 *  this is called) to `outPath` and resolves with the seconds captured. */
export type LayerCaptureFn = (trackPath: string, outPath: string) => Promise<number>;

export interface LayerResult {
  trackPath: string;
  trackName: string;
  outPath: string;
  seconds: number;
}

function allTracks(summary: SetSummary): TrackSummary[] {
  return [...summary.tracks, ...summary.returnTracks];
}

/** Deterministic capture filename: order-prefixed so it stays sortable
 *  even if two track paths ever slugified to the same string. */
export function layerFileName(trackPath: string, index: number): string {
  return `${String(index).padStart(2, "0")}-${slugify(trackPath)}.wav`;
}

/**
 * For each track in `tracks`, in order: read the CURRENT solo state of
 * every track, solo ONLY this one (any other currently-soloed track is
 * un-soloed for the duration — "solo ONLY that track", not "also solo
 * this one"), capture, then restore EVERY track's solo state to exactly
 * what it was before this step. The restore runs in a `finally`, so a
 * capture that throws (e.g. the AWH Capture Tap device isn't loaded) still
 * leaves the Set's solo state exactly as this step found it — the critical
 * property, tested against a deliberately-failing capture in
 * test/layers.test.ts.
 *
 * Zero tracks is a valid input here (returns `[]` immediately, no gateway
 * calls) — the CLI layer is the one that decides to treat that as a
 * printed state rather than silently doing nothing.
 */
export async function runLayers(
  caller: OpCaller,
  tracks: string[],
  outDir: string,
  capture: LayerCaptureFn,
): Promise<LayerResult[]> {
  const results: LayerResult[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const trackPath = tracks[i]!;
    const summary = (await caller("set.summary")) as SetSummary;
    const targets = allTracks(summary);
    const target = targets.find((t) => t.path === trackPath);
    if (!target) {
      throw new Error(
        `track not found: ${trackPath} (known tracks: ${
          targets.map((t) => `${t.path} "${t.name}"`).join(", ") || "none"
        })`,
      );
    }

    const priorSolo = new Map(targets.map((t) => [t.path, t.soloed]));
    const changed: string[] = [];
    try {
      for (const t of targets) {
        const desired = t.path === trackPath;
        if (t.soloed !== desired) {
          await caller("track.update", { path: t.path, soloed: desired });
          changed.push(t.path);
        }
      }
      const outPath = join(outDir, layerFileName(trackPath, i));
      const seconds = await capture(trackPath, outPath);
      results.push({ trackPath, trackName: target.name, outPath, seconds });
    } finally {
      for (const p of changed) {
        await caller("track.update", { path: p, soloed: priorSolo.get(p)! });
      }
    }
  }
  return results;
}
