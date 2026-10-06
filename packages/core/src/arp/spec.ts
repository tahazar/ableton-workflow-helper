/**
 * ArpSpec: data-driven arp and rhythm styles, following the same data-driven
 * spec pattern as drums/styleSpec.ts and phrase/spec.ts: unknown keys are
 * rejected, and defaults let a knowledge entry state only what it changes. Pinned schema and
 * semantics: docs/design/arp-engine.md.
 */
import { parse as parseYaml } from "yaml";

export type ArpContour =
  | "up"
  | "down"
  | "updown"
  | "downup"
  | "converge"
  | "diverge"
  | "walk"
  | "as-voiced";

export type VelocityShape = "none" | "ramp-up" | "ramp-down";

export interface ArpVelocitySpec {
  /** 1-127 base velocity. */
  base: number;
  /** Pattern positions (0-based, mod patternLength) boosted by accentBoost. */
  accentSteps: number[];
  /** Added to base velocity at accentSteps. */
  accentBoost: number;
  /** Linear ramp across the pattern, +-accentBoost/2 at the ends. Default none. */
  shape: VelocityShape;
}

export interface ArpEuclidSpec {
  /** Onsets per n steps. k=0 is rejected at parse time (see parseArpSpec). */
  k: number;
  /** Steps in the euclidean cycle. */
  n: number;
  /** Rotation offset (steps), default 0. */
  rotate: number;
}

export interface ArpWalkSpec {
  /** Max chord-tone (pool-index) steps per move. Only used when contour: walk. */
  maxInterval: number;
}

export interface ArpSpec {
  name: string;
  contour: ArpContour;
  /** 1-4; voicing extended upward by octave copies. */
  octaves: number;
  /** "1/4"|"1/8"|"1/16"|"1/32" with optional t (triplet) / d (dotted) suffix. */
  rate: string;
  /** 0.05-1.0 fraction of the step. */
  gate: number;
  /** Steps before the pattern cycles; != bar length = polymeter. */
  patternLength: number;
  /** Euclidean onset mask over the step grid; k<n thins. */
  euclid: ArpEuclidSpec;
  /** Explicit pattern positions (0-based) silenced after the euclid mask. */
  rests: number[];
  /** Pattern position -> subdivision count (2/3/4). */
  ratchets: Record<number, 2 | 3 | 4>;
  velocity: ArpVelocitySpec;
  /** 0-0.5, even-16th delay fraction (drum-engine convention). */
  swing: number;
  walk: ArpWalkSpec;
}

const TOP_LEVEL_KEYS = new Set([
  "name",
  "contour",
  "octaves",
  "rate",
  "gate",
  "patternLength",
  "euclid",
  "rests",
  "ratchets",
  "velocity",
  "swing",
  "walk",
]);
const EUCLID_KEYS = new Set(["k", "n", "rotate"]);
const VELOCITY_KEYS = new Set(["base", "accentSteps", "accentBoost", "shape"]);
const WALK_KEYS = new Set(["maxInterval"]);

const VALID_CONTOURS: readonly ArpContour[] = [
  "up",
  "down",
  "updown",
  "downup",
  "converge",
  "diverge",
  "walk",
  "as-voiced",
];
const VALID_SHAPES: readonly VelocityShape[] = ["none", "ramp-up", "ramp-down"];
const RATE_RE = /^1\/(4|8|16|32)(t|d)?$/;
const VALID_RATCHET_COUNTS = new Set([2, 3, 4]);

function fail(message: string): never {
  throw new Error(`arp spec: ${message}`);
}

/** Step length in beats for a rate string like "1/16", "1/16t", "1/8d". Throws
 *  on an unrecognized rate. Shared by the parser and CLI --rate overrides. */
export function arpRateBeats(rate: string): number {
  const m = RATE_RE.exec(rate);
  if (!m) {
    fail(`"rate" must be 1/4|1/8|1/16|1/32 with an optional t (triplet) / d (dotted) suffix (got ${JSON.stringify(rate)})`);
  }
  const base = 4 / Number(m[1]);
  const suffix = m[2];
  if (suffix === "t") return base * (2 / 3);
  if (suffix === "d") return base * 1.5;
  return base;
}

/** Validates an arp gate value (0.05-1.0). Shared by the parser and CLI
 *  --gate overrides. */
export function checkArpGate(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0.05 || value > 1) {
    fail(`"gate" must be a number in [0.05, 1.0] (got ${JSON.stringify(value)})`);
  }
  return value;
}

function checkPositiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    fail(`"${field}" must be a positive integer (got ${JSON.stringify(value)})`);
  }
  return value;
}

