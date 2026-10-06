/**
 * Bass808Spec: data-driven 808 bassline styles. These are melodic-rhythmic
 * 808 bassline patterns (long holds, syncopated pickups, slides, triplet
 * flows), not TR-808 drum patterns; those are the trap drum styles in
 * ../drums/styleSpec.ts. Sibling of DrumStyleSpec, PhraseSpec, ArpSpec and
 * BreakSpec: unknown keys are rejected, and defaults let a knowledge entry
 * state only what it changes. Pinned schema and semantics: docs/design/bass-808.md.
 */
import { parse as parseYaml } from "yaml";

export interface Bass808Step {
  /** Beat offset within the bar (0-based; may be any non-negative number,
   *  including a triplet-grid fraction like 1/3). */
  pos: number;
  /** Written length in beats. Overridden for slide steps that find a next
   *  sounding note (see generate808); used as-is otherwise. */
  len: number;
  /** Semitone offset from the fitted root. Must be a member of the spec's
   *  `degrees` validation set (parser-enforced). Not re-folded into
   *  `register`: the register fits the root only. */
  degree: number;
  /** Extends the note to overlap the next sounding note's start by
   *  `slideOverlapBeats` (bar-crossing included). Default false. */
  slide?: boolean;
}

export interface Bass808Cell {
  name: string;
  /** Selection weight (default 1 when omitted in YAML). */
  weight: number;
  steps: Bass808Step[];
}

export interface Bass808Velocity {
  /** 1-127 base velocity. */
  base: number;
  /** Added to `base` for the step at bar-local pos 0. */
  accentFirst: number;
}

export interface Bass808Spec {
  name: string;
  /** Weighted 1-bar cells; one is drawn (seeded, or forced via --variant) per bar. */
  cells: Bass808Cell[];
  /** Allowed semitone offsets from root; every step's `degree` must be one of these. */
  degrees: number[];
  /** MIDI range [lo, hi] the root is octave-fitted into. Default [24, 36] (C1-C2). */
  register: [number, number];
  /** Legato overlap (beats) applied to `slide: true` steps. Default 0.05. */
  slideOverlapBeats: number;
  velocity: Bass808Velocity;
  /** Every Nth bar draws from `turnaroundCells` instead, when non-empty. Default 4. */
  turnaroundBar: number;
  /** Optional; same shape as `cells`. Default []. */
  turnaroundCells: Bass808Cell[];
  /** 0-0.5, even-8th delay fraction applied to the "and" of a beat (same
   *  units as the arp and drum engines' swing). All three built-ins ship 0. */
  swing: number;
}

const TOP_LEVEL_KEYS = new Set([
  "name",
  "cells",
  "degrees",
  "register",
  "slideOverlapBeats",
  "velocity",
  "turnaroundBar",
  "turnaroundCells",
  "swing",
]);
const CELL_KEYS = new Set(["name", "weight", "steps"]);
const STEP_KEYS = new Set(["pos", "len", "degree", "slide"]);
const VELOCITY_KEYS = new Set(["base", "accentFirst"]);

const DEFAULT_REGISTER: [number, number] = [24, 36];
const DEFAULT_SLIDE_OVERLAP_BEATS = 0.05;
const DEFAULT_VELOCITY: Bass808Velocity = { base: 110, accentFirst: 12 };
const DEFAULT_TURNAROUND_BAR = 4;

function fail(message: string): never {
  throw new Error(`bass808 spec: ${message}`);
}

