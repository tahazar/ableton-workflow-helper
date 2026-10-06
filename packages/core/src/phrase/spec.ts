/**
 * PhraseSpec: data-driven call-and-response phrase styles, sibling to
 * DrumStyleSpec (../drums/styleSpec.ts) with the same parsing conventions:
 * unknown keys are rejected, and defaults let a knowledge entry state only
 * what it changes.
 *
 * Craft ground truth for the shape below: knowledge/arrangement/
 * call-response-drop-grammar.md, call-response-rest-placement.md,
 * drop-phrase-evolution.md (see docs/design/phrase-engine.md).
 */
import { parse as parseYaml } from "yaml";

export type ResponseRecipeName =
  | "echo-low"
  | "truncate-stab"
  | "invert-answer"
  | "displaced-echo"
  | "sparse-answer";

export const RESPONSE_RECIPE_NAMES: readonly ResponseRecipeName[] = [
  "echo-low",
  "truncate-stab",
  "invert-answer",
  "displaced-echo",
  "sparse-answer",
];

export type TurnaroundKind = "drop-response" | "extra-rest" | "none";
export type EvolutionAction = "state" | "vary-call";

export interface CallCell {
  name: string;
  /** 0-based beat offsets within a bar; must include 0. Parallel to `lengths`. */
  beats: number[];
  /** Duration in beats for each onset, same length/order as `beats`. */
  lengths: number[];
  /** Selection weight (default 1 when omitted in YAML). */
  weight: number;
}

export interface EvolutionStep {
  /** Inclusive 1-based bar range within one phraseBars unit, e.g. [1, 4]. */
  bars: [number, number];
  action: EvolutionAction;
}

export interface PhraseSpec {
  name: string;
  /** Only "call-response" is supported; validated literally (field reserved). */
  family: "call-response";
  /** One phrase unit; a drop = 1-2+ units. The evolution plan repeats every phraseBars. */
  phraseBars: number;
  /** Bars per cell (call bar(s) then response bar(s)); must divide phraseBars. */
  cellBars: number;
  /** MIDI range [lo, hi] the call is fitted into. */
  callRegister: [number, number];
  /** MIDI range [lo, hi] the response is fitted into: low, dominant. */
  responseRegister: [number, number];
  /** Onset-grid templates for the call, weighted. */
  callCells: CallCell[];
  /** Minimum silence enforced at each voice's cell tail. */
  restMinBeats: number;
  /** [min, max] gap in beats between call end and response entry. */
  responseDelayBeats: [number, number];
  /** Eligible response recipes for this style (default: all five, core-defined). */
  responseRecipes: ResponseRecipeName[];
  /** Semitone-above-root set the response may end on (e.g. [0, 7] = tonic/fifth). */
  resolveDegrees: number[];
  /** Per-phraseBars evolution plan; bars not covered default to "state". */
  evolution: EvolutionStep[];
  /** What happens on the last bar of each phraseBars unit. */
  turnaround: TurnaroundKind;
}

const TOP_LEVEL_KEYS = new Set([
  "name",
  "family",
  "phraseBars",
  "cellBars",
  "callRegister",
  "responseRegister",
  "callCells",
  "restMinBeats",
  "responseDelayBeats",
  "responseRecipes",
  "resolveDegrees",
  "evolution",
  "turnaround",
]);
const CELL_KEYS = new Set(["name", "beats", "lengths", "weight"]);
const EVOLUTION_KEYS = new Set(["bars", "action"]);
const VALID_ACTIONS: readonly EvolutionAction[] = ["state", "vary-call"];
const VALID_TURNAROUNDS: readonly TurnaroundKind[] = ["drop-response", "extra-rest", "none"];