function parseEuclid(raw: unknown, patternLength: number): ArpEuclidSpec {
  if (raw === undefined) return { k: patternLength, n: patternLength, rotate: 0 };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(`"euclid" must be a mapping with "k" and "n"`);
  }
  const e = raw as Record<string, unknown>;
  for (const key of Object.keys(e)) {
    if (!EUCLID_KEYS.has(key)) {
      fail(`euclid: unknown field "${key}" (expected one of ${[...EUCLID_KEYS].join(", ")})`);
    }
  }
  if (typeof e.k !== "number" || !Number.isInteger(e.k) || e.k < 0) {
    fail(`"euclid.k" must be a non-negative integer (got ${JSON.stringify(e.k)})`);
  }
  if (e.k === 0) {
    fail(
      `"euclid.k" must be >= 1 — k=0 produces a silent arp with no notes at all; ` +
        `use explicit "rests" to thin a pattern instead, or omit "euclid" for a full mask`,
    );
  }
  if (typeof e.n !== "number" || !Number.isInteger(e.n) || e.n < 1) {
    fail(`"euclid.n" must be a positive integer (got ${JSON.stringify(e.n)})`);
  }
  if (e.k > e.n) {
    fail(`"euclid.k" (${e.k}) must be <= "euclid.n" (${e.n})`);
  }
  let rotate = 0;
  if (e.rotate !== undefined) {
    if (typeof e.rotate !== "number" || !Number.isInteger(e.rotate)) {
      fail(`"euclid.rotate" must be an integer (got ${JSON.stringify(e.rotate)})`);
    }
    rotate = e.rotate;
  }
  return { k: e.k, n: e.n, rotate };
}

function parseRests(raw: unknown, patternLength: number): number[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail(`"rests" must be an array of step indices`);
  return (raw as unknown[]).map((r, i) => {
    if (typeof r !== "number" || !Number.isInteger(r) || r < 0 || r >= patternLength) {
      fail(`rests[${i}]: must be an integer in [0, ${patternLength}) (got ${JSON.stringify(r)})`);
    }
    return r;
  });
}

function parseRatchets(raw: unknown, patternLength: number): Record<number, 2 | 3 | 4> {
  if (raw === undefined) return {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(`"ratchets" must be a mapping of step index -> subdivision count (2/3/4)`);
  }
  const out: Record<number, 2 | 3 | 4> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const step = Number(key);
    if (!Number.isInteger(step) || step < 0 || step >= patternLength) {
      fail(`ratchets: key "${key}" must be an integer step index in [0, ${patternLength})`);
    }
    if (typeof value !== "number" || !VALID_RATCHET_COUNTS.has(value)) {
      fail(`ratchets[${key}]: subdivision count must be 2, 3, or 4 (got ${JSON.stringify(value)})`);
    }
    out[step] = value as 2 | 3 | 4;
  }
  return out;
}

function parseVelocity(raw: unknown, patternLength: number): ArpVelocitySpec {
  if (raw === undefined) return { base: 100, accentSteps: [], accentBoost: 0, shape: "none" };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(`"velocity" must be a mapping with "base"`);
  }
  const v = raw as Record<string, unknown>;
  for (const key of Object.keys(v)) {
    if (!VELOCITY_KEYS.has(key)) {
      fail(`velocity: unknown field "${key}" (expected one of ${[...VELOCITY_KEYS].join(", ")})`);
    }
  }
  if (typeof v.base !== "number" || v.base < 1 || v.base > 127) {
    fail(`"velocity.base" must be a number in [1, 127] (got ${JSON.stringify(v.base)})`);
  }
  let accentSteps: number[] = [];
  if (v.accentSteps !== undefined) {
    if (!Array.isArray(v.accentSteps)) fail(`"velocity.accentSteps" must be an array`);
    accentSteps = (v.accentSteps as unknown[]).map((s, i) => {
      if (typeof s !== "number" || !Number.isInteger(s) || s < 0 || s >= patternLength) {
        fail(`velocity.accentSteps[${i}]: must be an integer in [0, ${patternLength}) (got ${JSON.stringify(s)})`);
      }
      return s;
    });
  }
  let accentBoost = 0;
  if (v.accentBoost !== undefined) {
    if (typeof v.accentBoost !== "number" || Number.isNaN(v.accentBoost)) {
      fail(`"velocity.accentBoost" must be a number (got ${JSON.stringify(v.accentBoost)})`);
    }
    accentBoost = v.accentBoost;
  }
  let shape: VelocityShape = "none";
  if (v.shape !== undefined) {
    if (typeof v.shape !== "string" || !VALID_SHAPES.includes(v.shape as VelocityShape)) {
      fail(`"velocity.shape" must be one of ${VALID_SHAPES.join(", ")} (got ${JSON.stringify(v.shape)})`);
    }
    shape = v.shape as VelocityShape;
  }
  return { base: v.base, accentSteps, accentBoost, shape };
}

