import type { NoteSpec } from "../bridge/types.js";
import { sortNotes } from "../transforms/types.js";
import type { DrumContext, DrumKit, DrumRole } from "./types.js";

/**
 * Style grammars: deterministic drum-pattern generators. Each style builds a
 * single bar (relative to beat 0) from kit + density + rng, and
 * generateDrumPattern tiles that bar across ctx.bars, re-drawing the
 * optional/ghost elements from ctx.rng on every bar so the loop isn't a
 * literal copy-paste but stays reproducible for a given seed.
 *
 * All hits are SHORT (0.25 beats) — drum racks don't need note-off timing to
 * read musically, and short notes never bleed into the next hit.
 */

export const HIT_DURATION = 0.25;

// Velocity bands, roughly matching the design brief. Exported so fills.ts
// (which builds its own hits over generated patterns) can match the same feel.
export type VelRange = readonly [number, number];
export const ACCENT: VelRange = [100, 112];
export const NORMAL: VelRange = [85, 95];
export const GHOST: VelRange = [40, 65];
export const HAT_OFF16: VelRange = [70, 82];

export function randVelocity(rng: () => number, [min, max]: VelRange): number {
  return Math.round(min + rng() * (max - min));
}

/** Push a hit for `role` if the kit has a pad for it; no-op otherwise. */
function addHit(
  notes: NoteSpec[],
  kit: DrumKit,
  role: DrumRole,
  start: number,
  velocity: number,
  probability?: number,
): void {
  const pitch = kit[role];
  if (pitch === undefined) return;
  const note: NoteSpec = { pitch, start, duration: HIT_DURATION, velocity };
  if (probability !== undefined) note.probability = probability;
  notes.push(note);
}