function parseCells(raw: unknown, field: string, degreesSet: Set<number>, requireNonEmpty: boolean): Bass808Cell[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || (requireNonEmpty && raw.length === 0)) {
    fail(`"${field}" must be a non-empty array`);
  }
  return (raw as unknown[]).map((rawCell, i) => {
    if (rawCell === null || typeof rawCell !== "object" || Array.isArray(rawCell)) {
      fail(`${field}[${i}] must be a mapping with "name" and "steps"`);
    }
    const cell = rawCell as Record<string, unknown>;
    for (const key of Object.keys(cell)) {
      if (!CELL_KEYS.has(key)) {
        fail(`${field}[${i}]: unknown field "${key}" (expected one of ${[...CELL_KEYS].join(", ")})`);
      }
    }
    if (typeof cell.name !== "string" || cell.name.trim() === "") {
      fail(`${field}[${i}]: "name" must be a non-empty string`);
    }
    let weight = 1;
    if (cell.weight !== undefined) {
      if (typeof cell.weight !== "number" || Number.isNaN(cell.weight) || cell.weight <= 0) {
        fail(`${field}[${i}] ("${cell.name}"): "weight" must be a positive number`);
      }
      weight = cell.weight;
    }
    if (!Array.isArray(cell.steps) || cell.steps.length === 0) {
      fail(`${field}[${i}] ("${cell.name}"): "steps" must be a non-empty array`);
    }
    const steps = (cell.steps as unknown[]).map((rawStep, j) => {
      if (rawStep === null || typeof rawStep !== "object" || Array.isArray(rawStep)) {
        fail(`${field}[${i}] ("${cell.name}"): steps[${j}] must be a mapping`);
      }
      const step = rawStep as Record<string, unknown>;
      for (const key of Object.keys(step)) {
        if (!STEP_KEYS.has(key)) {
          fail(`${field}[${i}] ("${cell.name}"): steps[${j}]: unknown field "${key}" (expected one of ${[...STEP_KEYS].join(", ")})`);
        }
      }
      if (typeof step.pos !== "number" || Number.isNaN(step.pos) || step.pos < 0) {
        fail(`${field}[${i}] ("${cell.name}"): steps[${j}].pos must be a number >= 0`);
      }
      if (typeof step.len !== "number" || Number.isNaN(step.len) || step.len <= 0) {
        fail(`${field}[${i}] ("${cell.name}"): steps[${j}].len must be a number > 0`);
      }
      if (typeof step.degree !== "number" || Number.isNaN(step.degree)) {
        fail(`${field}[${i}] ("${cell.name}"): steps[${j}].degree must be a number`);
      }
      if (!degreesSet.has(step.degree)) {
        fail(
          `${field}[${i}] ("${cell.name}"): steps[${j}].degree ${step.degree} is not in "degrees" ` +
            `(${[...degreesSet].join(", ")}) — every step degree must be a declared semitone offset`,
        );
      }
      let slide = false;
      if (step.slide !== undefined) {
        if (typeof step.slide !== "boolean") {
          fail(`${field}[${i}] ("${cell.name}"): steps[${j}].slide must be a boolean`);
        }
        slide = step.slide;
      }
      return { pos: step.pos, len: step.len, degree: step.degree, slide };
    });
    return { name: cell.name, weight, steps };
  });
}

function parseDegrees(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    fail(`"degrees" must be a non-empty array of semitone offsets`);
  }
  return (raw as unknown[]).map((d, i) => {
    if (typeof d !== "number" || !Number.isInteger(d)) {
      fail(`degrees[${i}] must be an integer semitone offset (got ${JSON.stringify(d)})`);
    }
    return d;
  });
}

function parseRegister(raw: unknown): [number, number] {
  if (raw === undefined) return [...DEFAULT_REGISTER];
  if (
    !Array.isArray(raw) ||
    raw.length !== 2 ||
    typeof raw[0] !== "number" ||
    typeof raw[1] !== "number" ||
    Number.isNaN(raw[0]) ||
    Number.isNaN(raw[1]) ||
    raw[0] < 0 ||
    raw[1] > 127 ||
    raw[0] > raw[1]
  ) {
    fail(`"register" must be [lo, hi] with 0 <= lo <= hi <= 127 (got ${JSON.stringify(raw)})`);
  }
  return [raw[0], raw[1]];
}

function parseVelocity(raw: unknown): Bass808Velocity {
  if (raw === undefined) return { ...DEFAULT_VELOCITY };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(`"velocity" must be a mapping with "base" and "accentFirst"`);
  }
  const v = raw as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (!VELOCITY_KEYS.has(key)) {
      fail(`velocity: unknown field "${key}" (expected one of ${[...VELOCITY_KEYS].join(", ")})`);
    }
  }
  let base = DEFAULT_VELOCITY.base;
  if (v.base !== undefined) {
    if (typeof v.base !== "number" || v.base < 1 || v.base > 127) {
      fail(`"velocity.base" must be a number in [1, 127] (got ${JSON.stringify(v.base)})`);
    }
    base = v.base;
  }
  let accentFirst = DEFAULT_VELOCITY.accentFirst;
  if (v.accentFirst !== undefined) {
    if (typeof v.accentFirst !== "number" || Number.isNaN(v.accentFirst)) {
      fail(`"velocity.accentFirst" must be a number (got ${JSON.stringify(v.accentFirst)})`);
    }
    accentFirst = v.accentFirst;
  }
  return { base, accentFirst };
}

/**
 * Parse and validate a Bass808Spec from a YAML document. Rejects unknown
 * top-level (and nested) keys so hand-written data catches typos instead of
 * silently ignoring a misspelled field, like parseDrumStyleSpec,
 * parsePhraseSpec, parseArpSpec and parseBreakSpec.
 */
