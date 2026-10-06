/**
 * EndlessSpec: the per-song `endless.yaml` project file that drives
 * `awh endless build` (see docs/design/endless-player.md). Same
 * typo-rejecting/unknown-key-rejecting YAML conventions as PhraseSpec
 * (../phrase/spec.ts) and DrumStyleSpec (../drums/styleSpec.ts): a
 * hand-written spec catches a misspelled field instead of silently
 * ignoring it.
 *
 * `parseEndlessSpec` does structural parsing/validation only (types,
 * ranges, unknown keys, internal cross-references like transitions ->
 * to a known section, pools -> a known layer). It does not touch the
 * filesystem. `validateEndlessSpec` runs the two graph/pool checks that
 * are pure functions of the parsed spec (reachability, empty pools) and
 * returns every problem found (not just the first) so the CLI can report
 * everything loudly in one pass. Per-file existence and audio-duration
 * checks need to open the actual WAV files, so those live in the CLI's
 * `endless build` command (packages/cli/src/endless/build.ts), which
 * calls `validateEndlessSpec` first and folds its own file-level errors
 * into the same "every problem, before any output" report.
 */
import { parse as parseYaml } from "yaml";

export interface EndlessLayerFluctuate {
  /** [lowHz, highHz] the layer's biquad lowpass cutoff wanders between. */
  filterHz: [number, number];
}

export interface EndlessLayer {
  id: string;
  gainDb: number;
  fluctuate?: EndlessLayerFluctuate;
}

export interface EndlessSection {
  id: string;
  bars: number;
  /** layerId -> variant audio file paths (relative to the spec file). A
   * layer with no entry here is silent for this section; an entry present
   * but empty is a build-time error (zero-variant pool), not silence. */
  pools: Record<string, string[]>;
  /** 0..1 per-layer chance of a one-layer thin-out mute this section (not
   * cumulative across layers; each non-protected layer with a pool here
   * rolls independently). Default 0. */
  layerMuteProbability: number;
}

export interface EndlessTransitionEdge {
  to: string;
  weight: number;
}

export interface EndlessRules {
  /** A pool variant can't repeat within its own last N picks. */
  noRepeatVariant: number;
  /** The same section can't play more than N times in a row. */
  maxConsecutive: number;
  /** Layer ids exempt from `layerMuteProbability`. */
  protectedLayers: string[];
}

export interface EndlessFluctuation {
  /** +-bound in dB for the per-layer slow gain random walk. */
  gainWalkDb: number;
}

export interface EndlessSpec {
  name: string;
  bpm: number;
  /** "4/4" only (validated literally), like the other engines. */
  sig: "4/4";
  /** 0/absent = fresh random seed each load; N = reproducible performance. */
  seed: number;
  crossfadeMs: number;
  layers: EndlessLayer[];
  sections: EndlessSection[];
  /** sectionId -> weighted outgoing edges. A section absent here (or with
   * an empty edge list) has no outgoing edges. The player self-loops on
   * it rather than crash (see player.js `pickNextSection`). A section with
   * zero declared edges still passes reachability as long as something
   * else transitions into it; the player-level self-loop is a runtime safety net, not something
   * validation should encourage authors to rely on. */
  transitions: Record<string, EndlessTransitionEdge[]>;
  rules: EndlessRules;
  fluctuation: EndlessFluctuation;
}

const TOP_LEVEL_KEYS = new Set([
  "name",
  "bpm",
  "sig",
  "seed",
  "crossfadeMs",
  "layers",
  "sections",
  "transitions",
  "rules",
  "fluctuation",
]);
const LAYER_KEYS = new Set(["id", "gainDb", "fluctuate"]);
const FLUCTUATE_KEYS = new Set(["filterHz"]);
const SECTION_KEYS = new Set(["id", "bars", "pools", "layerMuteProbability"]);
const EDGE_KEYS = new Set(["to", "weight"]);
const RULES_KEYS = new Set(["noRepeatVariant", "maxConsecutive", "protectedLayers"]);
const FLUCTUATION_KEYS = new Set(["gainWalkDb"]);

const DEFAULT_SEED = 0;
const DEFAULT_CROSSFADE_MS = 80;
const DEFAULT_LAYER_MUTE_PROBABILITY = 0;
const DEFAULT_NO_REPEAT_VARIANT = 2;
const DEFAULT_MAX_CONSECUTIVE = 2;
const DEFAULT_GAIN_WALK_DB = 1.5;

