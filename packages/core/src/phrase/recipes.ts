/**
 * Response recipes: five deterministic (callNotes, scale, spec, rng) ->
 * response transforms, per docs/design/phrase-engine.md's recipe table.
 * Built on the existing transform vocabulary (../transforms/) where it
 * fits; phrase-specific timing/pitch machinery lives in util.ts.
 *
 * Every recipe enters after a delay drawn from spec.responseDelayBeats,
 * ends on a spec.resolveDegrees pitch in spec.responseRegister, and leaves
 * spec.restMinBeats of tail before the returned lengthBeats (rounded up to
 * a whole bar). These are the "rest is the question mark" / "answers
 * resolve" principles from knowledge/arrangement/call-response-rest-placement.md and
 * call-response-drop-grammar.md.
 */
import type { NoteSpec } from "../bridge/types.js";
import type { ScaleContext } from "../transforms/types.js";
import { sortNotes } from "../transforms/types.js";
import type { PhraseSpec, ResponseRecipeName } from "./spec.js";
import {
  callEndBeat,
  ceilToBar,
  medianPitch,
  nearestPitch,
  repitchLow,
  resolveDegreePitches,
} from "./util.js";

export interface RecipeResult {
  /** Response notes; `start` shares callNotes' own time coordinate (0 = the
   *  call's own clip/cell origin), not re-based to 0 at the response entry. */
  notes: NoteSpec[];
  /** Container length in beats (whole bars) that fits call end + delay +
   *  response content + the trailing rest budget. */
  lengthBeats: number;
  warnings: string[];
}

export type ResponseRecipe = (
  callNotes: NoteSpec[],
  scale: ScaleContext,
  spec: PhraseSpec,
  rng: () => number,
) => RecipeResult;

interface ResponseWindow {
  responseStart: number;
  warnings: string[];
}

/**
 * Shared entry-point math for every recipe: where does the response start,
 * and does the call itself leave the bar-tail rest that
 * call-response-rest-placement.md calls for? A call that fills its own cell
 * still gets a legal, non-overlapping response: this only warns, it never
 * blocks generation.
 */
function deriveResponseWindow(
  callNotes: NoteSpec[],
  spec: PhraseSpec,
  rng: () => number,
): ResponseWindow {
  const warnings: string[] = [];
  const end = callEndBeat(callNotes);
  const barEnd = ceilToBar(Math.max(end, 1e-9));
  if (barEnd - end < spec.restMinBeats) {
    warnings.push(
      `call leaves only ${(barEnd - end).toFixed(2)} beat(s) of rest at its own bar tail ` +
        `(restMinBeats wants ${spec.restMinBeats}) — the response still enters cleanly after ` +
        "it, but consider trimming the call's last note to leave the question-mark gap",
    );
  }
  const [dLo, dHi] = spec.responseDelayBeats;
  const delay = dLo + rng() * (dHi - dLo);
  return { responseStart: end + delay, warnings };
}

/** Force the last note (by start) onto an allowed resolve-degree pitch and
 *  compute the bar-rounded container length. Shared tail for every recipe. */
function finalizeResponse(
  notes: NoteSpec[],
  scale: ScaleContext,
  spec: PhraseSpec,
  warnings: string[],
): RecipeResult {
  if (notes.length === 0) {
    return { notes: [], lengthBeats: ceilToBar(spec.restMinBeats), warnings };
  }
  const sorted = sortNotes(notes);
  const last = sorted[sorted.length - 1]!;
  const candidates = resolveDegreePitches(
    spec.responseRegister,
    scale.rootNote,
    spec.resolveDegrees,
  );
  const resolved: NoteSpec[] = [
    ...sorted.slice(0, -1),
    { ...last, pitch: nearestPitch(last.pitch, candidates) },
  ];
  const lengthBeats = ceilToBar(last.start + last.duration + spec.restMinBeats);
  return { notes: resolved, lengthBeats, warnings };
}

/** `echo-low`: same rhythm (lightly thinned), re-pitched low, resolved. */
export const echoLow: ResponseRecipe = (callNotes, scale, spec, rng) => {
  const { responseStart, warnings } = deriveResponseWindow(callNotes, spec, rng);
  const sorted = sortNotes(callNotes);
  if (sorted.length === 0) return finalizeResponse([], scale, spec, warnings);
  const anchor = sorted[0]!.start;
  const kept = sorted.filter((n) => n === sorted[0] || rng() < 0.85);
  const notes = kept.map((n) => ({
    ...n,
    start: responseStart + (n.start - anchor),
    pitch: repitchLow(n.pitch, scale, spec.responseRegister),
  }));
  return finalizeResponse(notes, scale, spec, warnings);
};

/** `truncate-stab`: first 1-2 onsets only, lengthened into stabs, big rest. */
export const truncateStab: ResponseRecipe = (callNotes, scale, spec, rng) => {
  const { responseStart, warnings } = deriveResponseWindow(callNotes, spec, rng);
  const sorted = sortNotes(callNotes);
  if (sorted.length === 0) return finalizeResponse([], scale, spec, warnings);
  const count = sorted.length <= 1 ? 1 : rng() < 0.5 ? 1 : 2;
  const picked = sorted.slice(0, count);
  const anchor = picked[0]!.start;
  const stabDuration = 1.0;
  const notes = picked.map((n) => ({
    ...n,
    start: responseStart + (n.start - anchor),
    duration: stabDuration,
    velocity: Math.max(n.velocity ?? 100, 110),
    pitch: repitchLow(n.pitch, scale, spec.responseRegister),
  }));
  return finalizeResponse(notes, scale, spec, warnings);
};