export function parseBass808Spec(yamlText: string): Bass808Spec {
  const doc = parseYaml(yamlText);
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    fail("expected a YAML mapping at the top level");
  }
  const raw = doc as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      fail(`unknown field "${key}" (expected one of ${[...TOP_LEVEL_KEYS].join(", ")})`);
    }
  }

  if (typeof raw.name !== "string" || raw.name.trim() === "") {
    fail(`"name" must be a non-empty string`);
  }

  const degrees = parseDegrees(raw.degrees);
  const degreesSet = new Set(degrees);
  const cells = parseCells(raw.cells, "cells", degreesSet, true);
  const register = parseRegister(raw.register);

  let slideOverlapBeats = DEFAULT_SLIDE_OVERLAP_BEATS;
  if (raw.slideOverlapBeats !== undefined) {
    if (typeof raw.slideOverlapBeats !== "number" || Number.isNaN(raw.slideOverlapBeats) || raw.slideOverlapBeats < 0) {
      fail(`"slideOverlapBeats" must be a non-negative number (got ${JSON.stringify(raw.slideOverlapBeats)})`);
    }
    slideOverlapBeats = raw.slideOverlapBeats;
  }

  const velocity = parseVelocity(raw.velocity);

  let turnaroundBar = DEFAULT_TURNAROUND_BAR;
  if (raw.turnaroundBar !== undefined) {
    if (typeof raw.turnaroundBar !== "number" || !Number.isInteger(raw.turnaroundBar) || raw.turnaroundBar < 1) {
      fail(`"turnaroundBar" must be a positive integer (got ${JSON.stringify(raw.turnaroundBar)})`);
    }
    turnaroundBar = raw.turnaroundBar;
  }

  const turnaroundCells = parseCells(raw.turnaroundCells, "turnaroundCells", degreesSet, false);

  let swing = 0;
  if (raw.swing !== undefined) {
    if (typeof raw.swing !== "number" || Number.isNaN(raw.swing) || raw.swing < 0 || raw.swing > 0.5) {
      fail(`"swing" must be a number in [0, 0.5] (got ${JSON.stringify(raw.swing)})`);
    }
    swing = raw.swing;
  }

  return {
    name: raw.name,
    cells,
    degrees,
    register,
    slideOverlapBeats,
    velocity,
    turnaroundBar,
    turnaroundCells,
    swing,
  };
}

// ---------------------------------------------------------------------------
// Built-ins
// ---------------------------------------------------------------------------
//
// Data grounding (docs/design/bass-808.md): WaivOps HH-TRP full-n mining
// record (library/measurements/waivops-hhtrp-full.json — n=15,000 real trap
// loops, low-band/kick-808-proxy `position_prob` across the 16th grid; see
// also knowledge/rhythm/waivops-drum-stats-pilot.md's HH-TRP section).
// Beat-1 anchoring reads only 49.4% (position 0), far from universal, and
// the off-beat "&" positions are far from rare: position 2 (the "&" of beat
// 1) 18.1%, position 6 (the "&" of beat 2) 24.3%, position 10 (the "&" of
// beat 3) 26.6%, position 14 (the "&" of beat 4) 25.2%. Read together: real
// trap low-end material anchors beat 1 barely more than half the time and
// off-beat placement is common. This grounds `trap-long`'s octave-answer
// cell (the root does not hold through beat 1 alone at full weight) and
// `trap-syncopated`'s off-beat/"and"-heavy cells below. The same record's
// mid-band position-8 hit rate (93.0%) matches the snare-on-3 backbeat the
// trap drum styles assume, a sanity check on the record; this module does
// not use that number.

/** The example spec from docs/design/bass-808.md, verbatim: sparse, long
 *  anchors, one slide pickup per 1-2 bars. */
export const TRAP_LONG_SPEC: Bass808Spec = {
  name: "trap-long",
  cells: [
    {
      name: "anchor-hold",
      weight: 3,
      steps: [
        { pos: 0, len: 2.5, degree: 0, slide: false }, // long root on the 1
        { pos: 3, len: 1.0, degree: 0, slide: true }, // pickup sliding into next bar
      ],
    },
    {
      name: "octave-answer",
      weight: 2,
      steps: [
        { pos: 0, len: 1.5, degree: 0, slide: false },
        { pos: 2, len: 0.75, degree: 12, slide: true },
        { pos: 3, len: 1.0, degree: 0, slide: false },
      ],
    },
  ],
  degrees: [0, 12, 7, -2, 10],
  register: [24, 36],
  slideOverlapBeats: 0.05,
  velocity: { base: 110, accentFirst: 12 },
  turnaroundBar: 4,
  turnaroundCells: [],
  swing: 0,
};

/** Off-beat doubles, "+"-of-3 pickups, more slides than trap-long. Grounded
 *  in the mining record's non-trivial "&" position probabilities above.
 *  Also exercises turnaroundCells (a "fall to root" resolution every 4th
 *  bar), unlike trap-long. */