const DEFAULT_PHRASE_BARS = 8;
const DEFAULT_CELL_BARS = 2;
const DEFAULT_CALL_REGISTER: [number, number] = [67, 81];
const DEFAULT_RESPONSE_REGISTER: [number, number] = [24, 43];
const DEFAULT_REST_MIN_BEATS = 1.0;
const DEFAULT_RESPONSE_DELAY: [number, number] = [2.0, 4.0];
const DEFAULT_RESOLVE_DEGREES = [0, 7];
const DEFAULT_EVOLUTION: EvolutionStep[] = [
  { bars: [1, 4], action: "state" },
  { bars: [5, 8], action: "vary-call" },
];
const DEFAULT_TURNAROUND: TurnaroundKind = "drop-response";

function fail(message: string): never {
  throw new Error(`phrase spec: ${message}`);
}

function checkMidiRange(value: unknown, field: string): [number, number] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof value[0] !== "number" ||
    typeof value[1] !== "number" ||
    Number.isNaN(value[0]) ||
    Number.isNaN(value[1]) ||
    value[0] < 0 ||
    value[1] > 127 ||
    value[0] > value[1]
  ) {
    fail(`"${field}" must be [lo, hi] with 0 <= lo <= hi <= 127 (got ${JSON.stringify(value)})`);
  }
  return [value[0], value[1]];
}

function checkPositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    fail(`"${field}" must be a positive integer (got ${JSON.stringify(value)})`);
  }
  return value;
}

function checkNonNegNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || Number.isNaN(value) || value < 0) {
    fail(`"${field}" must be a non-negative number (got ${JSON.stringify(value)})`);
  }
  return value;
}

function parseCallCells(raw: unknown): CallCell[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    fail(`"callCells" must be a non-empty array`);
  }
  return (raw as unknown[]).map((rawCell, i) => {
    if (rawCell === null || typeof rawCell !== "object" || Array.isArray(rawCell)) {
      fail(`callCells[${i}] must be a mapping with "name", "beats", "lengths"`);
    }
    const cell = rawCell as Record<string, unknown>;
    for (const key of Object.keys(cell)) {
      if (!CELL_KEYS.has(key)) {
        fail(
          `callCells[${i}]: unknown field "${key}" (expected one of ${[...CELL_KEYS].join(", ")})`,
        );
      }
    }
    if (typeof cell.name !== "string" || cell.name.trim() === "") {
      fail(`callCells[${i}]: "name" must be a non-empty string`);
    }
    if (!Array.isArray(cell.beats) || cell.beats.length === 0) {
      fail(`callCells[${i}] ("${cell.name}"): "beats" must be a non-empty array`);
    }
    if (!Array.isArray(cell.lengths) || cell.lengths.length === 0) {
      fail(`callCells[${i}] ("${cell.name}"): "lengths" must be a non-empty array`);
    }
    if (cell.beats.length !== cell.lengths.length) {
      fail(`callCells[${i}] ("${cell.name}"): "beats" and "lengths" must be the same length`);
    }
    const beats = (cell.beats as unknown[]).map((b, j) => {
      if (typeof b !== "number" || Number.isNaN(b) || b < 0) {
        fail(`callCells[${i}] ("${cell.name}"): beats[${j}] must be a number >= 0`);
      }
      return b;
    });
    if (!beats.includes(0)) {
      fail(`callCells[${i}] ("${cell.name}"): beats must include 0 (the cell must anchor beat 1)`);
    }
    const lengths = (cell.lengths as unknown[]).map((l, j) => {
      if (typeof l !== "number" || Number.isNaN(l) || l <= 0) {
        fail(`callCells[${i}] ("${cell.name}"): lengths[${j}] must be a number > 0`);
      }
      return l;
    });
    let weight = 1;
    if (cell.weight !== undefined) {
      if (typeof cell.weight !== "number" || Number.isNaN(cell.weight) || cell.weight <= 0) {
        fail(`callCells[${i}] ("${cell.name}"): "weight" must be a positive number`);
      }
      weight = cell.weight;
    }
    return { name: cell.name, beats, lengths, weight };
  });
}

