import type { NoteSpec } from "../bridge/types.js";
import { numParam, sortNotes, strParam, type TransformDef } from "./types.js";

/**
 * `ratchet` transform: subdivides selected notes into equal repeats (same
 * pitch/velocity, gate divided so subdivisions never overlap). The
 * transform-registry sibling of the arp engine's ratchets field, so
 * `awh vary` can ratchet any clip, not just arp output.
 *
 * Params:
 *  - steps: which notes to ratchet, by their rounded position on a `grid`
 *    (beats, default 0.25 = 16th): a "+"-separated list of step indices
 *    (commas already separate pipeline params, see registry.ts), or the
 *    string "all" (default) for every note.
 *  - count: subdivisions per selected note (2, 3, or 4; default 3).
 *  - gate: fraction of each sub-slot that sounds (0-1, default 0.5).
 *  - grid: step size in beats used to map note starts to positions when
 *    `steps` isn't "all" (default 0.25).
 */
export const ratchet: TransformDef = {
  name: "ratchet",
  description:
    'Subdivide selected notes into equal repeats (gate divided, no overlap). Params: steps ("all", default, ' +
    'or a "+"-separated list of grid-step positions, e.g. "0+4+8"), count (2/3/4, default 3), gate (0-1, default 0.5), ' +
    'grid (beats, default 0.25 — used to map note starts to positions when steps isn\'t "all").',
  make(params) {
    const stepsRaw = strParam(params, "steps", "all");
    const count = numParam(params, "count", 3, { min: 2, max: 4 });
    if (!Number.isInteger(count)) {
      throw new Error(`ratchet: "count" must be 2, 3, or 4 (got ${count})`);
    }
    const gate = numParam(params, "gate", 0.5, { min: 0, max: 1 });
    const grid = numParam(params, "grid", 0.25, { min: 0.0625, max: 4 });

    const all = stepsRaw === "all";
    const steps = all
      ? new Set<number>()
      : new Set(
          stepsRaw
            .split("+")
            .filter(Boolean)
            .map((s) => {
              const n = Number(s);
              if (!Number.isInteger(n) || n < 0) {
                throw new Error(
                  `ratchet: "steps" entries must be non-negative integers (got "${s}")`,
                );
              }
              return n;
            }),
        );

    return (notes) => {
      const out: NoteSpec[] = [];
      for (const n of notes) {
        const position = Math.round(n.start / grid);
        if (!all && !steps.has(position)) {
          out.push(n);
          continue;
        }
        const subSlot = n.duration / count;
        for (let r = 0; r < count; r++) {
          out.push({ ...n, start: n.start + r * subSlot, duration: subSlot * gate });
        }
      }
      return sortNotes(out);
    };
  },
};

export const ratchetTransforms: TransformDef[] = [ratchet];
