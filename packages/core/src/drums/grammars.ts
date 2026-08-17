import type { NoteSpec } from "../bridge/types.js";
import { sortNotes } from "../transforms/types.js";
import type { DrumContext, DrumKit, DrumRole } from "./types.js";
import type { TrapFamilyStyleSpec, TrapHatBaseName } from "./styleSpec.js";

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
// trap (half-time) — pattern-CELL model
//
// A real trap groove locks its kick figure and rides it; only the top end
// breathes. So the kick pattern is a seeded choice from a curated table of
// COMMON variations (cells), held for the whole loop, while per-bar rng only
// touches velocities, roll events, ghosts, and turnaround-bar fills.
// ---------------------------------------------------------------------------

export interface TrapKickCell {
  name: string;
  /** 0-based beat offsets within a 4/4 bar; comments give 1-based beats. */
  offsets: number[];
}

/** Curated common trap kick figures (beat 1 always anchors). */
export const TRAP_KICK_CELLS: TrapKickCell[] = [
  { name: "hold", offsets: [0, 3.25] }, // 1, 4.25 — boom … ba into the loop
  { name: "double-tap", offsets: [0, 0.75, 3.5] }, // 1, 1.75, 4.5
  { name: "late-lean", offsets: [0, 1.5, 2.75] }, // 1, 2.5, 3.75
  { name: "rolling", offsets: [0, 0.75, 2.5, 3.25] }, // 1, 1.75, 3.5, 4.25
  { name: "sparse", offsets: [0, 2.5] }, // 1, 3.5
  { name: "syncopated", offsets: [0, 1.5, 3, 3.5] }, // 1, 2.5, 4, 4.5
];

const TRAP_HAT_BASES = ["straight-8ths", "16th-run", "swung-16ths"] as const;

/**
 * Weight of each hat base at a given density, in the ORIGINAL (fixed, all-
 * three-bases) proportions: {0.4, 0.35, 0.25} once dense, {0.7, 0.3, 0} when
 * sparse (swung-16ths never appears at low density). pickHatBase renormalizes
 * these over whichever bases a spec allows, so a spec listing all three in
 * this order reproduces the exact original draw.
 */
const HAT_BASE_WEIGHT: Record<TrapHatBaseName, (density: number) => number> = {
  "straight-8ths": (density) => (density >= 0.5 ? 0.4 : 0.7),
  "16th-run": (density) => (density >= 0.5 ? 0.35 : 0.3),
  "swung-16ths": (density) => (density >= 0.5 ? 0.25 : 0),
};

/**
 * Draw ONE rng() value and pick a hat base from `allowed` (a subset of
 * TRAP_HAT_BASES, in canonical order), weighted per HAT_BASE_WEIGHT and
 * renormalized to the allowed subset. A single allowed base is always picked
 * regardless of the draw (still consumes the rng() call, for draw-order
 * stability).
 */
function pickHatBase(
  rng: () => number,
  density: number,
  allowed: readonly TrapHatBaseName[],
): TrapHatBaseName {
  const draw = rng();
  const candidates = TRAP_HAT_BASES.filter((base) => allowed.includes(base));
  const weights = candidates.map((base) => HAT_BASE_WEIGHT[base](density));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let cumulative = 0;
  for (let i = 0; i < candidates.length; i++) {
    cumulative += weights[i]!;
    if (i === candidates.length - 1 || draw < cumulative / total) return candidates[i]!;
  }
  return candidates[candidates.length - 1]!;
}

/**
 * Build a StyleFactory for a trap-family StyleSpec (data-driven B4 mechanism).
 * The built-in "trap" style is just trapFamilyPlan(TRAP_STYLE_SPEC) — see
 * below — so new trap-family grooves can be authored as spec DATA instead of
 * code, through the exact same generator path.
 */