export const TRAP_SYNCOPATED_SPEC: Bass808Spec = {
  name: "trap-syncopated",
  cells: [
    {
      name: "and-of-3-push",
      weight: 3,
      steps: [
        { pos: 0, len: 1.5, degree: 0, slide: false },
        { pos: 1.5, len: 1.0, degree: 0, slide: false },
        { pos: 2.5, len: 0.5, degree: 0, slide: true }, // "and of 3" pickup
        { pos: 3, len: 1.0, degree: 7, slide: true }, // beat-4 fifth, slides into next bar
      ],
    },
    {
      name: "off-beat-double",
      weight: 3,
      steps: [
        { pos: 0, len: 1.0, degree: 0, slide: false },
        { pos: 1, len: 0.5, degree: 0, slide: false },
        { pos: 1.5, len: 0.5, degree: 0, slide: true }, // off-beat double, slides
        { pos: 2, len: 1.0, degree: 10, slide: false },
        { pos: 3, len: 0.5, degree: 0, slide: false },
        { pos: 3.5, len: 0.5, degree: 0, slide: true }, // "and of 4" pickup
      ],
    },
    {
      name: "sparse-slide-answer",
      weight: 2,
      steps: [
        { pos: 0, len: 2.0, degree: 0, slide: false },
        { pos: 2.5, len: 1.5, degree: 0, slide: true },
      ],
    },
  ],
  degrees: [0, 12, 7, -2, 10],
  register: [24, 36],
  slideOverlapBeats: 0.05,
  velocity: { base: 108, accentFirst: 14 },
  turnaroundBar: 4,
  turnaroundCells: [
    {
      name: "turnaround-fall",
      weight: 1,
      steps: [
        { pos: 0, len: 2.0, degree: 0, slide: false },
        { pos: 2, len: 1.0, degree: -2, slide: false },
        { pos: 3, len: 1.0, degree: 0, slide: true },
      ],
    },
  ],
  swing: 0,
};

/** 8th-triplet run cells (steps land on the exact triplet grid, multiples
 *  of 1/3 beat), denser: the modern trap-flow idiom. */
export const TRIPLET_FLOW_SPEC: Bass808Spec = {
  name: "triplet-flow",
  cells: [
    {
      name: "triplet-run-root",
      weight: 3,
      steps: [
        { pos: 0, len: 1 / 3, degree: 0, slide: false },
        { pos: 1 / 3, len: 1 / 3, degree: 0, slide: false },
        { pos: 2 / 3, len: 1 / 3, degree: 7, slide: false },
        { pos: 1, len: 1 / 3, degree: 0, slide: false },
        { pos: 4 / 3, len: 1 / 3, degree: 0, slide: false },
        { pos: 5 / 3, len: 1 / 3, degree: 12, slide: false },
        { pos: 2, len: 1 / 3, degree: 0, slide: false },
        { pos: 7 / 3, len: 1 / 3, degree: 0, slide: false },
        { pos: 8 / 3, len: 1 / 3, degree: 10, slide: false },
        { pos: 3, len: 1.0, degree: 0, slide: true }, // sustained beat-4 root, slides into next bar
      ],
    },
    {
      name: "triplet-answer",
      weight: 2,
      steps: [
        { pos: 0, len: 2 / 3, degree: 0, slide: false },
        { pos: 2 / 3, len: 1 / 3, degree: 0, slide: false },
        { pos: 1, len: 1.0, degree: 0, slide: false },
        { pos: 2, len: 1 / 3, degree: 7, slide: false },
        { pos: 7 / 3, len: 1 / 3, degree: 0, slide: false },
        { pos: 8 / 3, len: 1 / 3, degree: 10, slide: false },
        { pos: 3, len: 1.0, degree: 0, slide: true },
      ],
    },
  ],
  degrees: [0, 12, 7, -2, 10],
  register: [24, 36],
  slideOverlapBeats: 0.05,
  velocity: { base: 112, accentFirst: 10 },
  turnaroundBar: 4,
  turnaroundCells: [],
  swing: 0,
};

const BASS808_BUILTIN_SPECS: Record<string, Bass808Spec> = {
  "trap-long": TRAP_LONG_SPEC,
  "trap-syncopated": TRAP_SYNCOPATED_SPEC,
  "triplet-flow": TRIPLET_FLOW_SPEC,
};

/** Built-in 808 bass style names. */
export function listBass808Styles(): string[] {
  return Object.keys(BASS808_BUILTIN_SPECS);
}

/** Resolve a built-in style by name, or undefined if it isn't one. */
export function bass808BuiltinSpec(style: string): Bass808Spec | undefined {
  return BASS808_BUILTIN_SPECS[style];
}

/** Named cell variants a spec offers (variant-listable like drums/phrase):
 *  only `cells`, not `turnaroundCells` (turnaround bars always draw
 *  weighted from `turnaroundCells` when present, regardless of --variant). */
export function listBass808Variants(spec: Bass808Spec): string[] {
  return spec.cells.map((c) => c.name);
}
