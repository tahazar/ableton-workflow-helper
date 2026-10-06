/**
 * `awh endless demo`: a tiny synthetic 3-layer song (drums = kick+hat,
 * bass, pads; see synth.ts) with a matching endless.yaml, so the engine is
 * listenable and CI-testable with zero owner assets (docs/design/
 * endless-player.md). It goes through the same `buildEndlessPlayer` path
 * as `awh endless build`, so the demo also passes build validation.
 *
 * Layer count: the design doc's prose mentions a "4-layer song", but its
 * synthesis list names three timbres (kick/hat patterns, bass notes,
 * detuned-sine pads). This demo ships 3 layers, with kick+hat combined
 * into one drums stem the way a drum bus is usually bounced.
 */
import { mkdir, mkdtemp, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeWavPcm16 } from "./wav.js";
import { renderDrumsLoop, renderBassLoop, renderPadsLoop } from "./synth.js";
import { buildEndlessPlayer, type BuildResult } from "./build.js";

const DEMO_BPM = 128;
const SECTIONS = [
  { id: "intro", bars: 2, variants: 2, layerMuteProbability: 0 },
  { id: "drop", bars: 2, variants: 3, layerMuteProbability: 0.2 },
];
const VARIANT_LETTERS = ["a", "b", "c", "d", "e"];

function seedFor(sectionIndex: number, layerIndex: number, variantIndex: number): number {
  return 1000 + sectionIndex * 100 + layerIndex * 17 + variantIndex * 7;
}

function renderLoop(layerId: string, bars: number, seed: number): Int16Array {
  if (layerId === "drums") return renderDrumsLoop(bars, DEMO_BPM, seed);
  if (layerId === "bass") return renderBassLoop(bars, DEMO_BPM, seed);
  if (layerId === "pads") return renderPadsLoop(bars, DEMO_BPM, seed);
  throw new Error(`endless demo: no synth for layer "${layerId}"`); // unreachable with LAYERS below
}

const LAYERS = ["drums", "bass", "pads"] as const;

function demoSpecYaml(poolFiles: Record<string, Record<string, string[]>>): string {
  const sectionsYaml = SECTIONS.map((s) => {
    const poolLines = LAYERS.map((layerId) => {
      const files = poolFiles[s.id]![layerId]!;
      return `      ${layerId}: [${files.map((f) => `"${f}"`).join(", ")}]`;
    }).join("\n");
    const muteLine = s.layerMuteProbability > 0 ? `\n    layerMuteProbability: ${s.layerMuteProbability}` : "";
    return `  - id: ${s.id}\n    bars: ${s.bars}\n    pools:\n${poolLines}${muteLine}`;
  }).join("\n");

  return `# awh endless demo — synthetic song, kick/hat + bass + pads (synth.ts).
# Generated + built in one step by \`awh endless demo\`. Edit freely, or use
# it as a worked example of the endless.yaml format
# (docs/design/endless-player.md).

name: endless-demo
bpm: ${DEMO_BPM}
sig: 4/4
seed: 0
crossfadeMs: 80

layers:
  - {id: drums, gainDb: 0}
  - {id: bass, gainDb: 0}
  - {id: pads, gainDb: -3, fluctuate: {filterHz: [800, 6000]}}

sections:
${sectionsYaml}

transitions:
  intro: [{to: drop, weight: 3}, {to: intro, weight: 1}]
  drop: [{to: intro, weight: 2}, {to: drop, weight: 1}]

rules:
  noRepeatVariant: 2
  maxConsecutive: 2
  protectedLayers: [bass]

fluctuation:
  gainWalkDb: 1.5
`;
}

export interface DemoResult extends BuildResult {
  specPath: string;
}

/** Synthesizes the demo song into a staging dir, writes its endless.yaml,
 * runs it through the real `buildEndlessPlayer`, then copies the spec (and
 * cleans up the staging dir) so `outDir` ends up looking like a normal
 * build output plus the source `endless.yaml` for reference/editing. */
export async function buildEndlessDemo(outDir: string): Promise<DemoResult> {
  const staging = await mkdtemp(join(tmpdir(), "awh-endless-demo-"));
  try {
    await mkdir(join(staging, "audio"), { recursive: true });
    const poolFiles: Record<string, Record<string, string[]>> = {};
    for (let si = 0; si < SECTIONS.length; si++) {
      const section = SECTIONS[si]!;
      poolFiles[section.id] = {};
      for (let li = 0; li < LAYERS.length; li++) {
        const layerId = LAYERS[li]!;
        const files: string[] = [];
        for (let vi = 0; vi < section.variants; vi++) {
          const letter = VARIANT_LETTERS[vi] ?? String(vi);
          const relPath = `audio/${section.id}-${layerId}-${letter}.wav`;
          const seed = seedFor(si, li, vi);
          const samples = renderLoop(layerId, section.bars, seed);
          const wav = writeWavPcm16(samples, 44100, 1);
          await writeFile(join(staging, relPath), wav);
          files.push(relPath);
        }
        poolFiles[section.id]![layerId] = files;
      }
    }
    const specPath = join(staging, "endless.yaml");
    await writeFile(specPath, demoSpecYaml(poolFiles), "utf8");

    const result = await buildEndlessPlayer(specPath, outDir, {});

    const finalSpecPath = join(outDir, "endless.yaml");
    await copyFile(specPath, finalSpecPath);

    return { ...result, files: [...result.files, finalSpecPath], specPath: finalSpecPath };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
