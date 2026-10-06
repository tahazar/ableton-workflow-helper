import type { NoteSpec } from "../bridge/types.js";
import { sortNotes } from "../transforms/types.js";
import { GHOST, HIT_DURATION, NORMAL, randVelocity } from "./grammars.js";
import { roleOfNote } from "./roles.js";
import type { DrumContext, DrumKit, DrumRole } from "./types.js";

/**
 * Fill/humanize/vary ops on drum patterns. These are transforms: they rework
 * notes already produced (by generateDrumPattern or the user's own clip),
 * never inventing a pitch the kit and input didn't already use. Pure: inputs
 * are never mutated, only copied and reworked.
 */

export interface FillOptions {
  /** "trap" gets a hat-roll + snare-ruff fill; anything else gets a
   *  snare/clap/tom 16th-roll crescendo. Default "house". */
  style?: string;
}

/**
 * Replace the tail of the pattern with a fill built from the kit:
 * - house/techno-style (default): snare (or clap, or tom) 16th-note roll
 *   that crescendos into the final downbeat.
 * - trap: a closed-hat 32nd-note roll plus a snare/clap/tom "ruff" on the
 *   last beat.
 *
 * At density >= 0.7 the whole last bar is replaced; below that, only its
 * second half. If the kit has none of snare/clap/tom (and, for trap, no
 * hats either), there's nothing to build a fill from and the input is
 * returned unchanged.
 */
export function drumFill(
  notes: NoteSpec[],
  kit: DrumKit,
  ctx: DrumContext,
  opts: FillOptions = {},
): NoteSpec[] {
  const style = opts.style ?? "house";
  const clipEnd = ctx.bars * ctx.beatsPerBar;
  const lastBarStart = (ctx.bars - 1) * ctx.beatsPerBar;
  const fillStart = ctx.density >= 0.7 ? lastBarStart : lastBarStart + ctx.beatsPerBar / 2;

  const fillRole: DrumRole | undefined =
    kit.snare !== undefined ? "snare" : kit.clap !== undefined ? "clap" : kit.tom !== undefined ? "tom" : undefined;
  const hasHat = kit["hat-closed"] !== undefined || kit["hat-open"] !== undefined;

  if (fillRole === undefined && !(style === "trap" && hasHat)) {
    return [...notes];
  }

  const kept = notes.filter((n) => n.start < fillStart);
  const fillNotes: NoteSpec[] = [];

  if (style === "trap") {
    if (hasHat) {
      const hatRole: DrumRole = kit["hat-closed"] !== undefined ? "hat-closed" : "hat-open";
      const pitch = kit[hatRole]!;
      let loud = true;
      for (let pos = fillStart; pos < clipEnd; pos += 0.125) {
        fillNotes.push({
          pitch,
          start: pos,
          duration: HIT_DURATION,
          velocity: randVelocity(ctx.rng, loud ? NORMAL : GHOST),
        });
        loud = !loud;
      }
    }
    if (fillRole !== undefined) {
      const pitch = kit[fillRole]!;
      const ruffStart = Math.max(fillStart, clipEnd - 1);
      const ruffOffsets = [0, 0.0625, 0.125, 0.25];
      const ruffVelocities = [55, 65, 80, 115];
      ruffOffsets.forEach((offset, i) => {
        const start = ruffStart + offset;
        if (start < clipEnd) {
          fillNotes.push({ pitch, start, duration: HIT_DURATION, velocity: ruffVelocities[i]! });
        }
      });
    }
  } else if (fillRole !== undefined) {
    const pitch = kit[fillRole]!;
    const positions: number[] = [];
    for (let pos = fillStart; pos < clipEnd; pos += 0.25) positions.push(pos);
    positions.forEach((pos, i) => {
      const t = positions.length > 1 ? i / (positions.length - 1) : 1;
      const velocity = Math.round(60 + t * (115 - 60));
      fillNotes.push({ pitch, start: pos, duration: HIT_DURATION, velocity });
    });
  }

  return sortNotes([...kept, ...fillNotes]);
}

// ---------------------------------------------------------------------------
// humanize
// ---------------------------------------------------------------------------