export function isNearGrid(value: number, grid: number): boolean {
  const steps = value / grid;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

// ---------------------------------------------------------------------------
// house
// ---------------------------------------------------------------------------

function houseBar(
  kit: DrumKit,
  beatsPerBar: number,
  density: number,
  rng: () => number,
): NoteSpec[] {
  const notes: NoteSpec[] = [];

  for (let b = 0; b < beatsPerBar; b++) {
    // four-on-the-floor kick, accented
    addHit(notes, kit, "kick", b, randVelocity(rng, ACCENT));

    // clap and/or snare on the backbeats (2 & 4 -> odd 0-based indices)
    if (b % 2 === 1) {
      addHit(notes, kit, "clap", b, randVelocity(rng, NORMAL));
      addHit(notes, kit, "snare", b, randVelocity(rng, NORMAL));
    }

    // open hat on every offbeat
    addHit(notes, kit, "hat-open", b + 0.5, randVelocity(rng, NORMAL));
  }

  // closed hats: 8ths below density 0.5, 16ths at/above it
  if (density < 0.5) {
    for (let pos = 0; pos < beatsPerBar; pos += 0.5) {
      addHit(notes, kit, "hat-closed", pos, randVelocity(rng, NORMAL));
    }
  } else {
    for (let pos = 0; pos < beatsPerBar; pos += 0.25) {
      const onEighth = isNearGrid(pos, 0.5);
      addHit(notes, kit, "hat-closed", pos, randVelocity(rng, onEighth ? NORMAL : HAT_OFF16));
    }
  }

  // low-probability perc/shaker ghosts scattered on 16th positions
  if (density > 0.3) {
    const ghostRole: DrumRole | undefined =
      kit.perc !== undefined ? "perc" : kit.shaker !== undefined ? "shaker" : undefined;
    if (ghostRole !== undefined) {
      for (let pos = 0; pos < beatsPerBar; pos += 0.25) {
        if (rng() < 0.15 * density) {
          addHit(notes, kit, ghostRole, pos, randVelocity(rng, GHOST), 0.3 + rng() * 0.3);
        }
      }
    }
  }

  return notes;
}

// ---------------------------------------------------------------------------
// techno
// ---------------------------------------------------------------------------

function technoBar(
  kit: DrumKit,
  beatsPerBar: number,
  density: number,
  rng: () => number,
): NoteSpec[] {
  const notes: NoteSpec[] = [];

  for (let b = 0; b < beatsPerBar; b++) {
    addHit(notes, kit, "kick", b, randVelocity(rng, ACCENT));
  }

  // closed hat: 16ths only once busy, otherwise sparse offbeat 8ths
  if (density >= 0.6) {
    for (let pos = 0; pos < beatsPerBar; pos += 0.25) {
      addHit(notes, kit, "hat-closed", pos, randVelocity(rng, NORMAL));
    }
  } else {
    for (let b = 0; b < beatsPerBar; b++) {
      addHit(notes, kit, "hat-closed", b + 0.5, randVelocity(rng, NORMAL));
    }
  }

  // ride 8ths once there's room for it
  if (density >= 0.5) {
    for (let pos = 0; pos < beatsPerBar; pos += 0.5) {
      addHit(notes, kit, "ride", pos, randVelocity(rng, NORMAL));
    }
  }

  // clap on the backbeats, but only once the pattern is dense enough to want it
  if (density >= 0.4) {
    for (let b = 0; b < beatsPerBar; b++) {
      if (b % 2 === 1) addHit(notes, kit, "clap", b, randVelocity(rng, NORMAL));
    }
  }

  // ghost "rumble" kicks on late 16ths, placement drawn from rng
  if (density >= 0.5) {
    for (let b = 0; b < beatsPerBar; b++) {
      if (rng() < 0.5) {
        addHit(notes, kit, "kick", b + 0.75, 45, 0.4);
      }
    }
  }

  // optional open hat offbeats
  if (density >= 0.3) {
    for (let b = 0; b < beatsPerBar; b++) {
      if (rng() < 0.3) {
        addHit(notes, kit, "hat-open", b + 0.5, randVelocity(rng, NORMAL));
      }
    }
  }

  return notes;
}

// ---------------------------------------------------------------------------
// trap (half-time)
// ---------------------------------------------------------------------------

// 1-based beat positions from the design brief, converted to 0-based offsets
// within a 4-beat bar: [1.75, 2.5, 3.75, 4, 4.25, 4.5] -> subtract 1.
const TRAP_KICK_POOL = [0.75, 1.5, 2.75, 3, 3.25, 3.5];

function shuffleSeeded<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function trapBar(
  kit: DrumKit,
  beatsPerBar: number,
  density: number,
  rng: () => number,
): NoteSpec[] {
  const notes: NoteSpec[] = [];

  // kick: beat 1 always, plus 2-4 extra syncopated hits from the trap pool
  addHit(notes, kit, "kick", 0, randVelocity(rng, ACCENT));
  const pool = shuffleSeeded(
    TRAP_KICK_POOL.filter((pos) => pos < beatsPerBar),
    rng,
  );
  const extraCount = Math.min(pool.length, 2 + Math.floor(rng() * 3)); // 2..4
  for (const pos of pool.slice(0, extraCount)) {
    addHit(notes, kit, "kick", pos, randVelocity(rng, NORMAL));
  }

  // snare/clap on beat 3 only (half-time backbeat)
  const snareBeat = Math.min(2, beatsPerBar - 1);
  addHit(notes, kit, "snare", snareBeat, randVelocity(rng, ACCENT));
  addHit(notes, kit, "clap", snareBeat, randVelocity(rng, ACCENT));

  // hats: straight 8ths base, with 1-2 bars-worth of "events" (16th/32nd
  // rolls or a triplet fill) substituted in, velocities alternating loud/soft
  if (kit["hat-closed"] !== undefined || kit["hat-open"] !== undefined) {
    const eventBeatCount = Math.min(beatsPerBar, rng() < 0.5 ? 1 : 2);
    const eventBeats = new Set<number>();
    while (eventBeats.size < eventBeatCount) {
      eventBeats.add(Math.floor(rng() * beatsPerBar));
    }

    let loud = true;
    for (let b = 0; b < beatsPerBar; b++) {
      if (eventBeats.has(b)) {
        const roll = rng();
        const offsets =
          roll < 0.34
            ? [0, 0.25, 0.5, 0.75] // 16th roll
            : roll < 0.67
              ? [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875] // 32nd roll
              : [0, 1 / 3, 2 / 3]; // triplet fill
        for (const offset of offsets) {
          addHit(notes, kit, "hat-closed", b + offset, randVelocity(rng, loud ? ACCENT : GHOST));
          loud = !loud;
        }
      } else {
        addHit(notes, kit, "hat-closed", b, randVelocity(rng, loud ? NORMAL : HAT_OFF16));
        loud = !loud;
        addHit(notes, kit, "hat-closed", b + 0.5, randVelocity(rng, loud ? NORMAL : HAT_OFF16));
        loud = !loud;
      }
    }

    // occasional open hat at the bar end
    if (density >= 0.4 && kit["hat-open"] !== undefined && rng() < 0.5) {
      addHit(notes, kit, "hat-open", beatsPerBar - 0.5, randVelocity(rng, NORMAL));
    }
  }

  return notes;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

type StyleGenerator = (
  kit: DrumKit,
  beatsPerBar: number,
  density: number,
  rng: () => number,
) => NoteSpec[];

const STYLE_GENERATORS: Record<string, StyleGenerator> = {
  house: houseBar,
  techno: technoBar,
  trap: trapBar,
};

export function listDrumStyles(): string[] {
  return Object.keys(STYLE_GENERATORS);
}

/**
 * Generate a full drum pattern spanning ctx.bars bars. Each bar is drawn
 * fresh from the style grammar (same core, per-bar rng-varied optional
 * elements), so the loop feels alive without breaking determinism: the same
 * kit + ctx (including rng) always reproduces byte-identical notes.
 */
export function generateDrumPattern(style: string, kit: DrumKit, ctx: DrumContext): NoteSpec[] {
  const generator = STYLE_GENERATORS[style];
  if (!generator) {
    throw new Error(
      `unknown drum style "${style}" (available: ${listDrumStyles().join(", ")})`,
    );
  }

  const notes: NoteSpec[] = [];
  for (let bar = 0; bar < ctx.bars; bar++) {
    const barOffset = bar * ctx.beatsPerBar;
    const barNotes = generator(kit, ctx.beatsPerBar, ctx.density, ctx.rng);
    for (const note of barNotes) {
      notes.push({ ...note, start: note.start + barOffset });
    }
  }

  return sortNotes(notes);
}
