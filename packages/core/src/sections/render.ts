import { BridgeError, type NoteSpec } from "../bridge/types.js";
import { makeRng, variantSeed } from "../transforms/rng.js";
import { applyPipeline, parsePipeline } from "../transforms/registry.js";
import type { ScaleContext, TransformContext } from "../transforms/types.js";
import { tileNotes, type RenderedClip, type SectionsPlan } from "./types.js";

export interface SourceClip {
  notes: NoteSpec[];
  lengthBeats: number;
}

export interface RenderOptions {
  /** 1-based bar the skeleton starts at. Default 1. */
  atBar?: number;
  beatsPerBar?: number;
  seed?: number;
  scale?: ScaleContext;
}

/**
 * Render a sections plan into concrete clip-create instructions.
 * PURE: sources are provided as a map (the CLI fetches them via the gateway);
 * all randomness is seeded per (section, track) so re-rendering the same plan
 * reproduces the same skeleton exactly.
 *
 * Per layer: source notes -> transform pipeline (seeded) -> tiled to the
 * section span -> optional `fill` transform on the final bar. One clip per
 * (section x active track), named "<section>-<trackName>".
 */
export function renderSections(
  plan: SectionsPlan,
  sources: Map<string, SourceClip>,
  options: RenderOptions = {},
): { clips: RenderedClip[]; totalBars: number } {
  const beatsPerBar = options.beatsPerBar ?? 4;
  const baseSeed = options.seed ?? 1;
  const startBeatOffset = ((options.atBar ?? 1) - 1) * beatsPerBar;

  const clips: RenderedClip[] = [];
  let cursorBeats = startBeatOffset;

  plan.sections.forEach((section, sectionIndex) => {
    const sectionLength = section.bars * beatsPerBar;
    const trackNames = Object.keys(section.tracks).sort();

    trackNames.forEach((trackName, trackIndex) => {
      const directive = section.tracks[trackName]!;
      if (directive === "off") return;

      const source = sources.get(directive.source);
      if (!source) {
        throw new BridgeError(
          "bad_request",
          `section "${section.name}" track "${trackName}": source ${directive.source} was not fetched`,
        );
      }

      const ctx: TransformContext = {
        lengthBeats: source.lengthBeats,
        beatsPerBar,
        rng: makeRng(variantSeed(baseSeed, sectionIndex * 97 + trackIndex + 1)),
        ...(options.scale ? { scale: options.scale } : {}),
      };

      let notes = directive.ops
        ? applyPipeline(parsePipeline(directive.ops), source.notes, ctx)
        : [...source.notes];
      notes = tileNotes(notes, source.lengthBeats, sectionLength);

      if (directive.fill) {
        const fillCtx: TransformContext = { ...ctx, lengthBeats: sectionLength };
        notes = applyPipeline(parsePipeline("fill"), notes, fillCtx);
      }

      clips.push({
        trackPath: plan.trackMap[trackName]!,
        startBeat: cursorBeats,
        lengthBeats: sectionLength,
        name: `${section.name}-${trackName}`,
        notes,
      });
    });

    cursorBeats += sectionLength;
  });

  return {
    clips,
    totalBars: (cursorBeats - startBeatOffset) / beatsPerBar,
  };
}
