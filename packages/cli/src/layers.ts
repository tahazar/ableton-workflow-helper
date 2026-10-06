/**
 * `awh mix layers`: automates the solo -> capture -> unsolo sequence that
 * masking analysis otherwise needs by hand, where it is easy to leave a
 * track soloed by mistake (docs/design/analysis-engine.md, "Future work").
 * `runLayers` isolates the solo-state bookkeeping from the CLI's I/O (the
 * gateway, the M4L capture tap) so it's unit-testable against a fake
 * gateway and against an injected failing capture. The failing capture is
 * the negative control proving solo state comes back exactly as it was
 * even when a step throws mid-run.
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
  /** True when the first capture attempt aborted and the retry succeeded
   *  (the known intermittent race in rapid back-to-back sfrecord~ cycles;
   *  see the 2026-08-24 live-validation note in docs/dev-loop.md). */
  retried?: boolean;
}

export interface RunLayersOptions {
  /** Pause between one track's restore and the next track's solo, letting
   *  sfrecord~ fully close out. The live-observed race is specific to
   *  rapid back-to-back record cycles, not single captures. */
  interTrackSettleMs?: number;
  /** Extra attempts per track after a failed capture (default 1). */
  retries?: number;
  /** Pause before a retry attempt. */
  retrySettleMs?: number;
  /** Injected for tests; defaults to a real setTimeout sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Called when a capture aborts and a retry is about to run, so the CLI
   *  can tell the user this is a known flake, not a broken tool. */
  onRetry?: (trackPath: string, error: unknown) => void;
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
 * For each track in `tracks`, in order: read the current solo state of
 * every track, solo only this one (any other soloed track is un-soloed for
 * the duration), capture, then restore every track's solo state to exactly
 * what it was before this step. The restore runs in a `finally`, so a
 * capture that throws (e.g. the AWH Capture Tap device isn't loaded) still
 * leaves the Set's solo state as this step found it. test/layers.test.ts
 * pins this with a deliberately failing capture.
 *
 * Zero tracks is a valid input (returns `[]` with no gateway calls). The
 * CLI layer decides how to report that state.
 */
export async function runLayers(
  caller: OpCaller,
  tracks: string[],
  outDir: string,
  capture: LayerCaptureFn,
  opts: RunLayersOptions = {},
): Promise<LayerResult[]> {
  const interTrackSettleMs = opts.interTrackSettleMs ?? 750;
  const retries = opts.retries ?? 1;
  const retrySettleMs = opts.retrySettleMs ?? 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const results: LayerResult[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const trackPath = tracks[i]!;
    if (i > 0 && interTrackSettleMs > 0) await sleep(interTrackSettleMs);
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
      let seconds: number | undefined;
      let retried = false;
      for (let attempt = 0; ; attempt++) {
        try {
          seconds = await capture(trackPath, outPath);
          break;
        } catch (err) {
          if (attempt >= retries) throw err;
          retried = true;
          opts.onRetry?.(trackPath, err);
          await sleep(retrySettleMs);
        }
      }
      results.push({ trackPath, trackName: target.name, outPath, seconds, retried });
    } finally {
      for (const p of changed) {
        await caller("track.update", { path: p, soloed: priorSolo.get(p)! });
      }
    }
  }
  return results;
}