export interface HumanizeDrumsOptions {
  /** Max timing jitter in beats, default 0.02. Scaled per role (see below). */
  timing?: number;
  /** Max velocity jitter, default 8. */
  velocity?: number;
}

/** Fraction of `timing` applied per role: kick stays tight, hats/perc/shaker
 *  swing freely, snare/clap (and anything unrecognized) sit in between. */
function timingFactor(role: DrumRole | undefined): number {
  if (role === "kick") return 0.25;
  if (role === "snare" || role === "clap") return 0.6;
  if (role === undefined) return 0.6;
  return 1; // hat-closed, hat-open, ride, crash, tom, shaker, perc
}

/**
 * Role-aware timing/velocity jitter: kick stays tight (25% of `timing`),
 * snare/clap move a bit more (60%), hats/shaker/perc move freely (100%);
 * notes whose role can't be resolved from the kit get 60%. Velocity jitter
 * is uniform across roles. Notes never move before 0 or past the clip end.
 */
export function humanizeDrums(
  notes: NoteSpec[],
  kit: DrumKit,
  ctx: DrumContext,
  opts: HumanizeDrumsOptions = {},
): NoteSpec[] {
  const timing = opts.timing ?? 0.02;
  const velocity = opts.velocity ?? 8;
  const clipEnd = ctx.bars * ctx.beatsPerBar;

  return sortNotes(
    notes.map((n): NoteSpec => {
      const role = roleOfNote(kit, n.pitch);
      const jitterAmount = timing * timingFactor(role);
      const jitteredStart = n.start + (ctx.rng() * 2 - 1) * jitterAmount;
      const start = Math.max(0, Math.min(jitteredStart, clipEnd - 1e-6));
      const jitteredVelocity = (n.velocity ?? 100) + Math.round((ctx.rng() * 2 - 1) * velocity);
      return {
        ...n,
        start,
        velocity: Math.max(1, Math.min(127, jitteredVelocity)),
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// vary
// ---------------------------------------------------------------------------

export interface VaryDrumsOptions {
  /** 0..1, default 0.5. Higher = more rework. */
  amount?: number;
}

function clampBeat(value: number, clipEnd: number): number {
  return Math.max(0, Math.min(value, clipEnd - 1e-6));
}

function isOnBeat(value: number): boolean {
  return Math.abs(value - Math.round(value)) < 1e-6;
}

function isOnEighth(value: number): boolean {
  const steps = value / 0.5;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

/** Generic fallback for roles with no bespoke rule: drop or nudge slightly. */
function dropOrNudge(n: NoteSpec, rng: () => number, chance: number, clipEnd: number): NoteSpec | undefined {
  if (rng() >= chance) return n;
  if (rng() < 0.5) return undefined; // drop
  return { ...n, start: clampBeat(n.start + (rng() * 2 - 1) * 0.05, clipEnd) };
}

function varyKick(roleNotes: NoteSpec[], amount: number, rng: () => number, clipEnd: number): NoteSpec[] {
  const out: NoteSpec[] = [];
  for (const n of roleNotes) {
    if (isOnBeat(n.start)) {
      out.push(n);
      continue;
    }
    if (rng() < amount * 0.4) continue; // drop the off-grid kick
    const nudged = n.start + (rng() * 2 - 1) * 0.25;
    const snapped = Math.round(nudged / 0.25) * 0.25; // to a neighbouring 16th
    out.push({ ...n, start: clampBeat(snapped, clipEnd) });
  }
  return out;
}

function varyBackbeat(
  roleNotes: NoteSpec[],
  pitch: number,
  amount: number,
  rng: () => number,
  clipEnd: number,
): NoteSpec[] {
  const out: NoteSpec[] = [];
  for (const n of roleNotes) {
    if (isOnBeat(n.start)) {
      out.push(n); // beat 2/4 (or beat 3) hits are the backbone; keep them
      continue;
    }
    const kept = dropOrNudge(n, rng, amount * 0.3, clipEnd);
    if (kept) out.push(kept);
  }

  if (amount >= 0.4) {
    const occupied = new Set(out.map((n) => Math.round(n.start * 1000)));
    for (let pos = 0; pos < clipEnd; pos += 0.25) {
      if (isOnBeat(pos)) continue;
      const key = Math.round(pos * 1000);
      if (occupied.has(key)) continue;
      if (rng() < 0.15 * amount) {
        out.push({ pitch, start: pos, duration: HIT_DURATION, velocity: randVelocity(rng, GHOST), probability: 0.5 });
        occupied.add(key);
      }
    }
  }

  return out;
}

function varyHats(roleNotes: NoteSpec[], pitch: number, amount: number, rng: () => number, clipEnd: number): NoteSpec[] {
  const out: NoteSpec[] = [];
  for (const n of roleNotes) {
    const onEighth = isOnEighth(n.start);
    if (!onEighth && rng() < amount * 0.5) continue; // thin out off-16ths
    out.push({ ...n, velocity: randVelocity(rng, onEighth ? NORMAL : GHOST) });
  }

  const occupied = new Set(out.map((n) => Math.round(n.start * 1000)));
  for (let pos = 0; pos < clipEnd; pos += 0.25) {
    if (isOnEighth(pos)) continue; // only add on the "off" 16ths
    const key = Math.round(pos * 1000);
    if (occupied.has(key)) continue;
    if (rng() < 0.2 * amount) {
      out.push({ pitch, start: pos, duration: HIT_DURATION, velocity: randVelocity(rng, GHOST) });
      occupied.add(key);
    }
  }

  return out;
}

/**
 * Per-role rework of an existing pattern:
 * - kick: on-beat hits are kept as the backbone; off-grid kicks move to a
 *   neighbouring 16th or drop (probability amount*0.4).
 * - snare/clap: on-beat backbeat hits are kept; ghost snares/claps may be
 *   added on 16th positions once amount >= 0.4.
 * - hats: velocities are re-rolled; off-16th hats are thinned/added
 *   proportional to amount.
 * - everything else (ride, crash, tom, shaker, perc, unmapped pitches):
 *   dropped or nudged with probability amount*0.3.
 *
 * A role present in the input is always still present in the output (never
 * fully erased), and no pitch appears that wasn't already in the input.
 */
export function varyDrums(
  notes: NoteSpec[],
  kit: DrumKit,
  ctx: DrumContext,
  opts: VaryDrumsOptions = {},
): NoteSpec[] {
  const amount = Math.max(0, Math.min(1, opts.amount ?? 0.5));
  const clipEnd = ctx.bars * ctx.beatsPerBar;
  const rng = ctx.rng;

  const byRole = new Map<DrumRole, NoteSpec[]>();
  const unmapped: NoteSpec[] = [];
  for (const n of notes) {
    const role = roleOfNote(kit, n.pitch);
    if (role === undefined) {
      unmapped.push(n);
      continue;
    }
    const bucket = byRole.get(role);
    if (bucket) bucket.push(n);
    else byRole.set(role, [n]);
  }

  const result: NoteSpec[] = [];

  for (const [role, roleNotes] of byRole) {
    const pitch = kit[role]!;
    let varied: NoteSpec[];
    if (role === "kick") {
      varied = varyKick(roleNotes, amount, rng, clipEnd);
    } else if (role === "snare" || role === "clap") {
      varied = varyBackbeat(roleNotes, pitch, amount, rng, clipEnd);
    } else if (role === "hat-closed" || role === "hat-open") {
      varied = varyHats(roleNotes, pitch, amount, rng, clipEnd);
    } else {
      varied = roleNotes.reduce<NoteSpec[]>((acc, n) => {
        const kept = dropOrNudge(n, rng, amount * 0.3, clipEnd);
        if (kept) acc.push(kept);
        return acc;
      }, []);
    }
    // never erase a role entirely; keep the original hits instead
    result.push(...(varied.length > 0 ? varied : roleNotes));
  }

  for (const n of unmapped) {
    const kept = dropOrNudge(n, rng, amount * 0.3, clipEnd);
    if (kept) result.push(kept);
  }

  return sortNotes(result);
}
