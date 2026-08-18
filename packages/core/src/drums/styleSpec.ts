/**
 * B4 StyleSpec: data-driven drum-family styles. A DrumStyleSpec is plain data
 * (parsed from YAML, typically embedded in a knowledge-base entry) that
 * drives the same generator code path as a built-in style — new grooves can
 * be authored without touching code.
 *
 * Two families exist today:
 *  - "trap": half-time, pattern-CELL kick model (see grammars.ts#trapFamilyPlan).
 *  - "house": four-on-the-floor, house/techno/garage-adjacent styles (see
 *    grammars.ts#houseFamilyPlan). The built-in "house" and "techno" styles
 *    are themselves just houseFamilyPlan(HOUSE_STYLE_SPEC) /
 *    houseFamilyPlan(TECHNO_STYLE_SPEC).
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

/**
 * Closed-hat base grid below/at-or-above `hatGrid.threshold` density.
 *  - "8ths": every-half-beat grid (or, at `high`, every-16th grid with a
 *    single uniform velocity band — no on-8th/off-16th split).
 *  - "16ths": every-16th grid with the on-8th/off-16th velocity split
 *    (off-16ths optionally delayed by `swingDelay`).
 *  - "offbeat-8ths" (low only): only the "and" of each beat.
 */
export type HouseHatLowMode = "8ths" | "16ths" | "offbeat-8ths";
export type HouseHatHighMode = "8ths" | "16ths";

export interface HouseHatGridConfig {
  low: HouseHatLowMode;
  high: HouseHatHighMode;
  /** Density at/above which `high` applies; below it, `low`. Default 0.5. */
  threshold?: number;
}

export interface HouseRideConfig {
  /** Ride 8ths fire once density is at/above this. */
  minDensity: number;
}

export interface HouseRumbleKicksConfig {
  /** Section fires once density is at/above this. */
  minDensity: number;
  /** Per-beat chance of a late-16th ghost kick, once the section is active. */
  probability: number;
}

export interface HouseFamilyStyleSpec {
  name: string;
  family: "house";
  /** Only "four-floor" is supported today; validated literally. Default. */
  kickBeats?: "four-floor";
  /** Roles hit on beats 2 & 4. Default ["clap", "snare"]; [] = none. */
  backbeat?: ("clap" | "snare")[];
  /** Backbeat only fires once density is at/above this. Default 0 (always). */
  backbeatMinDensity?: number;
  /**
   * true = an open hat on every offbeat, unconditionally (house default).
   * A number 0..1 = per-offbeat chance, gated on density >= that same
   * number (techno-style). Default true.
   */
  openHatOffbeats?: boolean | number;
  /** Closed-hat base grid. Default { low: "8ths", high: "16ths" }. */
  hatGrid?: HouseHatGridConfig;
  /** Ride 8ths at/above minDensity; null/absent = never. Default null. */
  ride?: HouseRideConfig | null;
  /** Scattered 16th ghosts once density > 0.3 (first available role used). */
  ghostRoles?: ("perc" | "shaker")[];
  /** 0..1 multiplier on the 0.15*density ghost-hit probability. Default 1. */
  ghostChance?: number;
  /** Late-16th ghost kicks; null/absent = never. Default null. */
  rumbleKicks?: HouseRumbleKicksConfig | null;
  /** Delay applied to off-16th closed hats in "16ths" grid mode, in beats. Default 0. */
  swingDelay?: number;
}

export type DrumStyleSpec = TrapFamilyStyleSpec | HouseFamilyStyleSpec;

