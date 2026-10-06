import { BridgeError } from "../bridge/types.js";
import type { SectionsPlan } from "./types.js";

/**
 * Genre form presets: opinionated starting arrangements the planner turns
 * into a concrete SectionsPlan for the user's tracks/sources. Encodes the
 * genre conventions from the reference-track research (energy-curve forms
 * for house/techno, 8-16 bar switch-ups for trap). Edit the emitted YAML
 * to taste before applying.
 *
 * Placeholders: role names (drums, bass, lead, ...) map to real tracks/
 * sources via the `roles` argument. Roles a preset uses but the user didn't
 * supply are "off" (a two-role skeleton is fine).
 */

interface PresetSection {
  name: string;
  bars: number;
  /** role -> ops pipeline (undefined = verbatim source), or "off". */
  layers: Record<string, string | "off">;
}

const V = ""; // verbatim marker for readability

const HOUSE: PresetSection[] = [
  { name: "intro", bars: 16, layers: { drums: "thin:keep=0.35", bass: "off", lead: "off", perc: "thin:keep=0.5" } },
  { name: "build1", bars: 16, layers: { drums: "thin:keep=0.7 velocity-shape:mode=ramp-up,amount=0.4", bass: "thin:keep=0.5", lead: "off", perc: V } },
  { name: "drop1", bars: 32, layers: { drums: V, bass: V, lead: V, perc: V } },
  { name: "breakdown", bars: 16, layers: { drums: "thin:keep=0.25", bass: "off", lead: "legato velocity-shape:mode=ramp-down,amount=0.3", perc: "off" } },
  { name: "build2", bars: 8, layers: { drums: "velocity-shape:mode=ramp-up,amount=0.6", bass: "thin:keep=0.6", lead: "thin:keep=0.7", perc: V } },
  { name: "drop2", bars: 32, layers: { drums: V, bass: V, lead: "densify:amount=0.25", perc: V } },
  { name: "outro", bars: 8, layers: { drums: "thin:keep=0.4", bass: "thin:keep=0.5", lead: "off", perc: "off" } },
];

const TRAP: PresetSection[] = [
  { name: "intro", bars: 8, layers: { drums: "off", bass: "off", lead: "legato", perc: "off" } },
  { name: "verse1", bars: 16, layers: { drums: "thin:keep=0.75", bass: V, lead: "thin:keep=0.5", perc: "off" } },
  { name: "hook1", bars: 16, layers: { drums: V, bass: V, lead: V, perc: V } },
  { name: "verse2", bars: 16, layers: { drums: "syncopate:probability=0.3", bass: V, lead: "thin:keep=0.5 octave:shift=1", perc: "thin:keep=0.6" } },
  { name: "hook2", bars: 16, layers: { drums: V, bass: "densify:amount=0.2", lead: V, perc: V } },
  { name: "outro", bars: 8, layers: { drums: "thin:keep=0.4", bass: "off", lead: "legato velocity-shape:mode=ramp-down,amount=0.4", perc: "off" } },
];

const PRESETS: Record<string, PresetSection[]> = { house: HOUSE, trap: TRAP };

export function listForms(): string[] {
  return Object.keys(PRESETS);
}

/**
 * Build a plan from a reference track's (user-corrected) section map
 * instead of a genre-form preset: bars come straight from the reference. Every layer defaults to verbatim (no ops):
 * unlike the built-in presets, an arbitrary reference's section names
 * ("bridge 2", "post drop", ...) carry no known genre convention to apply,
 * so this doesn't guess thinning/effects the way HOUSE/TRAP do. The user
 * edits the emitted YAML to taste in the same review-before-apply flow.
 */
export function planFromReferenceSections(
  refSections: { name: string; start_bar: number; end_bar: number }[],
  roles: Record<string, { trackPath: string; source: string }>,
): SectionsPlan {
  if (refSections.length === 0) {
    throw new BridgeError("bad_request", "reference has no sections to build a plan from");
  }
  if (Object.keys(roles).length === 0) {
    throw new BridgeError("bad_request", "at least one role (e.g. drums=track:0/slot:0) is required");
  }
  const trackMap: Record<string, string> = {};
  for (const [role, { trackPath }] of Object.entries(roles)) trackMap[role] = trackPath;

  return {
    name: "reference-skeleton",
    trackMap,
    sections: refSections.map((s) => ({
      name: s.name,
      bars: s.end_bar - s.start_bar + 1,
      tracks: Object.fromEntries(
        Object.entries(roles).map(([role, { source }]) => [role, { source }]),
      ),
    })),
  };
}

/**
 * Build a concrete plan from a form preset.
 * roles: role name -> { trackPath, source } for the roles the user has.
 */
export function planFromForm(
  form: string,
  roles: Record<string, { trackPath: string; source: string }>,
): SectionsPlan {
  const preset = PRESETS[form];
  if (!preset) {
    throw new BridgeError("bad_request", `unknown form "${form}" (known: ${listForms().join(", ")})`);
  }
  if (Object.keys(roles).length === 0) {
    throw new BridgeError("bad_request", "at least one role (e.g. drums=track:0/slot:0) is required");
  }
  const trackMap: Record<string, string> = {};
  for (const [role, { trackPath }] of Object.entries(roles)) trackMap[role] = trackPath;

  return {
    name: `${form}-skeleton`,
    trackMap,
    sections: preset.map((section) => ({
      name: section.name,
      bars: section.bars,
      tracks: Object.fromEntries(
        Object.entries(roles).map(([role, { source }]) => {
          const layer = section.layers[role];
          if (layer === "off" || layer === undefined) return [role, "off" as const];
          return [role, { source, ...(layer !== "" ? { ops: layer } : {}) }];
        }),
      ),
    })),
  };
}
