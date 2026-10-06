/**
 * BreakSpec: data-driven break-chop re-sequencing styles. Follows the same
 * data-driven spec pattern as drums/styleSpec.ts, phrase/spec.ts and
 * arp/spec.ts: unknown keys are rejected, and defaults let a knowledge
 * entry state only what it changes. Pinned semantics: docs/design/break-engine.md.
 *
 * A BreakSpec drives `awh breaks pattern`: how much of a chopped break's
 * own canonical slice order gets replayed verbatim ("the statement") before
 * the engine starts re-sequencing ("the turnaround"): chopping the tail
 * densely, displacing snares off the grid, shuffling in ghost hits, and
 * (role-aware) substituting one slice for another of the same guessed
 * role. `awh breaks fill` is a separate built-in grammar (see engine.ts's
 * BreakFillSpec), not driven by a knowledge-authorable spec.
 */
import { parse as parseYaml } from "yaml";

export interface BreakSpec {
  name: string;
  /** Bars at the start of the pattern that replay the chop map's own
   *  canonical slice order verbatim (tiled/truncated to fit) before any
   *  re-sequencing begins. 0 = no verbatim statement at all. */
  statementBars: number;
  /** 0..1: in the turnaround (post-statement) bars, the per-step chance a
   *  canonical slice gets a "trick" applied (stutter or role-aware
   *  substitution) instead of playing plain. Higher = busier/choppier. */
  turnaroundDensity: number;
  /** 16th-grid step offsets a snare-role hit may be displaced by in the
   *  turnaround (e.g. [-1, 1, 2]), for jungle-style snare placement variation.
   *  Empty = snares never displaced (only chopped/substituted in place). */
  snareDisplacement: number[];
  /** 0..1: per naturally-silent turnaround grid step, the chance a
   *  ghost-role slice (if the map has one) gets shuffled in. */
  ghostShuffleChance: number;
  /** When true, a turnaround step may substitute a different slice of the
   *  same guessed role instead of its own canonical slice (never crosses
   *  roles). When false, or when the map's role confidence
   *  is too low across the board (see engine.ts's LOW_CONFIDENCE_THRESHOLD
   *  negative control), only same-slice tricks (stutter/retrigger of the
   *  step's own canonical slice) are used. */
  allowSubstitution: boolean;
}

const TOP_LEVEL_KEYS = new Set([
  "name",
  "statementBars",
  "turnaroundDensity",
  "snareDisplacement",
  "ghostShuffleChance",
  "allowSubstitution",
]);

function fail(message: string): never {
  throw new Error(`break spec: ${message}`);
}

function checkUnitRange(value: unknown, field: string): number {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    fail(`"${field}" must be a number in [0, 1] (got ${JSON.stringify(value)})`);
  }
  return value;
}

function checkNonNegativeInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(`"${field}" must be a non-negative integer (got ${JSON.stringify(value)})`);
  }
  return value;
}

function parseSnareDisplacement(raw: unknown): number[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) fail(`"snareDisplacement" must be an array of integer step offsets`);
  return (raw as unknown[]).map((v, i) => {
    if (typeof v !== "number" || !Number.isInteger(v) || v === 0) {
      fail(`snareDisplacement[${i}]: must be a non-zero integer step offset (got ${JSON.stringify(v)})`);
    }
    return v;
  });
}

/**
 * Parse and validate a BreakSpec from a YAML document. Rejects unknown
 * top-level keys so hand-written data catches typos instead of silently
 * ignoring a misspelled field, like parseArpSpec, parseDrumStyleSpec and
 * parsePhraseSpec.
 */
export function parseBreakSpec(yamlText: string): BreakSpec {
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

  const statementBars = raw.statementBars === undefined ? 1 : checkNonNegativeInt(raw.statementBars, "statementBars");
  const turnaroundDensity =
    raw.turnaroundDensity === undefined ? 0.5 : checkUnitRange(raw.turnaroundDensity, "turnaroundDensity");
  const snareDisplacement = parseSnareDisplacement(raw.snareDisplacement);
  const ghostShuffleChance =
    raw.ghostShuffleChance === undefined ? 0.0 : checkUnitRange(raw.ghostShuffleChance, "ghostShuffleChance");
  let allowSubstitution = true;
  if (raw.allowSubstitution !== undefined) {
    if (typeof raw.allowSubstitution !== "boolean") {
      fail(`"allowSubstitution" must be a boolean (got ${JSON.stringify(raw.allowSubstitution)})`);
    }
    allowSubstitution = raw.allowSubstitution;
  }

  return {
    name: raw.name,
    statementBars,
    turnaroundDensity,
    snareDisplacement,
    ghostShuffleChance,
    allowSubstitution,
  };
}

/** Built-in "jungle-classic": one bar of verbatim statement, then a dense,
 *  substitution-heavy chop of the tail with snare displacement and ghost
 *  shuffling: "state then chop the tail" (docs/design/break-engine.md). */
export const JUNGLE_CLASSIC_SPEC: BreakSpec = {
  name: "jungle-classic",
  statementBars: 1,
  turnaroundDensity: 0.6,
  snareDisplacement: [-1, 1, 2],
  ghostShuffleChance: 0.25,
  allowSubstitution: true,
};

/** Built-in "halftime": no verbatim statement, sparse placement of the
 *  same slices throughout (low turnaround density, no snare displacement,
 *  minimal ghost shuffling) for a half-time feel from the same break. */
export const HALFTIME_SPEC: BreakSpec = {
  name: "halftime",
  statementBars: 0,
  turnaroundDensity: 0.15,
  snareDisplacement: [],
  ghostShuffleChance: 0.05,
  allowSubstitution: true,
};

/** Built-in BreakSpec names. */
export function listBreakStyles(): string[] {
  return ["jungle-classic", "halftime"];
}