const TRAP_TOP_LEVEL_KEYS = new Set([
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

const HOUSE_TOP_LEVEL_KEYS = new Set([
  "name",
  "family",
  "kickBeats",
  "backbeat",
  "backbeatMinDensity",
  "openHatOffbeats",
  "hatGrid",
  "ride",
  "ghostRoles",
  "ghostChance",
  "rumbleKicks",
  "swingDelay",
]);
const HAT_GRID_KEYS = new Set(["low", "high", "threshold"]);
const RIDE_KEYS = new Set(["minDensity"]);
const RUMBLE_KICKS_KEYS = new Set(["minDensity", "probability"]);
const VALID_BACKBEAT_ROLES = ["clap", "snare"] as const;
const VALID_GHOST_ROLES = ["perc", "shaker"] as const;
const VALID_HAT_LOW_MODES: readonly HouseHatLowMode[] = ["8ths", "16ths", "offbeat-8ths"];
const VALID_HAT_HIGH_MODES: readonly HouseHatHighMode[] = ["8ths", "16ths"];

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

function parseTrapFamilySpec(raw: Record<string, unknown>): TrapFamilyStyleSpec {
  for (const key of Object.keys(raw)) {
    if (!TRAP_TOP_LEVEL_KEYS.has(key)) {
      fail(`unknown field "${key}" (expected one of ${[...TRAP_TOP_LEVEL_KEYS].join(", ")})`);
    }
  }

  if (typeof raw.name !== "string" || raw.name.trim() === "") {
    fail(`"name" must be a non-empty string`);
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

function parseHouseFamilySpec(raw: Record<string, unknown>): HouseFamilyStyleSpec {
  for (const key of Object.keys(raw)) {
    if (!HOUSE_TOP_LEVEL_KEYS.has(key)) {
      fail(`unknown field "${key}" (expected one of ${[...HOUSE_TOP_LEVEL_KEYS].join(", ")})`);
    }
  }

  if (typeof raw.name !== "string" || raw.name.trim() === "") {
    fail(`"name" must be a non-empty string`);
  }

  let kickBeats: "four-floor" | undefined;
  if (raw.kickBeats !== undefined) {
    if (raw.kickBeats !== "four-floor") {
      fail(`"kickBeats" must be "four-floor" (got ${JSON.stringify(raw.kickBeats)})`);
    }
    kickBeats = raw.kickBeats;
  }

  let backbeat: ("clap" | "snare")[] | undefined;
  if (raw.backbeat !== undefined) {
    if (!Array.isArray(raw.backbeat)) {
      fail(`"backbeat" must be an array (got ${JSON.stringify(raw.backbeat)})`);
    }
    backbeat = (raw.backbeat as unknown[]).map((r, i) => {
      if (typeof r !== "string" || !VALID_BACKBEAT_ROLES.includes(r as (typeof VALID_BACKBEAT_ROLES)[number])) {
        fail(
          `backbeat[${i}]: unknown value ${JSON.stringify(r)} (expected one of ${VALID_BACKBEAT_ROLES.join(", ")})`,
        );
      }
      return r as "clap" | "snare";
    });
  }

  const backbeatMinDensity = checkUnitRange(raw.backbeatMinDensity, "backbeatMinDensity");

  let openHatOffbeats: boolean | number | undefined;
  if (raw.openHatOffbeats !== undefined) {
    if (typeof raw.openHatOffbeats === "boolean") {
      openHatOffbeats = raw.openHatOffbeats;
    } else if (typeof raw.openHatOffbeats === "number") {
      if (Number.isNaN(raw.openHatOffbeats) || raw.openHatOffbeats < 0 || raw.openHatOffbeats > 1) {
        fail(
          `"openHatOffbeats" must be a boolean or a number in [0, 1] (got ${JSON.stringify(raw.openHatOffbeats)})`,
        );
      }
      openHatOffbeats = raw.openHatOffbeats;
    } else {
      fail(
        `"openHatOffbeats" must be a boolean or a number in [0, 1] (got ${JSON.stringify(raw.openHatOffbeats)})`,
      );
    }
  }

  let hatGrid: HouseHatGridConfig | undefined;
  if (raw.hatGrid !== undefined) {
    if (raw.hatGrid === null || typeof raw.hatGrid !== "object" || Array.isArray(raw.hatGrid)) {
      fail(`"hatGrid" must be a mapping with "low" and "high"`);
    }
    const hg = raw.hatGrid as Record<string, unknown>;
    for (const key of Object.keys(hg)) {
      if (!HAT_GRID_KEYS.has(key)) {
        fail(`hatGrid: unknown field "${key}" (expected one of ${[...HAT_GRID_KEYS].join(", ")})`);
      }
    }
    if (typeof hg.low !== "string" || !VALID_HAT_LOW_MODES.includes(hg.low as HouseHatLowMode)) {
      fail(`hatGrid.low: unknown value ${JSON.stringify(hg.low)} (expected one of ${VALID_HAT_LOW_MODES.join(", ")})`);
    }
    if (typeof hg.high !== "string" || !VALID_HAT_HIGH_MODES.includes(hg.high as HouseHatHighMode)) {
      fail(
        `hatGrid.high: unknown value ${JSON.stringify(hg.high)} (expected one of ${VALID_HAT_HIGH_MODES.join(", ")})`,
      );
    }
    const threshold = checkUnitRange(hg.threshold, "hatGrid.threshold");
    hatGrid = {
      low: hg.low as HouseHatLowMode,
      high: hg.high as HouseHatHighMode,
      ...(threshold !== undefined ? { threshold } : {}),
    };
  }

  let ride: HouseRideConfig | null | undefined;
  if (raw.ride !== undefined) {
    if (raw.ride === null) {
      ride = null;
    } else if (typeof raw.ride !== "object" || Array.isArray(raw.ride)) {
      fail(`"ride" must be a mapping with "minDensity", or null`);
    } else {
      const r = raw.ride as Record<string, unknown>;
      for (const key of Object.keys(r)) {
        if (!RIDE_KEYS.has(key)) fail(`ride: unknown field "${key}" (expected "minDensity")`);
      }
      const minDensity = checkUnitRange(r.minDensity, "ride.minDensity");
      if (minDensity === undefined) fail(`"ride.minDensity" must be a number in [0, 1]`);
      ride = { minDensity };
    }
  }

  let ghostRoles: ("perc" | "shaker")[] | undefined;
  if (raw.ghostRoles !== undefined) {
    if (!Array.isArray(raw.ghostRoles)) {
      fail(`"ghostRoles" must be an array (got ${JSON.stringify(raw.ghostRoles)})`);
    }
    ghostRoles = (raw.ghostRoles as unknown[]).map((r, i) => {
      if (typeof r !== "string" || !VALID_GHOST_ROLES.includes(r as (typeof VALID_GHOST_ROLES)[number])) {
        fail(
          `ghostRoles[${i}]: unknown value ${JSON.stringify(r)} (expected one of ${VALID_GHOST_ROLES.join(", ")})`,
        );
      }
      return r as "perc" | "shaker";
    });
  }

  const ghostChance = checkUnitRange(raw.ghostChance, "ghostChance");

  let rumbleKicks: HouseRumbleKicksConfig | null | undefined;
  if (raw.rumbleKicks !== undefined) {
    if (raw.rumbleKicks === null) {
      rumbleKicks = null;
    } else if (typeof raw.rumbleKicks !== "object" || Array.isArray(raw.rumbleKicks)) {
      fail(`"rumbleKicks" must be a mapping with "minDensity" and "probability", or null`);
    } else {
      const rk = raw.rumbleKicks as Record<string, unknown>;
      for (const key of Object.keys(rk)) {
        if (!RUMBLE_KICKS_KEYS.has(key)) {
          fail(`rumbleKicks: unknown field "${key}" (expected "minDensity" or "probability")`);
        }
      }
      const minDensity = checkUnitRange(rk.minDensity, "rumbleKicks.minDensity");
      const probability = checkUnitRange(rk.probability, "rumbleKicks.probability");
      if (minDensity === undefined) fail(`"rumbleKicks.minDensity" must be a number in [0, 1]`);
      if (probability === undefined) fail(`"rumbleKicks.probability" must be a number in [0, 1]`);
      rumbleKicks = { minDensity, probability };
    }
  }

  let swingDelay: number | undefined;
  if (raw.swingDelay !== undefined) {
    if (typeof raw.swingDelay !== "number" || Number.isNaN(raw.swingDelay) || raw.swingDelay < 0) {
      fail(`"swingDelay" must be a non-negative number of beats (got ${JSON.stringify(raw.swingDelay)})`);
    }
    swingDelay = raw.swingDelay;
  }

  return {
    name: raw.name,
    family: "house",
    ...(kickBeats !== undefined ? { kickBeats } : {}),
    ...(backbeat !== undefined ? { backbeat } : {}),
    ...(backbeatMinDensity !== undefined ? { backbeatMinDensity } : {}),
    ...(openHatOffbeats !== undefined ? { openHatOffbeats } : {}),
    ...(hatGrid !== undefined ? { hatGrid } : {}),
    ...(ride !== undefined ? { ride } : {}),
    ...(ghostRoles !== undefined ? { ghostRoles } : {}),
    ...(ghostChance !== undefined ? { ghostChance } : {}),
    ...(rumbleKicks !== undefined ? { rumbleKicks } : {}),
    ...(swingDelay !== undefined ? { swingDelay } : {}),
  };
}

/**
 * Parse and validate a DrumStyleSpec from a YAML document, dispatching on
 * `family`. Rejects unknown top-level (and nested) keys so hand-written data
 * catches typos instead of silently ignoring a misspelled field.
 */
export function parseDrumStyleSpec(yamlText: string): DrumStyleSpec {
  const doc = parseYaml(yamlText);
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    fail("expected a YAML mapping at the top level");
  }
  const raw = doc as Record<string, unknown>;

  if (raw.family === "trap") return parseTrapFamilySpec(raw);
  if (raw.family === "house") return parseHouseFamilySpec(raw);
  fail(`unknown family ${JSON.stringify(raw.family)} (expected "trap" or "house")`);
}
