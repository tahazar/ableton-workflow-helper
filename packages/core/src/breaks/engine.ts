/**
 * Break-chop pattern/fill generation. Pure: chop map in, notes out (see
 * chopmap.ts's parseChopMap for the JSON adapter), so it tests without
 * Python and without a real chop ever having been run. Pinned semantics:
 * docs/design/break-engine.md.
 *
 * Two independent generators over the same ChopMap:
 *  - generateBreakPattern: BreakSpec-driven re-sequencing (statement bars,
 *    then a turnaround that chops/substitutes/displaces/ghost-shuffles).
 *  - generateBreakFill: a fixed built-in fill grammar (snare-rush/stutter/
 *    triplet/tail-rearrange "devices"), restrained to at most
 *    `BreakFillSpec.maxDevices` distinct device types per candidate, N
 *    seeded candidates at once (same drop-into-consecutive-slots
 *    convention as `awh vary`).
 */
import type { NoteSpec } from "../bridge/types.js";
import { sortNotes } from "../transforms/types.js";
import { makeRng } from "../transforms/rng.js";
import type { BreakSpec } from "./spec.js";
import { type ChopMap, type ChopMapSlice, type ChopRole, type SliceNoteMode, sliceNote } from "./chopmap.js";

/** Below this per-slice confidence, the map's role guesses are too shaky to
 *  trust for a cross-slice substitution. A chop map with all-low-confidence
 *  roles makes pattern generation warn and restrict substitutions to
 *  same-slice tricks (see docs/design/break-engine.md). Checked as "every
 *  slice is under this", not an average: one confidently-labeled slice is
 *  enough to keep substitution trustworthy for its own role. */
export const LOW_CONFIDENCE_THRESHOLD = 0.4;

const GATE = 0.85; // fraction of a grid step a note holds; leaves a hair
// of silence so consecutive same-pitch retriggers (stutters) still
// articulate as separate notes rather than one held note in most hosts.

const VELOCITY_DEFAULT = 100;
const VELOCITY_GHOST = 68;
const VELOCITY_STUTTER_TAIL = 82;

export interface GenerateBreakPatternOptions {
  seed: number;
  bars: number;
  /** Numeric seed offset only. BreakSpec has no cell/recipe table to draw
   *  a named variant from (unlike drums/arp/phrase). Folded into the rng
   *  seed. */
  variant?: number;
  mode: SliceNoteMode;
}

export interface GeneratedBreakPattern {
  notes: NoteSpec[];
  warnings: string[];
  meta: {
    style: string;
    statementBars: string;
    sourceGridLen: string;
    substitutionAllowed: string;
    seed: string;
  };
}

interface CanonicalTimeline {
  /** gridStep -> slice, only for steps where the map has an onset. */
  byStep: Map<number, ChopMapSlice>;
  /** One loop through the chop map's own material, in grid steps. */
  sourceLen: number;
}

function buildTimeline(map: ChopMap): CanonicalTimeline {
  const byStep = new Map<number, ChopMapSlice>();
  let maxStep = -1;
  for (const s of map.slices) {
    byStep.set(s.gridStep, s);
    if (s.gridStep > maxStep) maxStep = s.gridStep;
  }
  return { byStep, sourceLen: Math.max(1, maxStep + 1) };
}

function sameRolePool(map: ChopMap, role: ChopRole): ChopMapSlice[] {
  return map.slices.filter((s) => s.role === role);
}

function pick<T>(pool: T[], rng: () => number): T {
  return pool[Math.floor(rng() * pool.length) % pool.length]!;
}

/**
 * BreakSpec-driven re-sequencing over a chopped break: `spec.statementBars`
 * bars of verbatim canonical playback, then a turnaround that (role-aware)
 * substitutes, stutters, displaces snares, and ghost-shuffles per the
 * spec's density fields. Every emitted note's pitch always maps to a real
 * slice index in `map` (see chopmap.sliceNote) — property tested.
 */
