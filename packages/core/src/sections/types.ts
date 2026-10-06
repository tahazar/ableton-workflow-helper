import { BridgeError, type NoteSpec } from "../bridge/types.js";

/**
 * Section specs: the structure language for building an arrangement
 * skeleton from source clips. Parsed from YAML by the CLI; core only sees
 * plain objects. Rendering is pure and seeded: the same spec + sources +
 * seed always produces the same skeleton.
 */

/** What one track does during one section. */
export type LayerDirective =
  | "off"
  | {
      /** Library/source clip path the layer derives from. */
      source: string;
      /** Transform pipeline applied to the source notes (omit = verbatim). */
      ops?: string;
      /** Apply the `fill` transform to the section's final bar. */
      fill?: boolean;
    };

export interface SectionSpec {
  name: string;
  bars: number;
  /** trackName -> directive; trackName resolves via SectionsPlan.trackMap. */
  tracks: Record<string, LayerDirective>;
}

export interface SectionsPlan {
  name: string;
  /** trackName -> track path (e.g. drums -> track:0). */
  trackMap: Record<string, string>;
  sections: SectionSpec[];
}

export interface RenderedClip {
  trackPath: string;
  startBeat: number;
  lengthBeats: number;
  name: string;
  notes: NoteSpec[];
}

// -- validation (CLI passes YAML-parsed unknowns through this) --------------

export function validateSectionsPlan(input: unknown): SectionsPlan {
  const fail = (msg: string): never => {
    throw new BridgeError("bad_request", `sections plan: ${msg}`);
  };
  if (typeof input !== "object" || input === null) fail("must be an object");
  const o = input as Record<string, unknown>;
  const name = typeof o.name === "string" && o.name ? o.name : "skeleton";
  if (typeof o.trackMap !== "object" || o.trackMap === null) {
    fail(`"trackMap" (trackName -> track path) is required`);
  }
  const trackMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(o.trackMap as Record<string, unknown>)) {
    if (typeof value !== "string") fail(`trackMap.${key} must be a track path string`);
    trackMap[key] = value as string;
  }
  if (!Array.isArray(o.sections) || o.sections.length === 0) {
    fail(`"sections" must be a non-empty array`);
  }
  const sections = (o.sections as unknown[]).map((raw, i): SectionSpec => {
    if (typeof raw !== "object" || raw === null) fail(`sections[${i}] must be an object`);
    const s = raw as Record<string, unknown>;
    const sectionName = typeof s.name === "string" && s.name ? s.name : fail(`sections[${i}].name required`);
    const bars = typeof s.bars === "number" && s.bars > 0 && Number.isInteger(s.bars)
      ? s.bars
      : fail(`sections[${i}].bars must be a positive integer`);
    const tracksRaw = typeof s.tracks === "object" && s.tracks !== null ? s.tracks : fail(`sections[${i}].tracks required`);
    const tracks: Record<string, LayerDirective> = {};
    for (const [trackName, directive] of Object.entries(tracksRaw as Record<string, unknown>)) {
      if (!(trackName in trackMap)) {
        fail(`sections[${i}] references unknown track "${trackName}" (not in trackMap)`);
      }
      if (directive === "off" || directive === false || directive === null) {
        tracks[trackName] = "off";
      } else if (typeof directive === "object") {
        const d = directive as Record<string, unknown>;
        if (typeof d.source !== "string" || !d.source) {
          fail(`sections[${i}].tracks.${trackName}.source must be a clip path`);
        }
        tracks[trackName] = {
          source: d.source as string,
          ...(typeof d.ops === "string" && d.ops.trim() !== "" ? { ops: d.ops } : {}),
          ...(d.fill === true ? { fill: true } : {}),
        };
      } else {
        fail(`sections[${i}].tracks.${trackName} must be "off" or {source, ops?, fill?}`);
      }
    }
    return { name: sectionName, bars, tracks };
  });
  return { name, trackMap, sections };
}

/** Tile a phrase to a longer span by repeating it (offset copies). */
export function tileNotes(
  notes: NoteSpec[],
  sourceLengthBeats: number,
  targetLengthBeats: number,
): NoteSpec[] {
  if (sourceLengthBeats <= 0) {
    throw new BridgeError("bad_request", "tileNotes: sourceLengthBeats must be > 0");
  }
  const out: NoteSpec[] = [];
  for (let offset = 0; offset < targetLengthBeats; offset += sourceLengthBeats) {
    for (const n of notes) {
      const start = n.start + offset;
      if (start >= targetLengthBeats) continue;
      out.push({ ...n, start });
    }
  }
  return out;
}
