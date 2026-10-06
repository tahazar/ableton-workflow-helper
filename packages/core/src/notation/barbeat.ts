import { BridgeError, type NoteSpec } from "../bridge/types.js";

/**
 * AWH bar|beat notation: the human/LLM-facing text format for MIDI notes.
 * Clean-room design (concept inspired by prior art; no code ported).
 *
 * Grammar (one event per line; "#" starts a comment; blank lines ignored):
 *
 *   sig 4/4                      optional header: time signature (default 4/4)
 *   1|1    C3        1     v100  bar|beat  pitch(es)  duration-in-beats  opts
 *   1|2.5  Eb3       1/2         fractional beats; velocity defaults to 100
 *   2|1    C3+Eb3+G3 2     v90   "+" joins pitches into a chord (same pos/dur)
 *   2|4    D3        1/4   v64 p60 m    p = probability %, m = muted
 *
 * Rules:
 * - bar and beat are 1-based: "1|1" is the very start of the clip.
 * - beat must satisfy 1 <= beat < beatsPerBar + 1 (fractions fine: 1|4.75).
 * - duration is in beats (not note values): in 4/4, a quarter note is 1,
 *   an eighth is 1/2 or 0.5, a whole bar is 4. Fractions and decimals both
 *   parse; serialization prefers exact simple fractions.
 * - Pitch names use Ableton's octave convention: middle C (MIDI 60) = C3.
 *   Accidentals: # and b (Db3 == C#3). Range C-2 (0) to G8 (127).
 * - Time signature: beatsPerBar = numerator * 4 / denominator (Live counts
 *   quarter-note beats): 4/4 -> 4, 3/4 -> 3, 6/8 -> 3.
 */

export interface NotationOptions {
  /** Beats per bar; overrides any `sig` header. Default 4. */
  beatsPerBar?: number;
}

export interface ParsedNotation {
  notes: NoteSpec[];
  beatsPerBar: number;
  /** Span in beats from clip start to the last note end, rounded UP to a whole bar. */
  suggestedLengthBeats: number;
}

const NOTE_OFFSETS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const OFFSET_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** "C3" -> 60 (Ableton convention: middle C = C3 = MIDI 60). */
export function pitchToMidi(name: string): number {
  const m = name.match(/^([A-Ga-g])(#|b)?(-?\d+)$/);
  if (!m) throw new BridgeError("bad_request", `invalid pitch "${name}" (expected e.g. C3, F#2, Eb4)`);
  const letter = m[1]!.toUpperCase();
  const accidental = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  const octave = Number(m[3]);
  const midi = NOTE_OFFSETS[letter]! + accidental + (octave + 2) * 12;
  if (midi < 0 || midi > 127) {
    throw new BridgeError("bad_request", `pitch "${name}" is outside MIDI range 0-127 (C-2..G8)`);
  }
  return midi;
}

/** 60 -> "C3". */
export function midiToPitch(midi: number): string {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
    throw new BridgeError("bad_request", `MIDI pitch out of range: ${midi}`);
  }
  return `${OFFSET_NAMES[midi % 12]}${Math.floor(midi / 12) - 2}`;
}

function parseBeats(token: string, context: string): number {
  const frac = token.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const den = Number(frac[2]);
    if (den === 0) throw new BridgeError("bad_request", `${context}: division by zero in "${token}"`);
    return Number(frac[1]) / den;
  }
  const n = Number(token);
  if (!Number.isFinite(n)) {
    throw new BridgeError("bad_request", `${context}: "${token}" is not a number or fraction`);
  }
  return n;
}

const COMMON_FRACTIONS: [number, string][] = [
  [0.25, "1/4"],
  [0.5, "1/2"],
  [0.75, "3/4"],
  [1 / 3, "1/3"],
  [2 / 3, "2/3"],
  [1.5, "3/2"],
  [0.125, "1/8"],
  [0.375, "3/8"],
];

function formatBeats(beats: number): string {
  for (const [value, text] of COMMON_FRACTIONS) {
    if (Math.abs(beats - value) < 1e-9) return text;
  }
  return Number.isInteger(beats) ? String(beats) : String(Number(beats.toFixed(3)));
}

