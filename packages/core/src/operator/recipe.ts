/**
 * Operator assistant: OperatorRecipe format, sibling to PhraseSpec
 * (../phrase/spec.ts) and DrumStyleSpec (../drums/styleSpec.ts), with the
 * same parsing conventions (unknown top-level keys rejected).
 *
 * A recipe lives inside an `operator-recipe-<name>` knowledge entry as a
 * ```awh-operator-patch``` fenced YAML block (extractFencedBlock, see
 * ../knowledge/entry.ts). See docs/design/operator-assistant.md:
 *
 *   name: growl-bass
 *   device: Operator
 *   params:                 # raw device.get/device.param values (0..1 etc)
 *     Algorithm: 0.09        # comment each with the display intent
 *     "Osc-A Coarse": 0.5
 *   playNotes: "1|1 F1 1 v110"   # optional audition phrase
 *
 * Raw values are the known gap (see knowledge/setup/
 * compressor-raw-display-mapping.md): this module only validates shape
 * (every param a finite number), never the values themselves. Whether a
 * given raw number is verified against the real device is a property of
 * the knowledge entry (tier + prose), not of the parser.
 */
import { parse as parseYaml } from "yaml";

export interface OperatorRecipe {
  /** Recipe id (matches the knowledge entry's slug suffix, not enforced here). */
  name: string;
  /** Target device name; "Operator" for this recipe format. */
  device: string;
  /** Raw device.get/device.param values, keyed by exact param name. */
  params: Record<string, number>;
  /** Optional bar|beat audition phrase (see notation/barbeat.ts). */
  playNotes?: string;
}

const TOP_LEVEL_KEYS = new Set(["name", "device", "params", "playNotes"]);

function fail(message: string): never {
  throw new Error(`operator recipe: ${message}`);
}

/**
 * Parse and validate an OperatorRecipe from a YAML document (the
 * ```awh-operator-patch``` block's raw text). Rejects unknown top-level
 * keys and non-numeric param values so a hand-authored recipe catches typos
 * instead of silently producing a patch that writes nothing (or the wrong
 * thing), like parsePhraseSpec/parseDrumStyleSpec.
 */
export function parseOperatorRecipe(yamlText: string): OperatorRecipe {
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
  if (typeof raw.device !== "string" || raw.device.trim() === "") {
    fail(`"device" must be a non-empty string (got ${JSON.stringify(raw.device)})`);
  }

  if (raw.params === null || typeof raw.params !== "object" || Array.isArray(raw.params)) {
    fail(`"params" must be a mapping of param name -> raw number`);
  }
  const paramsRaw = raw.params as Record<string, unknown>;
  const paramNames = Object.keys(paramsRaw);
  if (paramNames.length === 0) {
    fail(`"params" must have at least one entry`);
  }
  const params: Record<string, number> = {};
  for (const name of paramNames) {
    const value = paramsRaw[name];
    if (typeof value !== "number" || Number.isNaN(value)) {
      fail(`params["${name}"] must be a number (got ${JSON.stringify(value)})`);
    }
    params[name] = value;
  }

  let playNotes: string | undefined;
  if (raw.playNotes !== undefined) {
    if (typeof raw.playNotes !== "string" || raw.playNotes.trim() === "") {
      fail(`"playNotes" must be a non-empty string (got ${JSON.stringify(raw.playNotes)})`);
    }
    playNotes = raw.playNotes;
  }

  return {
    name: raw.name,
    device: raw.device,
    params,
    ...(playNotes !== undefined ? { playNotes } : {}),
  };
}
