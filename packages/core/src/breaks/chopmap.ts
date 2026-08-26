/**
 * M15 chop-map types + the pure (no Python, no I/O) adapter from the
 * analyzer's raw JSON (`analysis/awh_analysis/breakchop.py`, snake_case) to
 * a clean core shape, plus the slice -> MIDI note mapping shared by
 * `--mode drum-rack|live-slices` (see docs/design/break-engine.md's
 * "Targeting modes" section). Kept pure and Python-free so the pattern/fill
 * engine tests without a chop actually having been run.
 */

export type ChopRole = "kick" | "snare" | "hat" | "ghost";

export interface ChopMapSlice {
  index: number;
  startS: number;
  endS: number;
  /** Absolute 16th-grid step (not wrapped to a bar) the slice's onset was
   *  measured nearest to. */
  gridStep: number;
  /** Signed measured distance (ms) from that grid step's exact line —
   *  NEVER silently snapped to 0. */
  offsetMs: number;
  role: ChopRole;
  /** 0..1 — how confident the role guess is (see breakchop.py: band-energy
   *  fraction claimed by the winning band, or the ghost margin). */
  confidence: number;
  isGhost: boolean;
}

export interface ChopMap {
  file: string;
  bpm: number;
  bpmConfidence: number;
  gridStepsPerBar: number;
  beatsPerBar: number;
  slices: ChopMapSlice[];
}

function num(v: unknown, field: string): number {
  if (typeof v !== "number" || Number.isNaN(v)) {
    throw new Error(`chop map: "${field}" must be a number (got ${JSON.stringify(v)})`);
  }
  return v;
}

const VALID_ROLES: readonly ChopRole[] = ["kick", "snare", "hat", "ghost"];

/**
 * Adapt the raw JSON `awh breaks chop`/`analysis.awh_analysis.breakchop`
 * produces (snake_case, python-shaped) into a clean, camelCase ChopMap.
 * Pure — no file I/O, no Python — so pattern/fill generation tests work
 * from hand-built fixtures with no analysis engine involved.
 */
export function parseChopMap(raw: unknown): ChopMap {
  if (raw === null || typeof raw !== "object") {
    throw new Error("chop map: expected an object");
  }
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.slices)) {
    throw new Error('chop map: "slices" must be an array');
  }
  const slices: ChopMapSlice[] = r.slices.map((rawSlice, i) => {
    if (rawSlice === null || typeof rawSlice !== "object") {
      throw new Error(`chop map: slices[${i}] must be an object`);
    }
    const s = rawSlice as Record<string, unknown>;
    const role = s.role;
    if (typeof role !== "string" || !VALID_ROLES.includes(role as ChopRole)) {
      throw new Error(
        `chop map: slices[${i}].role must be one of ${VALID_ROLES.join(", ")} (got ${JSON.stringify(role)})`,
      );
    }
    return {
      index: num(s.index, `slices[${i}].index`),
      startS: num(s.start_s, `slices[${i}].start_s`),
      endS: num(s.end_s, `slices[${i}].end_s`),
      gridStep: num(s.grid_step, `slices[${i}].grid_step`),
      offsetMs: num(s.offset_ms, `slices[${i}].offset_ms`),
      role: role as ChopRole,
      confidence: num(s.confidence, `slices[${i}].confidence`),
      isGhost: Boolean(s.is_ghost),
    };
  });
  return {
    file: typeof r.file === "string" ? r.file : "",
    bpm: num(r.bpm, "bpm"),
    bpmConfidence: typeof r.bpm_confidence === "number" ? r.bpm_confidence : 0,
    gridStepsPerBar: typeof r.grid_steps_per_bar === "number" ? r.grid_steps_per_bar : 16,
    beatsPerBar: typeof r.beats_per_bar === "number" ? r.beats_per_bar : 4,
    slices,
  };
}

export type SliceNoteMode = "drum-rack" | "live-slices";

/** First MIDI note of the chromatic slice mapping both modes share — C1 in
 *  Ableton's octave convention (see notation/barbeat.ts), matching the
 *  standard 16-pad Drum Rack layout's first pad AND Live's own
 *  Slice-to-New-MIDI-Track convention (both start here; they differ only in
 *  the pad-count cap — see sliceNote below). */
export const SLICE_NOTE_BASE = 36;

/** A standard Drum Rack page holds 16 pads — drum-rack mode literally
 *  cannot address a slice beyond this without a second rack. */
export const DRUM_RACK_PAD_COUNT = 16;

/**
 * MIDI note for slice `index` under `mode`. `drum-rack` (paired with
 * --export) throws once a chop map has more slices than one rack page can
 * address (never silently wraps two different slices onto the same pad —
 * see docs/design/break-engine.md's "honest Simpler constraint"). `--mode
 * live-slices` has no such cap (Live's own chromatic convention can run as
 * far up as MIDI allows) but the CALLER is responsible for the loud
 * count-mismatch warning against the map's own slice count (see the CLI).
 */
export function sliceNote(index: number, mode: SliceNoteMode, nSlices: number): number {
  if (mode === "drum-rack" && nSlices > DRUM_RACK_PAD_COUNT) {
    throw new Error(
      `drum-rack mode addresses at most ${DRUM_RACK_PAD_COUNT} pads (C1..) — this chop map has ` +
        `${nSlices} slices. Either --export and split the tail across a second rack by hand, or use ` +
        `--mode live-slices (unlimited chromatic range, with its own count-match caveat).`,
    );
  }
  return SLICE_NOTE_BASE + index;
}

/** Reverse of sliceNote: which slice index a MIDI note addresses under
 *  `mode` (both modes share the same C1-up formula) — used by tests to
 *  confirm "every emitted note maps to a real slice". */
export function noteToSliceIndex(note: number): number {
  return note - SLICE_NOTE_BASE;
}
