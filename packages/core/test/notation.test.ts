import { describe, expect, it } from "vitest";
import {
  midiToPitch,
  parseNotation,
  pitchToMidi,
  serializeNotation,
} from "../src/notation/barbeat.js";
import { BridgeError } from "../src/bridge/types.js";

describe("pitch names (Ableton convention: C3 = 60)", () => {
  it("converts both ways", () => {
    expect(pitchToMidi("C3")).toBe(60);
    expect(pitchToMidi("C-2")).toBe(0);
    expect(pitchToMidi("G8")).toBe(127);
    expect(pitchToMidi("F#2")).toBe(54);
    expect(pitchToMidi("Eb3")).toBe(63);
    expect(pitchToMidi("Db3")).toBe(pitchToMidi("C#3"));
    expect(midiToPitch(60)).toBe("C3");
    expect(midiToPitch(61)).toBe("C#3");
    expect(midiToPitch(0)).toBe("C-2");
  });

  it("rejects out-of-range and garbage", () => {
    expect(() => pitchToMidi("H3")).toThrowError(BridgeError);
    expect(() => pitchToMidi("C9")).toThrowError(/outside MIDI range/);
    expect(() => midiToPitch(128)).toThrowError(BridgeError);
  });
});

describe("parseNotation", () => {
  it("parses positions, durations, options, chords, comments", () => {
    const { notes, suggestedLengthBeats } = parseNotation(`
      # a friendly comment
      1|1   C3        1    v100
      1|2.5 Eb3       1/2
      2|1   C3+Eb3+G3 2    v90 p60
      2|4   D3        1/4  m
    `);
    expect(notes).toHaveLength(6);
    expect(notes[0]).toEqual({ pitch: 60, start: 0, duration: 1, velocity: 100 });
    expect(notes[1]).toEqual({ pitch: 63, start: 1.5, duration: 0.5 });
    // chord at bar 2 beat 1 = beat 4 absolute
    const chord = notes.filter((n) => n.start === 4);
    expect(chord.map((n) => n.pitch)).toEqual([60, 63, 67]);
    expect(chord[0]!.probability).toBeCloseTo(0.6);
    expect(notes[5]).toMatchObject({ pitch: 62, start: 7, muted: true });
    expect(suggestedLengthBeats).toBe(8);
  });

  it("honours time signatures", () => {
    const sig = parseNotation("sig 3/4\n2|1 C3 1");
    expect(sig.beatsPerBar).toBe(3);
    expect(sig.notes[0]!.start).toBe(3);
    const sixEight = parseNotation("sig 6/8\n2|1 C3 1");
    expect(sixEight.beatsPerBar).toBe(3);
  });

  it("rejects out-of-range beats, bad tokens, misplaced sig", () => {
    expect(() => parseNotation("1|5 C3 1")).toThrowError(/out of range/);
    expect(() => parseNotation("0|1 C3 1")).toThrowError(/1-based/);
    expect(() => parseNotation("1|1 C3 1 x9")).toThrowError(/unknown option/);
    expect(() => parseNotation("1|1 C3 0")).toThrowError(/duration/);
    expect(() => parseNotation("1|1 C3 1\nsig 3/4")).toThrowError(/before any notes/);
    expect(() => parseNotation("1|1 C3")).toThrowError(/expected/);
  });
});

describe("round-trip", () => {
  it("serialize(parse(x)) is stable and parse(serialize(notes)) preserves notes", () => {
    // Serialized output canonicalizes to sharps; flats are accepted on input.
    const source = `1|1 C3 1 v100
1|2.5 D#3 1/2
2|1 C3+D#3+G3 2 v90 p60
2|4 D3 1/4 m`;
    const parsed = parseNotation(source);
    const serialized = serializeNotation(parsed.notes);
    expect(serialized).toBe(source);
    expect(parseNotation(serialized).notes).toEqual(parsed.notes);
    // Flat spellings parse to the same notes as their sharp equivalents.
    const flat = parseNotation(source.replaceAll("D#3", "Eb3"));
    expect(flat.notes).toEqual(parsed.notes);
  });

  it("handles non-4/4 round-trips", () => {
    const parsed = parseNotation("sig 3/4\n1|1 C3 1\n2|2 D3 1/2");
    const serialized = serializeNotation(parsed.notes, { beatsPerBar: 3 });
    expect(serialized).toContain("sig 3/4");
    expect(parseNotation(serialized).notes).toEqual(parsed.notes);
  });

  it("splits non-uniform simultaneous notes instead of forming a chord", () => {
    const notes = [
      { pitch: 60, start: 0, duration: 1, velocity: 100 },
      { pitch: 64, start: 0, duration: 1, velocity: 60 }, // different velocity
    ];
    const text = serializeNotation(notes);
    expect(text.split("\n")).toHaveLength(2);
    expect(parseNotation(text).notes).toEqual(notes);
  });
});