function parseWalk(raw: unknown): ArpWalkSpec {
  if (raw === undefined) return { maxInterval: 2 };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(`"walk" must be a mapping with "maxInterval"`);
  }
  const w = raw as Record<string, unknown>;
  for (const key of Object.keys(w)) {
    if (!WALK_KEYS.has(key)) fail(`walk: unknown field "${key}" (expected "maxInterval")`);
  }
  const maxInterval = w.maxInterval === undefined ? 2 : checkPositiveInt(w.maxInterval, "walk.maxInterval");
  return { maxInterval };
}

/**
 * Parse and validate an ArpSpec from a YAML document. Rejects unknown
 * top-level (and nested) keys so hand-written data catches typos instead of
 * silently ignoring a misspelled field, like parseDrumStyleSpec and
 * parsePhraseSpec.
 */
export function parseArpSpec(yamlText: string): ArpSpec {
  const doc: unknown = parseYaml(yamlText);
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

  let contour: ArpContour = "up";
  if (raw.contour !== undefined) {
    if (typeof raw.contour !== "string" || !VALID_CONTOURS.includes(raw.contour as ArpContour)) {
      fail(`"contour" must be one of ${VALID_CONTOURS.join(", ")} (got ${JSON.stringify(raw.contour)})`);
    }
    contour = raw.contour as ArpContour;
  }

  let octaves = 1;
  if (raw.octaves !== undefined) {
    if (typeof raw.octaves !== "number" || !Number.isInteger(raw.octaves) || raw.octaves < 1 || raw.octaves > 4) {
      fail(`"octaves" must be an integer in [1, 4] (got ${JSON.stringify(raw.octaves)})`);
    }
    octaves = raw.octaves;
  }

  const rate = raw.rate === undefined ? "1/16" : raw.rate;
  if (typeof rate !== "string") fail(`"rate" must be a string (got ${JSON.stringify(rate)})`);
  arpRateBeats(rate); // validates format, throws on typo

  const gate = raw.gate === undefined ? 0.8 : checkArpGate(raw.gate);

  const patternLength =
    raw.patternLength === undefined ? 16 : checkPositiveInt(raw.patternLength, "patternLength");

  const euclid = parseEuclid(raw.euclid, patternLength);
  const rests = parseRests(raw.rests, patternLength);
  const ratchets = parseRatchets(raw.ratchets, patternLength);
  const velocity = parseVelocity(raw.velocity, patternLength);

  let swing = 0;
  if (raw.swing !== undefined) {
    if (typeof raw.swing !== "number" || Number.isNaN(raw.swing) || raw.swing < 0 || raw.swing > 0.5) {
      fail(`"swing" must be a number in [0, 0.5] (got ${JSON.stringify(raw.swing)})`);
    }
    swing = raw.swing;
  }

  const walk = parseWalk(raw.walk);

  return {
    name: raw.name,
    contour,
    octaves,
    rate,
    gate,
    patternLength,
    euclid,
    rests,
    ratchets,
    velocity,
    swing,
    walk,
  };
}

/** The built-in "basic-up" style: plain ascending arp, full mask. */
export const BASIC_UP_SPEC: ArpSpec = {
  name: "basic-up",
  contour: "up",
  octaves: 1,
  rate: "1/16",
  gate: 0.8,
  patternLength: 16,
  euclid: { k: 16, n: 16, rotate: 0 },
  rests: [],
  ratchets: {},
  velocity: { base: 100, accentSteps: [], accentBoost: 0, shape: "none" },
  swing: 0,
  walk: { maxInterval: 2 },
};

/** The built-in "melodic-techno-16ths" style: the example spec from
 *  docs/design/arp-engine.md, verbatim. */
export const MELODIC_TECHNO_16THS_SPEC: ArpSpec = {
  name: "melodic-techno-16ths",
  contour: "updown",
  octaves: 2,
  rate: "1/16",
  gate: 0.8,
  patternLength: 16,
  euclid: { k: 16, n: 16, rotate: 0 },
  rests: [],
  ratchets: {},
  velocity: { base: 96, accentSteps: [0, 6, 10], accentBoost: 24, shape: "none" },
  swing: 0,
  walk: { maxInterval: 2 },
};

/** Built-in arp style names. */
export function listArpStyles(): string[] {
  return ["basic-up", "melodic-techno-16ths"];
}

/**
 * Named variants a spec offers (variant-listable like drums/phrase): forces
 * the euclid mask's rotation, the one discrete groove-level choice a bare
 * ArpSpec exposes (there's no cell/recipe table to draw from, unlike drums'
 * kickCells or phrase's callCells). Index i == rotate amount i.
 */
export function listArpVariants(spec: ArpSpec): string[] {
  return Array.from({ length: spec.euclid.n }, (_, i) => `rotate-${i}`);
}