function trapFamilyPlan(spec: TrapFamilyStyleSpec): StyleFactory {
  const cells = spec.kickCells;
  const allowedHatBases = spec.hatBases ?? TRAP_HAT_BASES;
  const snareBeat1Based = spec.snareBeat ?? 3;
  const clapWithSnare = spec.clapWithSnare ?? true;
  const rollDensityMult = spec.rollDensity ?? 1;
  const openHatChanceVal = spec.openHatChance ?? 0.5;
  const swingDelay = spec.swingDelay ?? 0.06;

  return (kit, beatsPerBar, density, rng, variant) => {
    // --- groove-level choices: drawn ONCE, held for the whole loop ---------
    const cell =
      cells[
        variant !== undefined
          ? ((variant % cells.length) + cells.length) % cells.length
          : Math.floor(rng() * cells.length)
      ]!;
    const kickOffsets = cell.offsets.filter((pos) => pos < beatsPerBar);

    const hatBase = pickHatBase(rng, density, allowedHatBases);

    const bar = (barCtx: { rng: () => number; turnaround: boolean }): NoteSpec[] => {
      const { rng: breath, turnaround } = barCtx;
      const notes: NoteSpec[] = [];

      // kick: the cell, placement LOCKED — only velocities breathe
      for (const pos of kickOffsets) {
        addHit(notes, kit, "kick", pos, randVelocity(breath, pos === 0 ? ACCENT : NORMAL));
      }
      // turnaround bars may sneak a ghost kick on the final 16th
      if (turnaround && breath() < 0.6) {
        addHit(notes, kit, "kick", beatsPerBar - 0.25, randVelocity(breath, GHOST), 0.8);
      }

      // snare (and, unless disabled, clap) on the half-time backbeat
      const snareBeat = Math.min(snareBeat1Based - 1, beatsPerBar - 1);
      addHit(notes, kit, "snare", snareBeat, randVelocity(breath, ACCENT));
      if (clapWithSnare) {
        addHit(notes, kit, "clap", snareBeat, randVelocity(breath, ACCENT));
      }

      // hats: the held base pattern, with per-bar roll EVENTS substituted in —
      // 0-1 on ordinary bars, always one on the LAST beat of turnaround bars
      if (kit["hat-closed"] !== undefined || kit["hat-open"] !== undefined) {
        const eventBeats = new Set<number>();
        if (turnaround) eventBeats.add(beatsPerBar - 1);
        if (breath() < (turnaround ? 0.3 : 0.5) * rollDensityMult) {
          eventBeats.add(Math.floor(breath() * beatsPerBar));
        }

        let loud = true;
        for (let b = 0; b < beatsPerBar; b++) {
          if (eventBeats.has(b)) {
            const roll = breath();
            const offsets =
              roll < 0.34
                ? [0, 0.25, 0.5, 0.75] // 16th roll
                : roll < 0.67
                  ? [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875] // 32nd roll
                  : [0, 1 / 3, 2 / 3]; // triplet fill
            for (const offset of offsets) {
              addHit(notes, kit, "hat-closed", b + offset, randVelocity(breath, loud ? ACCENT : GHOST));
              loud = !loud;
            }
          } else if (hatBase === "straight-8ths") {
            addHit(notes, kit, "hat-closed", b, randVelocity(breath, loud ? NORMAL : HAT_OFF16));
            loud = !loud;
            addHit(notes, kit, "hat-closed", b + 0.5, randVelocity(breath, loud ? NORMAL : HAT_OFF16));
            loud = !loud;
          } else {
            // 16th bases: on-8ths normal, off-16ths soft (swung base delays them)
            for (let pos = 0; pos < 1; pos += 0.25) {
              const off16 = !isNearGrid(pos, 0.5);
              const swing = off16 && hatBase === "swung-16ths" ? swingDelay : 0;
              addHit(
                notes,
                kit,
                "hat-closed",
                b + pos + swing,
                randVelocity(breath, off16 ? HAT_OFF16 : NORMAL),
              );
            }
          }
        }

        // open hat at the bar end — likelier going into the next phrase
        const openChance = turnaround ? 0.7 : density >= 0.4 ? openHatChanceVal : 0;
        if (kit["hat-open"] !== undefined && openChance > 0 && breath() < openChance) {
          addHit(notes, kit, "hat-open", beatsPerBar - 0.5, randVelocity(breath, NORMAL));
        }
      }

      return notes;
    };

    return { meta: { kickCell: cell.name, hatBase }, bar };
  };
}

