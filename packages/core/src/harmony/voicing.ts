import { BridgeError, type NoteSpec } from "../bridge/types.js";
import { sortNotes } from "../transforms/types.js";
import type { ChordSpec } from "./progression.js";

/** A chord placed into actual MIDI register, pitches ascending. */
export interface VoicedChord {
  symbol: string;
  pitches: number[];
}

export interface VoicingOptions {
  /** "close" (default) stacks chord tones tightly near `center`; "spread"
   *  drops the middle voice an octave and sends the root low, widening the
   *  chord. */
  style?: "close" | "spread";
  /** Target register center, MIDI. Default 60 (middle C). */
  center?: number;
  /** Default true: minimize total |semitone| movement from the previous
   *  chord by searching inversions + octave placements within center±12.
   *  false: every chord is voiced root-position, close, at `center`. */
  voiceLeading?: boolean;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function clampVelocity(v: number): number {
  return Math.max(1, Math.min(127, Math.round(v)));
}

/** Nearest pitch with the given pitch class to `center`. */
function nearestPitchForPc(pc: number, center: number): number {
  const octave = Math.round((center - pc) / 12);
  return pc + octave * 12;
}

/**
 * Stack `relativeIntervals` (relative to `basePitch`, first entry 0) into
 * ascending MIDI pitches, each voice placed in the nearest octave strictly
 * above the previous one.
 */
function stackAscending(basePitch: number, relativeIntervals: number[]): number[] {
  const pitches = [basePitch];
  let prev = basePitch;
  for (let i = 1; i < relativeIntervals.length; i++) {
    let candidate = basePitch + relativeIntervals[i]!;
    while (candidate <= prev) candidate += 12;
    pitches.push(candidate);
    prev = candidate;
  }
  return pitches;
}

/** Root-position, close voicing anchored at `center`. */
function rootPositionClose(chord: ChordSpec, center: number): number[] {
  const basePitch = nearestPitchForPc(mod(chord.rootPc, 12), center);
  return stackAscending(basePitch, chord.intervals);
}

/** Re-express `intervals` (relative to the chord root) as pitch-class
 *  offsets (0-11) relative to the voice at rotation index `k`, i.e. the
 *  inversion with that voice as the bass. */
function rotateIntervals(intervals: number[], k: number): number[] {
  const n = intervals.length;
  const base = intervals[k]!;
  const rotated: number[] = [];
  for (let i = 0; i < n; i++) {
    const idx = (k + i) % n;
    let iv = intervals[idx]! - base;
    if (iv < 0) iv += 12;
    rotated.push(iv);
  }
  return rotated;
}

/** Total voice-movement cost vs. the previous chord's pitches (matched by
 *  ascending index; any extra voices are costed against their nearest
 *  previous pitch). */
function voicingCost(candidate: number[], prev: number[]): number {
  const shared = Math.min(candidate.length, prev.length);
  let cost = 0;
  for (let i = 0; i < shared; i++) cost += Math.abs(candidate[i]! - prev[i]!);
  for (let i = shared; i < candidate.length; i++) {
    cost += Math.min(...prev.map((p) => Math.abs(candidate[i]! - p)));
  }
  return cost;
}

/** Search inversions x octave placements within center±12 for the voicing
 *  closest to `prevPitches`. */
function bestVoiceLed(chord: ChordSpec, prevPitches: number[], center: number): number[] {
  const n = chord.intervals.length;
  let best: number[] | undefined;
  let bestCost = Infinity;
  for (let k = 0; k < n; k++) {
    const rotated = rotateIntervals(chord.intervals, k);
    const bassPc = mod(chord.rootPc + chord.intervals[k]!, 12);
    for (let base = center - 12; base <= center + 12; base++) {
      if (mod(base, 12) !== bassPc) continue;
      const candidate = stackAscending(base, rotated);
      const cost = voicingCost(candidate, prevPitches);
      if (cost < bestCost) {
        bestCost = cost;
        best = candidate;
      }
    }
  }
  return best ?? rootPositionClose(chord, center);
}

/** "spread": drop the middle voice an octave, and drop the root an extra
 *  octave so it stays the lowest voice ("root low") while the chord widens.
 *  For n voices the "middle" voice is index floor(n/2). */
function spreadPitches(close: number[]): number[] {
  const n = close.length;
  if (n < 2) return [...close];
  const midIdx = Math.floor(n / 2);
  const dropped = close.map((p, i) => (i === midIdx ? p - 12 : p));
  dropped[0] = dropped[0]! - 12;
  return dropped.sort((a, b) => a - b);
}

/** Voice a chord progression into actual MIDI registers. Deterministic (no
 *  rng involved). */
export function voiceProgression(chords: ChordSpec[], opts: VoicingOptions = {}): VoicedChord[] {
  const style = opts.style ?? "close";
  const center = opts.center ?? 60;
  const voiceLeading = opts.voiceLeading ?? true;

  const out: VoicedChord[] = [];
  let prevPitches: number[] | undefined;

  for (const chord of chords) {
    const closeVoiced =
      voiceLeading && prevPitches ? bestVoiceLed(chord, prevPitches, center) : rootPositionClose(chord, center);
    const pitches = style === "spread" ? spreadPitches(closeVoiced) : [...closeVoiced];
    pitches.sort((a, b) => a - b);
    out.push({ symbol: chord.symbol, pitches });
    // Voice-lead the next chord against this chord's close voicing, not its
    // spread (widened, lower) output. Otherwise each spread pass compounds
    // into the next chord's search target, and the whole progression sinks
    // by nearly an octave after the first transition and stays there.
    // `center` should govern the entire progression, not just chord 1.
    prevPitches = closeVoiced;
  }
  return out;
}

// ---------------------------------------------------------------------------
// render: turn voiced chords into NoteSpecs on a rhythm grid
// ---------------------------------------------------------------------------

export interface RenderChordsOptions {
  /** Total length in bars. Default = voiced.length (one bar per chord). */
  bars?: number;
  beatsPerBar?: number;
  /** "whole" (default): one sustained hit per segment. "half": two hits per
   *  segment. "quarters": a hit every beat (duration 0.9 beat). "offbeat-stabs":
   *  a hit at +0.5 of every beat (duration 0.4, velocity -10). */
  rhythm?: "whole" | "half" | "quarters" | "offbeat-stabs";
  velocity?: number;
  /** 0 (default): no added bass note. N: add the root N octave(s) below the
   *  voicing's lowest pitch, for each N from 1 up to bassOctaves. */
  bassOctaves?: number;
}

interface Hit {
  start: number;
  duration: number;
  velocityDelta: number;
}

/** Rhythm grid is segment-local (relative to each chord's own segStart), so
 *  it stays well-defined even when segments don't land on whole beats (e.g.
 *  a progression that doesn't evenly divide the bar count). */
function segmentHits(segStart: number, segEnd: number, rhythm: NonNullable<RenderChordsOptions["rhythm"]>): Hit[] {
  const segDur = segEnd - segStart;
  const EPS = 1e-9;
  switch (rhythm) {
    case "half": {
      const half = segDur / 2;
      return [
        { start: segStart, duration: half, velocityDelta: 0 },
        { start: segStart + half, duration: half, velocityDelta: 0 },
      ];
    }
    case "quarters": {
      const hits: Hit[] = [];
      for (let pos = segStart; pos < segEnd - EPS; pos += 1) {
        hits.push({ start: pos, duration: 0.9, velocityDelta: 0 });
      }
      return hits;
    }
    case "offbeat-stabs": {
      const hits: Hit[] = [];
      for (let pos = segStart + 0.5; pos < segEnd - EPS; pos += 1) {
        hits.push({ start: pos, duration: 0.4, velocityDelta: -10 });
      }
      return hits;
    }
    case "whole":
    default:
      return [{ start: segStart, duration: segDur, velocityDelta: 0 }];
  }
}

/**
 * Render voiced chords onto a rhythm grid, one equal segment per chord
 * across the total span. Deterministic (no rng involved).
 */
export function renderChords(voiced: VoicedChord[], opts: RenderChordsOptions = {}): NoteSpec[] {
  const beatsPerBar = opts.beatsPerBar ?? 4;
  const bars = opts.bars ?? voiced.length;
  const rhythm = opts.rhythm ?? "whole";
  const velocity = opts.velocity ?? 90;
  const bassOctaves = Math.max(0, Math.floor(opts.bassOctaves ?? 0));

  if (beatsPerBar <= 0) throw new BridgeError("bad_request", "renderChords: beatsPerBar must be > 0");
  if (bars <= 0) throw new BridgeError("bad_request", "renderChords: bars must be > 0");
  if (voiced.length === 0) return [];

  const totalBeats = bars * beatsPerBar;
  const segmentLen = totalBeats / voiced.length;

  const notes: NoteSpec[] = [];
  voiced.forEach((chord, i) => {
    const segStart = i * segmentLen;
    const segEnd = Math.min(segStart + segmentLen, totalBeats);
    if (segEnd - segStart <= 0) return;

    const lowest = Math.min(...chord.pitches);
    const bassNotes: number[] = [];
    for (let o = 1; o <= bassOctaves; o++) bassNotes.push(lowest - 12 * o);
    const pitches = [...bassNotes, ...chord.pitches];

    for (const hit of segmentHits(segStart, segEnd, rhythm)) {
      for (const pitch of pitches) {
        notes.push({
          pitch,
          start: hit.start,
          duration: hit.duration,
          velocity: clampVelocity(velocity + hit.velocityDelta),
        });
      }
    }
  });

  return sortNotes(notes);
}
