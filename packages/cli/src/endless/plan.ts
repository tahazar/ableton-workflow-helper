/**
 * `awh endless plan`: emits a fully commented `endless.yaml` starter
 * scaffold (docs/design/endless-player.md). Hand-templated (not
 * `yaml.stringify`) so the comments survive, for the same reason the other
 * `plan` commands (`awh sections plan`) produce an editable YAML file to
 * review instead of writing straight to Live.
 *
 * Two sources for the section list (mutually exclusive, like `sections
 * plan --form` / `--from-ref`):
 *  - `--sections "intro:8,drop:16,..."`: bars given directly.
 *  - `--from-ref <name>`: reuses a saved reference record's corrected
 *    section map (`library/references/*.json`, or a `ref sections
 *    read -o <file>` JSON) for bars and bpm, the same file shape `sections
 *    plan --from-ref` reads (`reference.sections` / `.sections`, each
 *    `{name, start_bar, end_bar}`).
 *
 * Layers can't be inferred from either source (a reference's section map
 * says nothing about stem names), so the scaffold always starts with a
 * `drums`/`bass` pair plus a commented-out `pads` example the owner edits
 * to match their actual stems.
 */
import { asciiSlug } from "@awh/core";

export interface PlanSection {
  id: string;
  bars: number;
}

export interface RefSectionLike {
  name: string;
  start_bar: number;
  end_bar: number;
}

/** `--sections "intro:8,build:8,drop:16"` -> [{id, bars}, ...]. */
export function parseSectionsArg(arg: string): PlanSection[] {
  const parts = arg
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length === 0) {
    throw new Error(
      `--sections must list at least one "id:bars" pair (got ${JSON.stringify(arg)})`,
    );
  }
  const seen = new Set<string>();
  return parts.map((part) => {
    const [id, barsStr] = part.split(":", 2);
    const bars = Number(barsStr);
    if (!id || id.trim() === "" || !barsStr || !Number.isInteger(bars) || bars < 1) {
      throw new Error(`--sections: bad entry "${part}" (expected "id:bars", e.g. "intro:8")`);
    }
    if (seen.has(id)) throw new Error(`--sections: duplicate section id "${id}"`);
    seen.add(id);
    return { id, bars };
  });
}

/** Slugify a reference section name into a spec-safe section id. Lenient
 * like `ref sections read` ("don't fix a non-standard name the owner
 * chose"), only constrained to id-safe characters. */
function slugifySectionName(name: string, index: number): string {
  const slug = asciiSlug(name);
  return slug || `section-${index + 1}`;
}

/** Reference sections -> plan sections. `beatsPerBar` matches the timeline
 * convention `sections plan --from-ref` uses (4, v1 sig is 4/4 only). */
export function sectionsFromReference(sections: RefSectionLike[]): PlanSection[] {
  if (sections.length === 0) throw new Error("reference has no sections — nothing to plan from");
  const ids = new Map<string, number>();
  return sections.map((s, i) => {
    let id = slugifySectionName(s.name, i);
    const count = ids.get(id) ?? 0;
    ids.set(id, count + 1);
    if (count > 0) id = `${id}-${count + 1}`;
    const bars = s.end_bar - s.start_bar + 1;
    if (bars < 1) throw new Error(`reference section "${s.name}": end_bar < start_bar`);
    return { id, bars };
  });
}

export interface PlanOptions {
  name: string;
  bpm: number;
  sections: PlanSection[];
}

const STARTER_LAYERS = ["drums", "bass"];

function emptyPoolsBlock(layerIds: string[], indent: string): string {
  return layerIds.map((id) => `${indent}${id}: []`).join("\n");
}

/**
 * Builds the commented YAML text. Transitions default to a simple forward
 * loop through every section in order (s0 -> s1 -> ... -> sN-1 -> s0).
 * Every section is reachable by construction, and the comments mark it as
 * an editable starting point instead of guessing a genre-specific graph
 * shape from a bare section list.
 */
export function buildEndlessPlanYaml(opts: PlanOptions): string {
  const { name, bpm, sections } = opts;
  const sectionsYaml = sections
    .map((s, i) => {
      const lines = [
        `  - id: ${s.id}`,
        `    bars: ${s.bars}`,
        `    pools:`,
        emptyPoolsBlock(STARTER_LAYERS, "      "),
      ];
      if (i === sections.length - 1) {
        lines.push(
          `    # layerMuteProbability: 0.15   # occasional one-layer thin-out, uncomment to use`,
        );
      }
      return lines.join("\n");
    })
    .join("\n");

  const transitionsYaml = sections
    .map((s, i) => {
      const next = sections[(i + 1) % sections.length]!;
      return `  ${s.id}: [{to: ${next.id}, weight: 1}]`;
    })
    .join("\n");

  return `# ${name} — endless.yaml
# Starter scaffold from \`awh endless plan\`. Fill in the pools (audio file
# paths, relative to this file) and edit anything else — this is a review
# step, not a finished spec. Full format: docs/design/endless-player.md.
#
# Once every pool has at least one file and the durations are bar-exact:
#   awh endless build ${name}.yaml -o dist/${name}

name: ${name}
bpm: ${bpm}                 # fill in your song's real tempo if this is a placeholder
sig: 4/4                    # v1: 4/4 only
seed: 0                     # 0 = fresh random performance each load; N = reproducible
crossfadeMs: 80              # equal-power fade at section boundaries, in ms

# Logical stems — one entry per instrument/stem group you'll bounce
# separately. gainDb is a static trim. fluctuate.filterHz (optional) makes
# that layer's lowpass cutoff wander slowly between the two Hz values, for
# continuous mix movement over a long performance.
layers:
  - {id: drums, gainDb: 0}
  - {id: bass, gainDb: 0}
  # - {id: pads, gainDb: -3, fluctuate: {filterHz: [800, 8000]}}

sections:
${sectionsYaml}

# Weighted digraph: what can follow what. EVERY section must stay reachable
# from the first one above (\`awh endless build\` rejects a stranded
# section) — this starter is a simple forward loop through every section in
# order; add branches/self-loops/weights to taste (e.g. a drop repeating
# itself, or skipping the break sometimes).
transitions:
${transitionsYaml}

rules:
  noRepeatVariant: 2          # a variant can't repeat within its pool's last N picks
  maxConsecutive: 2           # same section at most N times in a row
  protectedLayers: [bass]     # never muted by layerMuteProbability

fluctuation:
  gainWalkDb: 1.5              # +-bound in dB per layer, slow continuous random walk
`;
}