function parseResponseRecipes(raw: unknown): ResponseRecipeName[] {
  if (raw === undefined) return [...RESPONSE_RECIPE_NAMES];
  if (!Array.isArray(raw) || raw.length === 0) {
    fail(`"responseRecipes" must be a non-empty array`);
  }
  return (raw as unknown[]).map((r, i) => {
    if (typeof r !== "string" || !RESPONSE_RECIPE_NAMES.includes(r as ResponseRecipeName)) {
      fail(
        `responseRecipes[${i}]: unknown value ${JSON.stringify(r)} (expected one of ${RESPONSE_RECIPE_NAMES.join(", ")})`,
      );
    }
    return r as ResponseRecipeName;
  });
}

function parseResolveDegrees(raw: unknown): number[] {
  if (raw === undefined) return [...DEFAULT_RESOLVE_DEGREES];
  if (!Array.isArray(raw) || raw.length === 0) {
    fail(`"resolveDegrees" must be a non-empty array`);
  }
  return (raw as unknown[]).map((d, i) => {
    if (typeof d !== "number" || Number.isNaN(d) || d < 0) {
      fail(`resolveDegrees[${i}] must be a non-negative number (semitones above root)`);
    }
    return d;
  });
}

function parseEvolution(raw: unknown): EvolutionStep[] {
  if (raw === undefined)
    return DEFAULT_EVOLUTION.map((s) => ({
      bars: [...s.bars] as [number, number],
      action: s.action,
    }));
  if (!Array.isArray(raw) || raw.length === 0) {
    fail(`"evolution" must be a non-empty array`);
  }
  return (raw as unknown[]).map((rawStep, i) => {
    if (rawStep === null || typeof rawStep !== "object" || Array.isArray(rawStep)) {
      fail(`evolution[${i}] must be a mapping with "bars" and "action"`);
    }
    const step = rawStep as Record<string, unknown>;
    for (const key of Object.keys(step)) {
      if (!EVOLUTION_KEYS.has(key)) {
        fail(`evolution[${i}]: unknown field "${key}" (expected "bars" or "action")`);
      }
    }
    if (
      !Array.isArray(step.bars) ||
      step.bars.length !== 2 ||
      typeof step.bars[0] !== "number" ||
      typeof step.bars[1] !== "number" ||
      !Number.isInteger(step.bars[0]) ||
      !Number.isInteger(step.bars[1]) ||
      step.bars[0] < 1 ||
      step.bars[1] < step.bars[0]
    ) {
      fail(
        `evolution[${i}]: "bars" must be [a, b] with integers 1 <= a <= b (got ${JSON.stringify(step.bars)})`,
      );
    }
    if (
      typeof step.action !== "string" ||
      !VALID_ACTIONS.includes(step.action as EvolutionAction)
    ) {
      fail(
        `evolution[${i}]: unknown action ${JSON.stringify(step.action)} (expected ${VALID_ACTIONS.join(" or ")})`,
      );
    }
    return {
      bars: [step.bars[0], step.bars[1]] as [number, number],
      action: step.action as EvolutionAction,
    };
  });
}

/**
 * Parse and validate a PhraseSpec from a YAML document. Rejects unknown
 * top-level (and nested) keys so hand-written data catches typos instead of
 * silently ignoring a misspelled field, like parseDrumStyleSpec
 * (../drums/styleSpec.ts).
 */