export function generateBreakPattern(
  map: ChopMap,
  spec: BreakSpec,
  opts: GenerateBreakPatternOptions,
): GeneratedBreakPattern {
  const warnings: string[] = [];
  const grid = map.gridStepsPerBar;
  const stepBeats = map.beatsPerBar / grid;
  const nSlices = map.slices.length;

  if (nSlices === 0) {
    warnings.push("this chop map has zero slices — nothing to sequence (chop a break with onsets first).");
    return {
      notes: [],
      warnings,
      meta: {
        style: spec.name,
        statementBars: String(spec.statementBars),
        sourceGridLen: "0",
        substitutionAllowed: "false",
        seed: String(opts.seed),
      },
    };
  }

  const timeline = buildTimeline(map);
  const totalSteps = opts.bars * grid;
  const statementSteps = Math.min(spec.statementBars * grid, totalSteps);

  const allLowConfidence = map.slices.every((s) => s.confidence < LOW_CONFIDENCE_THRESHOLD);
  const substitutionAllowed = spec.allowSubstitution && !allLowConfidence;
  if (allLowConfidence) {
    const avg = map.slices.reduce((a, s) => a + s.confidence, 0) / nSlices;
    warnings.push(
      `every slice's role confidence is below ${LOW_CONFIDENCE_THRESHOLD} (avg ${avg.toFixed(2)}) — ` +
        "substitutions are restricted to same-slice tricks (stutter/retrigger only); this pattern will " +
        "never confidently swap in a different slice for a role it isn't sure of.",
    );
  }

  const rng = makeRng((opts.seed * 1000003 + (opts.variant ?? 0) * 7919) >>> 0);
  const events: { step: number; index: number; velocity: number }[] = [];
  const ghostPool = sameRolePool(map, "ghost");

  for (let step = 0; step < totalSteps; step++) {
    const canonicalStep = step % timeline.sourceLen;
    const canonical = timeline.byStep.get(canonicalStep);
    const inStatement = step < statementSteps;

    if (!canonical) {
      if (!inStatement && ghostPool.length > 0 && rng() < spec.ghostShuffleChance) {
        events.push({ step, index: pick(ghostPool, rng).index, velocity: VELOCITY_GHOST });
      }
      continue;
    }

    if (inStatement) {
      events.push({ step, index: canonical.index, velocity: VELOCITY_DEFAULT });
      continue;
    }

    // Snare displacement is decided before the trick roll and excludes it
    // (a displaced snare doesn't also stutter or substitute in place), which
    // keeps one rng draw sequence per step.
    if (canonical.role === "snare" && spec.snareDisplacement.length > 0 && rng() < spec.turnaroundDensity) {
      const delta = pick(spec.snareDisplacement, rng);
      const target = Math.min(Math.max(step + delta, statementSteps), totalSteps - 1);
      events.push({ step: target, index: canonical.index, velocity: VELOCITY_DEFAULT });
      continue;
    }

    const roll = rng();
    if (substitutionAllowed && roll < spec.turnaroundDensity * 0.5) {
      const pool = sameRolePool(map, canonical.role);
      const chosen = pick(pool, rng);
      events.push({ step, index: chosen.index, velocity: VELOCITY_DEFAULT });
    } else if (roll < spec.turnaroundDensity) {
      // stutter: the same canonical slice retriggered at double rate within
      // this one grid step (a 32nd-note repeat).
      events.push({ step, index: canonical.index, velocity: VELOCITY_DEFAULT });
      events.push({ step: step + 0.5, index: canonical.index, velocity: VELOCITY_STUTTER_TAIL });
    } else {
      events.push({ step, index: canonical.index, velocity: VELOCITY_DEFAULT });
    }
  }

  const notes: NoteSpec[] = events.map((e) => ({
    pitch: sliceNote(e.index, opts.mode, nSlices),
    start: e.step * stepBeats,
    duration: stepBeats * GATE,
    velocity: e.velocity,
  }));

  return {
    notes: sortNotes(notes),
    warnings,
    meta: {
      style: spec.name,
      statementBars: String(spec.statementBars),
      sourceGridLen: String(timeline.sourceLen),
      substitutionAllowed: String(substitutionAllowed),
      seed: String(opts.seed),
    },
  };
}

// ---------------------------------------------------------------------------
// Fill grammar (awh breaks fill): a fixed built-in grammar, not
// knowledge-authorable (the CLI has no --style for `fill`; see
// docs/design/break-engine.md). The restraint rule (maxDevices) is a spec
// field per the design, so it's modeled as one even though only one
// built-in value exists.
// ---------------------------------------------------------------------------

export interface BreakFillSpec {
  /** A fill candidate uses at most this many distinct device types
   *  (sourced restraint; see docs/design/break-engine.md's Fill section).
   *  Default 2. */
  maxDevices: number;
}

export const DEFAULT_FILL_SPEC: BreakFillSpec = { maxDevices: 2 };

export type FillDevice = "snare-rush" | "stutter" | "triplet" | "tail-rearrange";
const ALL_DEVICES: readonly FillDevice[] = ["snare-rush", "stutter", "triplet", "tail-rearrange"];

export interface GenerateBreakFillOptions {
  seed: number;
  /** Fill length in beats (design default 2). */
  beats: number;
  /** Number of seeded candidates to generate (drop-respond convention,
   *  same as `awh vary`'s -n). */
  count: number;
  fillSpec?: BreakFillSpec;
}

export interface GeneratedBreakFillCandidate {
  seed: number;
  devicesUsed: FillDevice[];
  notes: NoteSpec[];
  /** "fill <devices> s<seed>": the drop-respond clip-naming convention. */
  name: string;
}

export interface GeneratedBreakFill {
  candidates: GeneratedBreakFillCandidate[];
  warnings: string[];
}