function fail(message: string): never {
  throw new Error(`endless spec: ${message}`);
}

function checkUnknownKeys(obj: Record<string, unknown>, allowed: Set<string>, where: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      fail(`${where}: unknown field "${key}" (expected one of ${[...allowed].join(", ")})`);
    }
  }
}

function asPlainObject(value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${where} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function parseLayers(raw: unknown): EndlessLayer[] {
  if (!Array.isArray(raw) || raw.length === 0) fail(`"layers" must be a non-empty array`);
  const seen = new Set<string>();
  return raw.map((rawLayer, i) => {
    const layer = asPlainObject(rawLayer, `layers[${i}]`);
    checkUnknownKeys(layer, LAYER_KEYS, `layers[${i}]`);
    if (typeof layer.id !== "string" || layer.id.trim() === "") {
      fail(`layers[${i}]: "id" must be a non-empty string`);
    }
    if (seen.has(layer.id)) fail(`layers[${i}]: duplicate layer id "${layer.id}"`);
    seen.add(layer.id);
    if (typeof layer.gainDb !== "number" || Number.isNaN(layer.gainDb)) {
      fail(`layers[${i}] ("${layer.id}"): "gainDb" must be a number`);
    }
    let fluctuate: EndlessLayerFluctuate | undefined;
    if (layer.fluctuate !== undefined) {
      const f = asPlainObject(layer.fluctuate, `layers[${i}] ("${layer.id}").fluctuate`);
      checkUnknownKeys(f, FLUCTUATE_KEYS, `layers[${i}] ("${layer.id}").fluctuate`);
      const hz = f.filterHz;
      if (
        !Array.isArray(hz) ||
        hz.length !== 2 ||
        typeof hz[0] !== "number" ||
        typeof hz[1] !== "number" ||
        hz[0] <= 0 ||
        hz[1] <= hz[0]
      ) {
        fail(
          `layers[${i}] ("${layer.id}").fluctuate.filterHz must be [lowHz, highHz] with 0 < low < high (got ${JSON.stringify(hz)})`,
        );
      }
      fluctuate = { filterHz: [hz[0], hz[1]] };
    }
    return { id: layer.id, gainDb: layer.gainDb, ...(fluctuate ? { fluctuate } : {}) };
  });
}

function parsePools(raw: unknown, where: string, layerIds: Set<string>): Record<string, string[]> {
  const obj = asPlainObject(raw, `${where}.pools`);
  const pools: Record<string, string[]> = {};
  for (const [layerId, filesRaw] of Object.entries(obj)) {
    if (!layerIds.has(layerId)) {
      fail(`${where}.pools: "${layerId}" is not a declared layer id (typo? check "layers")`);
    }
    if (!Array.isArray(filesRaw)) {
      fail(`${where}.pools.${layerId} must be an array of file paths`);
    }
    pools[layerId] = filesRaw.map((f, j) => {
      if (typeof f !== "string" || f.trim() === "") {
        fail(`${where}.pools.${layerId}[${j}] must be a non-empty file path string`);
      }
      return f;
    });
  }
  return pools;
}

function parseSections(raw: unknown, layerIds: Set<string>): EndlessSection[] {
  if (!Array.isArray(raw) || raw.length === 0) fail(`"sections" must be a non-empty array`);
  const seen = new Set<string>();
  return raw.map((rawSection, i) => {
    const section = asPlainObject(rawSection, `sections[${i}]`);
    checkUnknownKeys(section, SECTION_KEYS, `sections[${i}]`);
    if (typeof section.id !== "string" || section.id.trim() === "") {
      fail(`sections[${i}]: "id" must be a non-empty string`);
    }
    if (seen.has(section.id)) fail(`sections[${i}]: duplicate section id "${section.id}"`);
    seen.add(section.id);
    if (typeof section.bars !== "number" || !Number.isInteger(section.bars) || section.bars < 1) {
      fail(`sections[${i}] ("${section.id}"): "bars" must be a positive integer`);
    }
    if (section.pools === undefined) fail(`sections[${i}] ("${section.id}"): "pools" is required`);
    const pools = parsePools(section.pools, `sections[${i}] ("${section.id}")`, layerIds);
    let layerMuteProbability = DEFAULT_LAYER_MUTE_PROBABILITY;
    if (section.layerMuteProbability !== undefined) {
      if (
        typeof section.layerMuteProbability !== "number" ||
        Number.isNaN(section.layerMuteProbability) ||
        section.layerMuteProbability < 0 ||
        section.layerMuteProbability > 1
      ) {
        fail(`sections[${i}] ("${section.id}"): "layerMuteProbability" must be a number in [0, 1]`);
      }
      layerMuteProbability = section.layerMuteProbability;
    }
    return { id: section.id, bars: section.bars, pools, layerMuteProbability };
  });
}

function parseTransitions(raw: unknown, sectionIds: Set<string>): Record<string, EndlessTransitionEdge[]> {
  const obj = asPlainObject(raw, `"transitions"`);
  const transitions: Record<string, EndlessTransitionEdge[]> = {};
  for (const [fromId, edgesRaw] of Object.entries(obj)) {
    if (!sectionIds.has(fromId)) {
      fail(`transitions: "${fromId}" is not a declared section id (typo? check "sections")`);
    }
    if (!Array.isArray(edgesRaw)) fail(`transitions.${fromId} must be an array of {to, weight}`);
    transitions[fromId] = edgesRaw.map((rawEdge, j) => {
      const edge = asPlainObject(rawEdge, `transitions.${fromId}[${j}]`);
      checkUnknownKeys(edge, EDGE_KEYS, `transitions.${fromId}[${j}]`);
      if (typeof edge.to !== "string" || !sectionIds.has(edge.to)) {
        fail(`transitions.${fromId}[${j}]: "to" (${JSON.stringify(edge.to)}) is not a declared section id`);
      }
      if (typeof edge.weight !== "number" || Number.isNaN(edge.weight) || edge.weight <= 0) {
        fail(`transitions.${fromId}[${j}] (-> "${edge.to}"): "weight" must be a positive number`);
      }
      return { to: edge.to, weight: edge.weight };
    });
  }
  return transitions;
}

function parseRules(raw: unknown, layerIds: Set<string>): EndlessRules {
  if (raw === undefined) {
    return {
      noRepeatVariant: DEFAULT_NO_REPEAT_VARIANT,
      maxConsecutive: DEFAULT_MAX_CONSECUTIVE,
      protectedLayers: [],
    };
  }
  const obj = asPlainObject(raw, `"rules"`);
  checkUnknownKeys(obj, RULES_KEYS, `"rules"`);
  let noRepeatVariant = DEFAULT_NO_REPEAT_VARIANT;
  if (obj.noRepeatVariant !== undefined) {
    if (typeof obj.noRepeatVariant !== "number" || !Number.isInteger(obj.noRepeatVariant) || obj.noRepeatVariant < 0) {
      fail(`rules.noRepeatVariant must be a non-negative integer`);
    }
    noRepeatVariant = obj.noRepeatVariant;
  }
  let maxConsecutive = DEFAULT_MAX_CONSECUTIVE;
  if (obj.maxConsecutive !== undefined) {
    if (typeof obj.maxConsecutive !== "number" || !Number.isInteger(obj.maxConsecutive) || obj.maxConsecutive < 1) {
      fail(`rules.maxConsecutive must be a positive integer`);
    }
    maxConsecutive = obj.maxConsecutive;
  }
  let protectedLayers: string[] = [];
  if (obj.protectedLayers !== undefined) {
    if (!Array.isArray(obj.protectedLayers)) fail(`rules.protectedLayers must be an array of layer ids`);
    protectedLayers = obj.protectedLayers.map((id, i) => {
      if (typeof id !== "string" || !layerIds.has(id)) {
        fail(`rules.protectedLayers[${i}]: "${id}" is not a declared layer id`);
      }
      return id;
    });
  }
  return { noRepeatVariant, maxConsecutive, protectedLayers };
}

function parseFluctuation(raw: unknown): EndlessFluctuation {
  if (raw === undefined) return { gainWalkDb: DEFAULT_GAIN_WALK_DB };
  const obj = asPlainObject(raw, `"fluctuation"`);
  checkUnknownKeys(obj, FLUCTUATION_KEYS, `"fluctuation"`);
  let gainWalkDb = DEFAULT_GAIN_WALK_DB;
  if (obj.gainWalkDb !== undefined) {
    if (typeof obj.gainWalkDb !== "number" || Number.isNaN(obj.gainWalkDb) || obj.gainWalkDb < 0) {
      fail(`fluctuation.gainWalkDb must be a non-negative number`);
    }
    gainWalkDb = obj.gainWalkDb;
  }
  return { gainWalkDb };
}

/**
 * Parse and structurally validate an EndlessSpec from a YAML document.
 * Rejects unknown top-level (and nested) keys, and rejects any internal
 * cross-reference to an undeclared layer/section id, as typo checks like
 * parsePhraseSpec/parseDrumStyleSpec. Does not touch the filesystem or
 * check graph reachability/empty pools; see `validateEndlessSpec` for
 * those.
 */
export function parseEndlessSpec(yamlText: string): EndlessSpec {
  const doc = parseYaml(yamlText);
  const raw = asPlainObject(doc, "expected a YAML mapping at the top level");
  checkUnknownKeys(raw, TOP_LEVEL_KEYS, "top level");

  if (typeof raw.name !== "string" || raw.name.trim() === "") {
    fail(`"name" must be a non-empty string`);
  }
  if (typeof raw.bpm !== "number" || !Number.isFinite(raw.bpm) || raw.bpm <= 0) {
    fail(`"bpm" must be a positive number (got ${JSON.stringify(raw.bpm)})`);
  }
  if (raw.sig !== undefined && raw.sig !== "4/4") {
    fail(`"sig" must be "4/4" (v1 only; got ${JSON.stringify(raw.sig)})`);
  }
  let seed = DEFAULT_SEED;
  if (raw.seed !== undefined) {
    if (typeof raw.seed !== "number" || !Number.isInteger(raw.seed) || raw.seed < 0) {
      fail(`"seed" must be a non-negative integer (0 = random each load)`);
    }
    seed = raw.seed;
  }
  let crossfadeMs = DEFAULT_CROSSFADE_MS;
  if (raw.crossfadeMs !== undefined) {
    if (typeof raw.crossfadeMs !== "number" || Number.isNaN(raw.crossfadeMs) || raw.crossfadeMs < 0) {
      fail(`"crossfadeMs" must be a non-negative number`);
    }
    crossfadeMs = raw.crossfadeMs;
  }

  const layers = parseLayers(raw.layers);
  const layerIds = new Set(layers.map((l) => l.id));
  const sections = parseSections(raw.sections, layerIds);
  const sectionIds = new Set(sections.map((s) => s.id));
  const transitions =
    raw.transitions === undefined ? {} : parseTransitions(raw.transitions, sectionIds);
  const rules = parseRules(raw.rules, layerIds);
  const fluctuation = parseFluctuation(raw.fluctuation);

  return {
    name: raw.name,
    bpm: raw.bpm,
    sig: "4/4",
    seed,
    crossfadeMs,
    layers,
    sections,
    transitions,
    rules,
    fluctuation,
  };
}

/**
 * Pure post-parse checks that don't need the filesystem: every section
 * must be reachable in the transition graph (from the first section,
 * which is the performance's entry point), and every pool a section
 * declares must have at least one variant. Returns every problem found
 * (not just the first) so `awh endless build` can report the whole list
 * in one loud pass before writing anything (per docs/lessons-learned.md:
 * validate before write, loud failures before partial output).
 */
export function validateEndlessSpec(spec: EndlessSpec): string[] {
  const problems: string[] = [];

  // Empty pools: a pool key present with zero variants.
  for (const section of spec.sections) {
    for (const [layerId, files] of Object.entries(section.pools)) {
      if (files.length === 0) {
        problems.push(
          `section "${section.id}", layer "${layerId}": pool is empty (zero variants) — ` +
            `either add at least one audio file or remove the "${layerId}" key from this section's pools`,
        );
      }
    }
  }

  // Reachability: BFS from the entry section (sections[0]) over transitions.
  const entry = spec.sections[0];
  if (entry) {
    const reached = new Set<string>([entry.id]);
    const queue: string[] = [entry.id];
    while (queue.length > 0) {
      const from = queue.shift()!;
      for (const edge of spec.transitions[from] ?? []) {
        if (!reached.has(edge.to)) {
          reached.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    for (const section of spec.sections) {
      if (!reached.has(section.id)) {
        problems.push(
          `section "${section.id}" is unreachable — no path from the entry section ` +
            `"${entry.id}" reaches it via "transitions" (stranded section)`,
        );
      }
    }
  }

  return problems;
}
