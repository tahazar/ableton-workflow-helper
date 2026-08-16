import { BridgeError, type NoteSpec } from "../bridge/types.js";
import { basicTransforms } from "./basic.js";
import type { Params, Transform, TransformContext, TransformDef } from "./types.js";

/**
 * Transform registry + pipeline spec parser.
 *
 * Pipeline spec syntax (whitespace-separated steps):
 *   "transpose-scale:degrees=2 humanize:timing=0.03,velocity=12 retrograde"
 * Each step: name[:key=value,key=value...]. Values parse as number when
 * numeric, true/false as boolean, else string.
 */

const registry = new Map<string, TransformDef>();

export function registerTransform(def: TransformDef): void {
  if (registry.has(def.name)) {
    throw new BridgeError("internal", `duplicate transform "${def.name}"`);
  }
  registry.set(def.name, def);
}

export function listTransforms(): { name: string; description: string }[] {
  return [...registry.values()]
    .map(({ name, description }) => ({ name, description }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface PipelineStep {
  def: TransformDef;
  params: Params;
  transform: Transform;
}

export function parsePipeline(spec: string): PipelineStep[] {
  const steps = spec.trim().split(/\s+/).filter(Boolean);
  if (steps.length === 0) {
    throw new BridgeError("bad_request", "empty transform pipeline");
  }
  return steps.map((step) => {
    const [name, paramText] = step.split(":", 2) as [string, string | undefined];
    const def = registry.get(name);
    if (!def) {
      throw new BridgeError(
        "bad_request",
        `unknown transform "${name}" (known: ${[...registry.keys()].sort().join(", ")})`,
      );
    }
    const params: Params = {};
    if (paramText) {
      for (const pair of paramText.split(",")) {
        const [key, raw] = pair.split("=", 2);
        if (!key || raw === undefined) {
          throw new BridgeError("bad_request", `malformed params in "${step}" (expected key=value)`);
        }
        params[key] =
          raw === "true" ? true : raw === "false" ? false : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
      }
    }
    return { def, params, transform: def.make(params) };
  });
}

export function applyPipeline(
  steps: PipelineStep[],
  notes: NoteSpec[],
  ctx: TransformContext,
): NoteSpec[] {
  return steps.reduce((acc, step) => step.transform(acc, ctx), notes);
}

// -- built-in registrations -------------------------------------------------

for (const def of basicTransforms) registerTransform(def);