/** The built-in "trap" style, expressed as data through the same B4 path. */
export const TRAP_STYLE_SPEC: TrapFamilyStyleSpec = {
  name: "trap",
  family: "trap",
  snareBeat: 3,
  clapWithSnare: true,
  kickCells: TRAP_KICK_CELLS,
  hatBases: [...TRAP_HAT_BASES],
  rollDensity: 1,
  openHatChance: 0.5,
  swingDelay: 0.06,
};

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * A prepared style: groove-level choices (pattern cells, hat base, …) are
 * already drawn and HELD; bar() emits one bar, drawing only the breathing
 * layer (velocities, ghosts, roll events) from the passed rng.
 */
interface StylePlan {
  /** Human-readable groove choices, e.g. { kickCell: "late-lean" }. */
  meta: Record<string, string>;
  bar(barCtx: { rng: () => number; turnaround: boolean }): NoteSpec[];
}

type StyleFactory = (
  kit: DrumKit,
  beatsPerBar: number,
  density: number,
  rng: () => number,
  variant?: number,
) => StylePlan;

/** Wrap a stateless per-bar generator (no groove-level choices) as a plan. */
function perBarStyle(
  generator: (kit: DrumKit, beatsPerBar: number, density: number, rng: () => number) => NoteSpec[],
): StyleFactory {
  return (kit, beatsPerBar, density, _rng) => ({
    meta: {},
    bar: ({ rng }) => generator(kit, beatsPerBar, density, rng),
  });
}

const STYLE_FACTORIES: Record<string, StyleFactory> = {
  house: perBarStyle(houseBar),
  techno: perBarStyle(technoBar),
  trap: trapFamilyPlan(TRAP_STYLE_SPEC),
};

export function listDrumStyles(): string[] {
  return Object.keys(STYLE_FACTORIES);
}

/**
 * Named groove variants a style offers (empty = seed-only variation). Pass a
 * `spec` to list a data-driven StyleSpec's own kick-cell names instead of
 * looking `style` up in the built-in table.
 */
export function listDrumVariants(style: string, spec?: TrapFamilyStyleSpec): string[] {
  if (spec) return spec.kickCells.map((c) => c.name);
  return style === "trap" ? TRAP_KICK_CELLS.map((c) => c.name) : [];
}

export interface GeneratePatternOptions {
  /** Force a specific groove variant (index into listDrumVariants). */
  variant?: number;
  /** Data-driven trap-family spec (B4). When set, used regardless of `style`,
   * which becomes just a display label. */
  styleSpec?: TrapFamilyStyleSpec;
}

export interface GeneratedPattern {
  notes: NoteSpec[];
  /** Groove-level choices made (or forced), e.g. { kickCell: "hold" }. */
  meta: Record<string, string>;
}

/**
 * Generate a full drum pattern spanning ctx.bars bars. Groove-level choices
 * (e.g. trap's kick cell) are drawn once from ctx.rng and held for the whole
 * loop; each bar then draws only its breathing layer (velocities, ghosts,
 * roll events) so the loop repeats like a played groove without being a
 * copy-paste. Every 4th bar — and the final bar — is a "turnaround" that may
 * carry a fill gesture. Deterministic: same kit + ctx (incl. rng) => byte-
 * identical notes.
 */
export function generateDrumPatternDetailed(
  style: string,
  kit: DrumKit,
  ctx: DrumContext,
  opts: GeneratePatternOptions = {},
): GeneratedPattern {
  const factory = opts.styleSpec ? trapFamilyPlan(opts.styleSpec) : STYLE_FACTORIES[style];
  if (!factory) {
    throw new Error(
      `unknown drum style "${style}" (available: ${listDrumStyles().join(", ")})`,
    );
  }

  const plan = factory(kit, ctx.beatsPerBar, ctx.density, ctx.rng, opts.variant);
  const notes: NoteSpec[] = [];
  for (let bar = 0; bar < ctx.bars; bar++) {
    const barOffset = bar * ctx.beatsPerBar;
    const turnaround = (bar + 1) % 4 === 0 || bar === ctx.bars - 1;
    for (const note of plan.bar({ rng: ctx.rng, turnaround })) {
      notes.push({ ...note, start: note.start + barOffset });
    }
  }

  return { notes: sortNotes(notes), meta: plan.meta };
}

export function generateDrumPattern(
  style: string,
  kit: DrumKit,
  ctx: DrumContext,
  opts: GeneratePatternOptions = {},
): NoteSpec[] {
  return generateDrumPatternDetailed(style, kit, ctx, opts).notes;
}