/** Fisher-Yates shuffle driven by a seeded rng. */
function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function ratchetEvents(
  sliceIndex: number,
  startStep: number,
  spanSteps: number,
  subdivision: number,
): { step: number; index: number }[] {
  const out: { step: number; index: number }[] = [];
  const stepFraction = 1 / subdivision;
  for (let s = 0; s < spanSteps; s++) {
    for (let k = 0; k < subdivision; k++) {
      out.push({ step: startStep + s + k * stepFraction, index: sliceIndex });
    }
  }
  return out;
}

/**
 * Generate `opts.count` seeded fill candidates over `map`, each combining
 * at most `fillSpec.maxDevices` distinct device types (the restraint rule,
 * property tested). Zero slices is a state, not an error. Every candidate's
 * notes reference only real slice indices in `map`.
 */
export function generateBreakFill(map: ChopMap, opts: GenerateBreakFillOptions): GeneratedBreakFill {
  const fillSpec = opts.fillSpec ?? DEFAULT_FILL_SPEC;
  const warnings: string[] = [];
  if (map.slices.length === 0) {
    warnings.push("this chop map has zero slices — nothing to build a fill from.");
    return { candidates: [], warnings };
  }

  const grid = map.gridStepsPerBar;
  const stepBeats = map.beatsPerBar / grid;
  const spanSteps = Math.max(1, Math.round(opts.beats / stepBeats));

  const snarePool = sameRolePool(map, "snare");
  const anyNonGhost = map.slices.filter((s) => s.role !== "ghost");
  const fallbackPool = anyNonGhost.length > 0 ? anyNonGhost : map.slices;
  const rushSlice = snarePool.length > 0 ? snarePool[0]! : fallbackPool[0]!;
  const sortedByIndex = [...map.slices].sort((a, b) => a.index - b.index);
  const tailSlices = sortedByIndex.slice(Math.floor(sortedByIndex.length / 2));

  const candidates: GeneratedBreakFillCandidate[] = [];
  for (let i = 0; i < opts.count; i++) {
    const seed = (opts.seed * 1000003 + i * 7919) >>> 0;
    const rng = makeRng(seed);
    const k = 1 + Math.floor(rng() * fillSpec.maxDevices);
    const devicesUsed = shuffled(ALL_DEVICES, rng).slice(0, k).sort();

    // Split the fill's grid steps into one contiguous chunk per device.
    const chunkLen = Math.max(1, Math.floor(spanSteps / devicesUsed.length));
    const events: { step: number; index: number; velocity: number }[] = [];

    devicesUsed.forEach((device, i2) => {
      const chunkStart = i2 * chunkLen;
      const chunkSpan = i2 === devicesUsed.length - 1 ? spanSteps - chunkStart : chunkLen;
      if (chunkSpan <= 0) return;

      if (device === "snare-rush") {
        // Escalating ratchet (2 -> 3 -> 4-way) across the chunk: the
        // classic build-up snare roll. Each ratchet is an equal subdivision
        // of a step, the same mechanic as arp/engine.ts's `ratchets` field,
        // which exports no standalone ratchet utility.
        for (let s = 0; s < chunkSpan; s++) {
          const subdivision = 2 + Math.min(2, s);
          for (const e of ratchetEvents(rushSlice.index, chunkStart + s, 1, subdivision)) {
            events.push({ ...e, velocity: VELOCITY_DEFAULT });
          }
        }
      } else if (device === "stutter") {
        const slice = pick(fallbackPool, rng);
        for (const e of ratchetEvents(slice.index, chunkStart, chunkSpan, 4)) {
          events.push({ ...e, velocity: VELOCITY_STUTTER_TAIL });
        }
      } else if (device === "triplet") {
        const pool = fallbackPool;
        for (let s = 0; s < chunkSpan; s++) {
          for (let t = 0; t < 3; t++) {
            const slice = pool[(s * 3 + t) % pool.length]!;
            events.push({ step: chunkStart + s + t / 3, index: slice.index, velocity: VELOCITY_DEFAULT });
          }
        }
      } else {
        // tail-rearrange: the chop map's own back half, shuffled, laid out
        // one-per-step densely across the chunk.
        const order = shuffled(tailSlices, rng);
        for (let s = 0; s < chunkSpan; s++) {
          const slice = order[s % order.length]!;
          events.push({ step: chunkStart + s, index: slice.index, velocity: VELOCITY_DEFAULT });
        }
      }
    });

    const notes = sortNotes(
      events.map((e) => ({
        pitch: sliceNote(e.index, "drum-rack", map.slices.length),
        start: e.step * stepBeats,
        duration: stepBeats * GATE,
        velocity: e.velocity,
      })),
    );
    candidates.push({
      seed,
      devicesUsed,
      notes,
      name: `fill ${devicesUsed.join(",")} s${seed}`,
    });
  }

  return { candidates, warnings };
}