/** `invert-answer`: contour inverted around the call's median pitch, register-shifted, resolved. */
export const invertAnswer: ResponseRecipe = (callNotes, scale, spec, rng) => {
  const { responseStart, warnings } = deriveResponseWindow(callNotes, spec, rng);
  const sorted = sortNotes(callNotes);
  if (sorted.length === 0) return finalizeResponse([], scale, spec, warnings);
  const anchor = sorted[0]!.start;
  const pivot = medianPitch(sorted);
  const notes = sorted.map((n) => ({
    ...n,
    start: responseStart + (n.start - anchor),
    pitch: repitchLow(2 * pivot - n.pitch, scale, spec.responseRegister),
  }));
  return finalizeResponse(notes, scale, spec, warnings);
};

/**
 * `displaced-echo`: rhythm rotated onto complementary beats (hocketing, see
 * knowledge/arrangement/call-response-drop-grammar.md); the first hit lands
 * on the beat (kick alignment).
 */
export const displacedEcho: ResponseRecipe = (callNotes, scale, spec, rng) => {
  const { responseStart, warnings } = deriveResponseWindow(callNotes, spec, rng);
  const sorted = sortNotes(callNotes);
  if (sorted.length === 0) return finalizeResponse([], scale, spec, warnings);
  const anchor = sorted[0]!.start;
  const alignedStart = Math.ceil(responseStart - 1e-9);
  const rotation = 0.5; // complementary offbeat displacement
  const notes = sorted.map((n, i) => ({
    ...n,
    start: alignedStart + (i === 0 ? 0 : n.start - anchor + rotation),
    pitch: repitchLow(n.pitch, scale, spec.responseRegister),
  }));
  return finalizeResponse(notes, scale, spec, warnings);
};

/** `sparse-answer`: thinned + slowed (half-time feel), 1-2 long low notes. */
export const sparseAnswer: ResponseRecipe = (callNotes, scale, spec, rng) => {
  const { responseStart, warnings } = deriveResponseWindow(callNotes, spec, rng);
  const sorted = sortNotes(callNotes);
  if (sorted.length === 0) return finalizeResponse([], scale, spec, warnings);
  const thinned = sorted.filter((n) => n === sorted[0] || rng() < 0.3).slice(0, 2);
  const anchor = thinned[0]!.start;
  const notes = thinned.map((n) => ({
    ...n,
    start: responseStart + (n.start - anchor) * 2,
    duration: Math.max(n.duration * 2, 1.5),
    pitch: repitchLow(n.pitch, scale, spec.responseRegister),
  }));
  return finalizeResponse(notes, scale, spec, warnings);
};

const RECIPES: Record<ResponseRecipeName, ResponseRecipe> = {
  "echo-low": echoLow,
  "truncate-stab": truncateStab,
  "invert-answer": invertAnswer,
  "displaced-echo": displacedEcho,
  "sparse-answer": sparseAnswer,
};

export function applyResponseRecipe(
  name: ResponseRecipeName,
  callNotes: NoteSpec[],
  scale: ScaleContext,
  spec: PhraseSpec,
  rng: () => number,
): RecipeResult {
  // Exported from @awh/core, so an untyped caller can pass any string; hasOwn
  // also keeps names like "constructor" from resolving to Object.prototype.
  if (!Object.hasOwn(RECIPES, name)) {
    throw new Error(
      `unknown response recipe "${name}" (known: ${Object.keys(RECIPES).join(", ")})`,
    );
  }
  return RECIPES[name](callNotes, scale, spec, rng);
}

/**
 * Fit a (naturally-sized) recipe result into a fixed window ending at
 * `windowEndBeats`. Used by the cold-start phrase generator (phrase.ts),
 * where every cell must tile at the spec's fixed cellBars grid. Truncates
 * trailing notes that would overrun the window, re-resolving whatever note
 * ends up last; drop-respond's freestanding candidates never need this
 * (their container just grows to fit).
 */
export function fitResponseToWindow(
  result: RecipeResult,
  windowEndBeats: number,
  scale: ScaleContext,
  spec: PhraseSpec,
): RecipeResult {
  const warnings = [...result.warnings];
  const limit = windowEndBeats - spec.restMinBeats;
  let notes = result.notes.filter((n) => n.start < limit);
  if (notes.length === 0 && result.notes.length > 0) {
    const last = result.notes[result.notes.length - 1]!;
    const duration = Math.min(0.5, Math.max(0.1, limit));
    const start = Math.max(0, limit - duration);
    notes = [{ ...last, start, duration }];
    warnings.push(
      `response had to be squeezed to a single stab to fit the ${windowEndBeats}-beat cell — ` +
        "consider a shorter call cell or a smaller responseDelayBeats range",
    );
  }
  notes = notes.map((n) =>
    n.start + n.duration > limit ? { ...n, duration: Math.max(0.05, limit - n.start) } : n,
  );
  const sorted = sortNotes(notes);
  if (sorted.length > 0) {
    const last = sorted[sorted.length - 1]!;
    const candidates = resolveDegreePitches(
      spec.responseRegister,
      scale.rootNote,
      spec.resolveDegrees,
    );
    sorted[sorted.length - 1] = { ...last, pitch: nearestPitch(last.pitch, candidates) };
  }
  return { notes: sorted, lengthBeats: windowEndBeats, warnings };
}