export function parsePhraseSpec(yamlText: string): PhraseSpec {
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
  if (raw.family !== "call-response") {
    fail(`"family" must be "call-response" (got ${JSON.stringify(raw.family)})`);
  }

  const phraseBars = checkPositiveInt(raw.phraseBars, "phraseBars") ?? DEFAULT_PHRASE_BARS;
  const cellBars = checkPositiveInt(raw.cellBars, "cellBars") ?? DEFAULT_CELL_BARS;
  if (phraseBars % cellBars !== 0) {
    fail(`"phraseBars" (${phraseBars}) must be a whole multiple of "cellBars" (${cellBars})`);
  }

  const callRegister = checkMidiRange(raw.callRegister, "callRegister") ?? DEFAULT_CALL_REGISTER;
  const responseRegister =
    checkMidiRange(raw.responseRegister, "responseRegister") ?? DEFAULT_RESPONSE_REGISTER;
  const callCells = parseCallCells(raw.callCells);
  const restMinBeats =
    checkNonNegNumber(raw.restMinBeats, "restMinBeats") ?? DEFAULT_REST_MIN_BEATS;

  let responseDelayBeats: [number, number] = DEFAULT_RESPONSE_DELAY;
  if (raw.responseDelayBeats !== undefined) {
    const v = raw.responseDelayBeats;
    if (
      !Array.isArray(v) ||
      v.length !== 2 ||
      typeof v[0] !== "number" ||
      typeof v[1] !== "number" ||
      Number.isNaN(v[0]) ||
      Number.isNaN(v[1]) ||
      v[0] < 0 ||
      v[1] < v[0]
    ) {
      fail(
        `"responseDelayBeats" must be [min, max] with 0 <= min <= max (got ${JSON.stringify(v)})`,
      );
    }
    responseDelayBeats = [v[0], v[1]];
  }

  const responseRecipes = parseResponseRecipes(raw.responseRecipes);
  const resolveDegrees = parseResolveDegrees(raw.resolveDegrees);
  const evolution = parseEvolution(raw.evolution);
  for (const step of evolution) {
    if (step.bars[1] > phraseBars) {
      fail(`evolution step bars ${JSON.stringify(step.bars)} exceeds phraseBars (${phraseBars})`);
    }
  }

  let turnaround: TurnaroundKind = DEFAULT_TURNAROUND;
  if (raw.turnaround !== undefined) {
    if (
      typeof raw.turnaround !== "string" ||
      !VALID_TURNAROUNDS.includes(raw.turnaround as TurnaroundKind)
    ) {
      fail(
        `"turnaround" must be one of ${VALID_TURNAROUNDS.join(", ")} (got ${JSON.stringify(raw.turnaround)})`,
      );
    }
    turnaround = raw.turnaround as TurnaroundKind;
  }

  return {
    name: raw.name,
    family: "call-response",
    phraseBars,
    cellBars,
    callRegister,
    responseRegister,
    callCells,
    restMinBeats,
    responseDelayBeats,
    responseRecipes,
    resolveDegrees,
    evolution,
    turnaround,
  };
}

/**
 * The built-in "bass-music-cr" style: the example spec from
 * docs/design/phrase-engine.md, verbatim.
 */
export const BASS_MUSIC_CR_SPEC: PhraseSpec = {
  name: "bass-music-cr",
  family: "call-response",
  phraseBars: 8,
  cellBars: 2,
  callRegister: [67, 81],
  responseRegister: [24, 43],
  callCells: [
    { name: "ask-2", beats: [0, 1.0], lengths: [0.5, 1.0], weight: 3 },
    { name: "ask-3", beats: [0, 0.75, 1.5], lengths: [0.5, 0.25, 1.0], weight: 2 },
    { name: "one-stab", beats: [0], lengths: [0.5], weight: 1 },
  ],
  restMinBeats: 1.0,
  responseDelayBeats: [2.0, 4.0],
  responseRecipes: [...RESPONSE_RECIPE_NAMES],
  resolveDegrees: [0, 7],
  evolution: [
    { bars: [1, 4], action: "state" },
    { bars: [5, 8], action: "vary-call" },
  ],
  turnaround: "drop-response",
};

/** Built-in phrase style names (currently just the one). */
export function listPhraseStyles(): string[] {
  return ["bass-music-cr"];
}

/** Named call-cell variants a spec offers (variant-listable like drums). */
export function listPhraseVariants(spec: PhraseSpec): string[] {
  return spec.callCells.map((c) => c.name);
}