export function parseNotation(text: string, options: NotationOptions = {}): ParsedNotation {
  let beatsPerBar = options.beatsPerBar ?? 4;
  let sigSeen = false;
  const notes: NoteSpec[] = [];

  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, lineNo) => {
    // "#" starts a comment only at line start or after whitespace; a "#"
    // inside a token is an accidental (D#3), not a comment.
    const line = rawLine.replace(/(^|\s)#.*$/, "$1").trim();
    if (line === "") return;
    const where = `line ${lineNo + 1}`;

    const sig = line.match(/^sig\s+(\d+)\/(\d+)$/i);
    if (sig) {
      if (notes.length > 0) {
        throw new BridgeError("bad_request", `${where}: "sig" must come before any notes`);
      }
      if (sigSeen) throw new BridgeError("bad_request", `${where}: duplicate "sig" header`);
      sigSeen = true;
      if (options.beatsPerBar === undefined) {
        beatsPerBar = (Number(sig[1]) * 4) / Number(sig[2]);
      }
      return;
    }

    const tokens = line.split(/\s+/);
    if (tokens.length < 3) {
      throw new BridgeError(
        "bad_request",
        `${where}: expected "bar|beat pitch duration [v..] [p..] [m]", got "${line}"`,
      );
    }

    const pos = tokens[0]!.match(/^(\d+)\|(\d+(?:\.\d+)?)$/);
    if (!pos) {
      throw new BridgeError("bad_request", `${where}: invalid position "${tokens[0]}" (expected bar|beat, e.g. 2|1.5)`);
    }
    const bar = Number(pos[1]);
    const beat = Number(pos[2]);
    if (bar < 1) throw new BridgeError("bad_request", `${where}: bars are 1-based`);
    if (beat < 1 || beat >= beatsPerBar + 1) {
      throw new BridgeError(
        "bad_request",
        `${where}: beat ${beat} out of range for ${beatsPerBar} beats/bar (1 <= beat < ${beatsPerBar + 1})`,
      );
    }
    const start = (bar - 1) * beatsPerBar + (beat - 1);

    const pitches = tokens[1]!.split("+").map((p) => pitchToMidi(p));
    const duration = parseBeats(tokens[2]!, where);
    if (duration <= 0) throw new BridgeError("bad_request", `${where}: duration must be > 0`);

    let velocity: number | undefined;
    let probability: number | undefined;
    let muted: boolean | undefined;
    for (const opt of tokens.slice(3)) {
      const v = opt.match(/^v(\d+)$/i);
      const p = opt.match(/^p(\d+)$/i);
      if (v) {
        velocity = Number(v[1]);
        if (velocity < 1 || velocity > 127) {
          throw new BridgeError("bad_request", `${where}: velocity ${velocity} outside 1-127`);
        }
      } else if (p) {
        probability = Number(p[1]) / 100;
        if (probability < 0 || probability > 1) {
          throw new BridgeError("bad_request", `${where}: probability ${p[1]}% outside 0-100`);
        }
      } else if (/^m$/i.test(opt)) {
        muted = true;
      } else {
        throw new BridgeError("bad_request", `${where}: unknown option "${opt}" (expected vN, pN, or m)`);
      }
    }

    for (const pitch of pitches) {
      const note: NoteSpec = { pitch, start, duration };
      if (velocity !== undefined) note.velocity = velocity;
      if (probability !== undefined) note.probability = probability;
      if (muted !== undefined) note.muted = muted;
      notes.push(note);
    }
  });

  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const end = notes.reduce((max, n) => Math.max(max, n.start + n.duration), 0);
  const suggestedLengthBeats = Math.max(beatsPerBar, Math.ceil(end / beatsPerBar) * beatsPerBar);
  return { notes, beatsPerBar, suggestedLengthBeats };
}

export function serializeNotation(notes: NoteSpec[], options: NotationOptions = {}): string {
  const beatsPerBar = options.beatsPerBar ?? 4;
  const lines: string[] = [];
  if (beatsPerBar !== 4) {
    lines.push(`sig ${beatsPerBar}/4`);
  }

  // Group simultaneous notes with identical duration/velocity/probability/muted
  // into chords for compactness.
  const sorted = [...notes].toSorted((a, b) => a.start - b.start || a.pitch - b.pitch);
  const groups: NoteSpec[][] = [];
  for (const note of sorted) {
    const group = groups.find(
      (g) =>
        Math.abs(g[0]!.start - note.start) < 1e-9 &&
        Math.abs(g[0]!.duration - note.duration) < 1e-9 &&
        g[0]!.velocity === note.velocity &&
        g[0]!.probability === note.probability &&
        g[0]!.muted === note.muted,
    );
    if (group) group.push(note);
    else groups.push([note]);
  }

  for (const group of groups) {
    const n = group[0]!;
    const bar = Math.floor(n.start / beatsPerBar) + 1;
    const beat = (n.start % beatsPerBar) + 1;
    const beatText = Number.isInteger(beat) ? String(beat) : String(Number(beat.toFixed(3)));
    const parts = [
      `${bar}|${beatText}`,
      group.map((g) => midiToPitch(g.pitch)).join("+"),
      formatBeats(n.duration),
    ];
    if (n.velocity !== undefined) parts.push(`v${n.velocity}`);
    if (n.probability !== undefined) parts.push(`p${Math.round(n.probability * 100)}`);
    if (n.muted) parts.push("m");
    lines.push(parts.join(" "));
  }
  return lines.join("\n");
}
