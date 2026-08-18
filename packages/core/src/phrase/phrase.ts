/**
 * M9 phrase engine entry points:
 *  - generateResponses: `awh drop respond` — N candidate responses to an
 *    EXISTING call clip's notes, one freestanding clip per candidate.
 *  - generatePhrase: `awh drop phrase` — cold-start an 8/16-bar call and
 *    response pair from a PhraseSpec (weighted callCells, evolution plan,
 *    turnaround), two equal-length voices.
 *
 * See docs/design/phrase-engine.md and the knowledge/arrangement/* entries
 * it cites for the craft rules this encodes.
 */
import type { NoteSpec } from "../bridge/types.js";
import type { ScaleContext } from "../transforms/types.js";
import { sortNotes } from "../transforms/types.js";
import { makeRng, variantSeed } from "../transforms/rng.js";
import type { EvolutionAction, EvolutionStep, PhraseSpec, ResponseRecipeName } from "./spec.js";
import { applyResponseRecipe, fitResponseToWindow } from "./recipes.js";
import { PHRASE_BEATS_PER_BAR, callCellToNotes, generateCallPitches, pickWeighted } from "./util.js";

// ---------------------------------------------------------------------------
// drop respond
// ---------------------------------------------------------------------------

export interface GenerateResponsesOptions {
  /** Recipes to cycle through (round-robin) across `count` candidates. */
  recipes: ResponseRecipeName[];
  /** Number of candidates to generate. */
  count: number;
  /** Base seed; candidate i uses variantSeed(seed, i). */
  seed: number;
}

export interface ResponseCandidate {
  recipe: ResponseRecipeName;
  seed: number;
  notes: NoteSpec[];
  lengthBeats: number;
  warnings: string[];
}

/**
 * Generate N response candidates answering `callNotes` (an existing call
 * clip's notes, verbatim — never re-fit or truncated). Each candidate is its
 * own deterministic (recipe, seed) draw with its own naturally-sized
 * container (call end + delay + content + rest, rounded to a whole bar) —
 * never overlaps the call region regardless of how full the call clip is.
 */
export function generateResponses(
  callNotes: NoteSpec[],
  scale: ScaleContext,
  spec: PhraseSpec,
  opts: GenerateResponsesOptions,
): ResponseCandidate[] {
  const candidates: ResponseCandidate[] = [];
  for (let i = 0; i < opts.count; i++) {
    const recipe = opts.recipes[i % opts.recipes.length]!;
    const seed = variantSeed(opts.seed, i);
    const rng = makeRng(seed);
    const result = applyResponseRecipe(recipe, callNotes, scale, spec, rng);
    candidates.push({ recipe, seed, notes: result.notes, lengthBeats: result.lengthBeats, warnings: result.warnings });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// drop phrase
// ---------------------------------------------------------------------------

export interface GeneratePhraseOptions {
  bars: 8 | 16;
  seed: number;
  /** Force a specific call-cell variant (index into listPhraseVariants). */
  variant?: number;
}

export interface GeneratedPhrase {
  callNotes: NoteSpec[];
  responseNotes: NoteSpec[];
  /** Shared length for both voices (equal-length paired clips). */
  lengthBeats: number;
  /** Groove-level choices made (cell/recipe/seed), e.g. drums' meta shape. */
  meta: Record<string, string>;
  warnings: string[];
}

function evolutionActionAt(evolution: EvolutionStep[], bar: number): EvolutionAction {
  for (const step of evolution) {
    if (bar >= step.bars[0] && bar <= step.bars[1]) return step.action;
  }
  return "state";
}

/**
 * Generate a cold-start call/response phrase spanning `opts.bars` bars.
 *
 * Groove-level choices — the call's rhythmic cell, and which response
 * recipe answers it — are drawn ONCE and held for the whole phrase (same
 * discipline as the drum grammars' groove-level choices, ../drums/
 * grammars.ts). "State" bars (evolution.action === "state") replay that
 * held call verbatim; "vary-call" bars redraw fresh PITCHES over the SAME
 * rhythmic cell (rather than a different cell or a different response) so
 * the call's own bar-length never changes — which is what lets the single
 * anchored response (principle: "evolve one side at a time", response never
 * varies) stay byte-identical and provably non-overlapping across every
 * cell without being recomputed per bar. Turnaround (drop-response |
 * extra-rest | none) is a distinct, response-only adjustment applied on the
 * last bar of each phraseBars unit — it never touches the call.
 */
export function generatePhrase(spec: PhraseSpec, scale: ScaleContext, opts: GeneratePhraseOptions): GeneratedPhrase {
  const beatsPerBar = PHRASE_BEATS_PER_BAR;
  const cellBeats = spec.cellBars * beatsPerBar;
  const totalBeats = opts.bars * beatsPerBar;
  if (totalBeats % cellBeats !== 0) {
    throw new Error(`--bars ${opts.bars} is not a whole multiple of the spec's cellBars (${spec.cellBars})`);
  }
  const numCells = totalBeats / cellBeats;
  const rng = makeRng(opts.seed);
  const warnings: string[] = [];

  const cell =
    opts.variant !== undefined
      ? spec.callCells[((opts.variant % spec.callCells.length) + spec.callCells.length) % spec.callCells.length]!
      : pickWeighted(spec.callCells, rng);
  const basePitches = generateCallPitches(cell, spec.callRegister, scale, rng);
  const baseCallNotes = callCellToNotes(cell, basePitches);

  const recipeName = spec.responseRecipes[Math.floor(rng() * spec.responseRecipes.length)]!;
  const rawResponse = applyResponseRecipe(recipeName, baseCallNotes, scale, spec, rng);
  warnings.push(...rawResponse.warnings);
  const baseResponse = fitResponseToWindow(rawResponse, cellBeats, scale, spec);
  warnings.push(...baseResponse.warnings);

  const allCall: NoteSpec[] = [];
  const allResponse: NoteSpec[] = [];

  for (let c = 0; c < numCells; c++) {
    const cellOffset = c * cellBeats;
    const phraseLocalBar = ((c * spec.cellBars) % spec.phraseBars) + 1;
    const action = evolutionActionAt(spec.evolution, phraseLocalBar);
    const isTurnaroundCell = ((c + 1) * spec.cellBars) % spec.phraseBars === 0;

    const callNotesThisCell =
      action === "vary-call" ? callCellToNotes(cell, generateCallPitches(cell, spec.callRegister, scale, rng)) : baseCallNotes;
    for (const n of callNotesThisCell) allCall.push({ ...n, start: n.start + cellOffset });

    let responseNotesThisCell = baseResponse.notes;
    if (isTurnaroundCell && spec.turnaround === "drop-response") {
      responseNotesThisCell = [];
    } else if (isTurnaroundCell && spec.turnaround === "extra-rest") {
      // Reset cue: keep only the resolving note, opening extra space ahead
      // of the phrase boundary (knowledge/arrangement/drop-phrase-evolution.md).
      responseNotesThisCell = baseResponse.notes.slice(-1);
    }
    for (const n of responseNotesThisCell) allResponse.push({ ...n, start: n.start + cellOffset });
  }

  return {
    callNotes: sortNotes(allCall),
    responseNotes: sortNotes(allResponse),
    lengthBeats: totalBeats,
    meta: { callCell: cell.name, recipe: recipeName, seed: String(opts.seed) },
    warnings: [...new Set(warnings)],
  };
}
