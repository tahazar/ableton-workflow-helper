/**
 * B4 StyleSpec: data-driven trap-family drum styles. A TrapFamilyStyleSpec is
 * plain data (parsed from YAML, typically embedded in a knowledge-base
 * entry) that drives the same generator code path as the built-in "trap"
 * style (see grammars.ts#trapFamilyPlan) — new trap-family grooves can be
 * authored without touching code.
 */
import { parse as parseYaml } from "yaml";

export type TrapHatBaseName = "straight-8ths" | "16th-run" | "swung-16ths";

export interface TrapFamilyKickCell {
  name: string;
  /** 0-based beat offsets within a bar; must include 0 (anchors beat 1). */
  offsets: number[];
}

export interface TrapFamilyStyleSpec {
  name: string;
  /** Only "trap" is supported today; validated literally. */
  family: "trap";
  /** 1-based beat of the half-time backbeat. Default 3. */
  snareBeat?: number;
  /** Whether the backbeat also fires a clap. Default true. */
  clapWithSnare?: boolean;
  /** Curated kick figures; one is drawn (or forced via variant) per loop. */
  kickCells: TrapFamilyKickCell[];
  /** Restricts the groove-level hat-base choice. Default: all three. */
  hatBases?: TrapHatBaseName[];
  /** 0..1 multiplier on hat roll-event probability. Default 1. */
  rollDensity?: number;
  /** 0..1 chance of a bar-end open hat (density-gated). Default 0.5. */
  openHatChance?: number;
  /** Delay applied to off-16th hats in the swung base, in beats. Default 0.06. */
  swingDelay?: number;
}

const TOP_LEVEL_KEYS = new Set([
  "name",
  "family",
  "snareBeat",
  "clapWithSnare",
  "kickCells",
  "hatBases",
  "rollDensity",
  "openHatChance",
  "swingDelay",
]);
const CELL_KEYS = new Set(["name", "offsets"]);
const VALID_HAT_BASES: readonly TrapHatBaseName[] = ["straight-8ths", "16th-run", "swung-16ths"];

function fail(message: string): never {
  throw new Error(`drum style spec: ${message}`);
}

function checkUnitRange(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    fail(`"${field}" must be a number in [0, 1] (got ${JSON.stringify(value)})`);
  }
  return value;
}

/**
 * Parse and validate a TrapFamilyStyleSpec from a YAML document. Rejects
 * unknown top-level (and per-cell) keys so hand-written data catches typos
 * instead of silently ignoring a misspelled field.
 */
export function parseDrumStyleSpec(yamlText: string): TrapFamilyStyleSpec {
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
  if (raw.family !== "trap") {
    fail(`unknown family ${JSON.stringify(raw.family)} (only "trap" is supported)`);
  }

  if (!Array.isArray(raw.kickCells) || raw.kickCells.length === 0) {
    fail(`"kickCells" must be a non-empty array`);
  }
  const kickCells: TrapFamilyKickCell[] = raw.kickCells.map((rawCell: unknown, i: number) => {
    if (rawCell === null || typeof rawCell !== "object" || Array.isArray(rawCell)) {
      fail(`kickCells[${i}] must be a mapping with "name" and "offsets"`);
    }
    const cell = rawCell as Record<string, unknown>;
    for (const key of Object.keys(cell)) {
      if (!CELL_KEYS.has(key)) {
        fail(`kickCells[${i}]: unknown field "${key}" (expected "name" or "offsets")`);
      }
    }
    if (typeof cell.name !== "string" || cell.name.trim() === "") {
      fail(`kickCells[${i}]: "name" must be a non-empty string`);
    }
    if (!Array.isArray(cell.offsets) || cell.offsets.length === 0) {
      fail(`kickCells[${i}] ("${cell.name}"): "offsets" must be a non-empty array`);
    }
    const offsets = (cell.offsets as unknown[]).map((o, j) => {
      if (typeof o !== "number" || Number.isNaN(o)) {
        fail(`kickCells[${i}] ("${cell.name}"): offsets[${j}] must be a number`);
      }
      if (o < 0) {
        fail(`kickCells[${i}] ("${cell.name}"): offsets must be >= 0 (got ${o} at index ${j})`);
      }
      return o;
    });
    if (!offsets.includes(0)) {
      fail(`kickCells[${i}] ("${cell.name}"): offsets must include 0 (the cell must anchor beat 1)`);
    }
    return { name: cell.name, offsets };
  });

  let hatBases: TrapHatBaseName[] | undefined;
  if (raw.hatBases !== undefined) {
    if (!Array.isArray(raw.hatBases) || raw.hatBases.length === 0) {
      fail(`"hatBases" must be a non-empty array`);
    }
    hatBases = (raw.hatBases as unknown[]).map((b, i) => {
      if (typeof b !== "string" || !VALID_HAT_BASES.includes(b as TrapHatBaseName)) {
        fail(
          `hatBases[${i}]: unknown value ${JSON.stringify(b)} (expected one of ${VALID_HAT_BASES.join(", ")})`,
        );
      }
      return b as TrapHatBaseName;
    });
  }

  let snareBeat: number | undefined;
  if (raw.snareBeat !== undefined) {
    if (typeof raw.snareBeat !== "number" || !Number.isFinite(raw.snareBeat) || raw.snareBeat < 1) {
      fail(`"snareBeat" must be a number >= 1 (got ${JSON.stringify(raw.snareBeat)})`);
    }
    snareBeat = raw.snareBeat;
  }

  if (raw.clapWithSnare !== undefined && typeof raw.clapWithSnare !== "boolean") {
    fail(`"clapWithSnare" must be a boolean (got ${JSON.stringify(raw.clapWithSnare)})`);
  }

  const rollDensity = checkUnitRange(raw.rollDensity, "rollDensity");
  const openHatChance = checkUnitRange(raw.openHatChance, "openHatChance");

  let swingDelay: number | undefined;
  if (raw.swingDelay !== undefined) {
    if (typeof raw.swingDelay !== "number" || Number.isNaN(raw.swingDelay) || raw.swingDelay < 0) {
      fail(`"swingDelay" must be a non-negative number of beats (got ${JSON.stringify(raw.swingDelay)})`);
    }
    swingDelay = raw.swingDelay;
  }

  return {
    name: raw.name,
    family: "trap",
    kickCells,
    ...(snareBeat !== undefined ? { snareBeat } : {}),
    ...(raw.clapWithSnare !== undefined ? { clapWithSnare: raw.clapWithSnare as boolean } : {}),
    ...(hatBases !== undefined ? { hatBases } : {}),
    ...(rollDensity !== undefined ? { rollDensity } : {}),
    ...(openHatChance !== undefined ? { openHatChance } : {}),
    ...(swingDelay !== undefined ? { swingDelay } : {}),
  };
}
