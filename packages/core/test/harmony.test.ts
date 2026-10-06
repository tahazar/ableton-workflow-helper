import { describe, expect, it } from "vitest";
import {
  parseProgression,
  type ChordSpec,
  type ScaleContextLike,
} from "../src/harmony/progression.js";
import { renderChords, voiceProgression } from "../src/harmony/voicing.js";
import { SCALES } from "../src/transforms/scales.js";
import { BridgeError } from "../src/bridge/types.js";

const A_MINOR: ScaleContextLike = { rootNote: 9, intervals: SCALES.minor! };
const C_MAJOR: ScaleContextLike = { rootNote: 0, intervals: SCALES.major! };

describe("parseProgression", () => {
  it("derives roots and qualities from the scale in A minor", () => {
    const chords = parseProgression("i-VI-III-VII", A_MINOR);
    expect(chords.map((c) => c.rootPc)).toEqual([9, 5, 0, 7]);
    expect(chords.map((c) => c.quality)).toEqual(["min", "maj", "maj", "maj"]);
    expect(chords[0]!.intervals).toEqual([0, 3, 7]); // i = minor triad
    expect(chords[1]!.intervals).toEqual([0, 4, 7]); // VI = major triad
  });

  it("adds the diatonic 7th with the '7' suffix", () => {
    const [chord] = parseProgression("i7", A_MINOR);
    expect(chord!.intervals).toEqual([0, 3, 7, 10]);
    expect(chord!.quality).toBe("min7");
  });

  it("flattens a borrowed root while keeping the diatonic stack structure", () => {
    // ii in A minor is rooted on B (pc 11); bII flattens that to pc 10.
    const [diatonic] = parseProgression("ii", A_MINOR);
    expect(diatonic!.rootPc).toBe(11);
    const [borrowed] = parseProgression("bII", A_MINOR);
    expect(borrowed!.rootPc).toBe(10);
    expect(borrowed!.intervals).toEqual(diatonic!.intervals);
  });

  it("supports sus2/sus4 and explicit dim/aug overrides", () => {
    const [v] = parseProgression("V", A_MINOR);
    const [sus4] = parseProgression("Vsus4", A_MINOR);
    expect(sus4!.quality).toBe("sus4");
    expect(sus4!.intervals[1]).not.toBe(v!.intervals[1]); // third replaced by the diatonic 4th

    const [sus2] = parseProgression("iisus2", A_MINOR);
    expect(sus2!.quality).toBe("sus2");

    const [dim] = parseProgression("iidim", A_MINOR);
    expect(dim!.quality).toBe("dim");
    expect(dim!.intervals).toEqual([0, 3, 6]);

    const [aug] = parseProgression("Vaug", A_MINOR);
    expect(aug!.quality).toBe("aug");
    expect(aug!.intervals).toEqual([0, 4, 8]);
  });

  it("derives maj/maj/maj/min for I-IV-V-vi in C major", () => {
    const chords = parseProgression("I-IV-V-vi", C_MAJOR);
    expect(chords.map((c) => c.quality)).toEqual(["maj", "maj", "maj", "min"]);
  });

  it("rejects unknown roman numerals and out-of-range degrees", () => {
    expect(() => parseProgression("viii", A_MINOR)).toThrowError(BridgeError);
    expect(() => parseProgression("viii", A_MINOR)).toThrowError(/viii/);
    expect(() => parseProgression("x7", A_MINOR)).toThrowError(/x7/);

    const pentatonic: ScaleContextLike = { rootNote: 0, intervals: SCALES["pentatonic-major"]! };
    expect(() => parseProgression("vi", pentatonic)).toThrowError(/out of range/);
  });
});

describe("voiceProgression", () => {
  const chords = (text: string, scale: ScaleContextLike): ChordSpec[] =>
    parseProgression(text, scale);

  it("close voicing sits near the target center", () => {
    const voiced = voiceProgression(chords("I-IV-V-I", C_MAJOR), {
      center: 60,
      voiceLeading: false,
    });
    for (const v of voiced) {
      const avg = v.pitches.reduce((a, b) => a + b, 0) / v.pitches.length;
      expect(Math.abs(avg - 60)).toBeLessThan(12);
    }
  });

  it("voice leading reduces total movement vs. root-position-every-time", () => {
    const prog = chords("I-IV-V-I", C_MAJOR);
    const led = voiceProgression(prog, { voiceLeading: true });
    const notLed = voiceProgression(prog, { voiceLeading: false });

    const totalMovement = (voiced: { pitches: number[] }[]): number => {
      let total = 0;
      for (let i = 1; i < voiced.length; i++) {
        const prev = voiced[i - 1]!.pitches;
        const cur = voiced[i]!.pitches;
        for (let j = 0; j < Math.min(prev.length, cur.length); j++) {
          total += Math.abs(cur[j]! - prev[j]!);
        }
      }
      return total;
    };

    expect(totalMovement(led)).toBeLessThan(totalMovement(notLed));
  });

  it("spread voicing lowers the bottom note below close's bottom", () => {
    const prog = chords("I-IV-V-I", C_MAJOR);
    const close = voiceProgression(prog, { style: "close", voiceLeading: false });
    const spread = voiceProgression(prog, { style: "spread", voiceLeading: false });
    for (let i = 0; i < prog.length; i++) {
      expect(Math.min(...spread[i]!.pitches)).toBeLessThan(Math.min(...close[i]!.pitches));
    }
  });

  it("is deterministic", () => {
    const prog = chords("i-VI-III-VII", A_MINOR);
    const a = voiceProgression(prog, { style: "spread" });
    const b = voiceProgression(prog, { style: "spread" });
    expect(a).toEqual(b);
  });

  it("spread + voice leading (the default combination) doesn't drift the register down over a long progression", () => {
    // Regression: voice-leading a chord against the previous chord's
    // already-spread pitches (rather than its pre-spread close voicing)
    // compounds each spread pass into the next search target, sinking the
    // whole progression by nearly an octave after the first transition.
    const prog = chords("I-IV-V-I-vi-IV-V-I", C_MAJOR);
    const center = 60;
    const voiced = voiceProgression(prog, { style: "spread", center, voiceLeading: true });
    for (const v of voiced) {
      // A generous bound: spread legitimately widens beyond a one-octave
      // window around center, but the lowest voice must stay in the same
      // ballpark for every chord, not sink further with each transition
      // (the bug sank this exact progression to a lowest pitch of 24,
      // 36 semitones below center, well outside this bound).
      expect(Math.min(...v.pitches)).toBeGreaterThan(center - 24);
    }
  });
});

describe("renderChords", () => {
  const prog = parseProgression("I-IV-V-I", C_MAJOR);

  it("whole rhythm: one NoteSpec per pitch per chord, correct starts/durations", () => {
    const voiced = voiceProgression(prog, { voiceLeading: false });
    const notes = renderChords(voiced, { rhythm: "whole", beatsPerBar: 4 });
    expect(notes.length).toBe(voiced.reduce((n, v) => n + v.pitches.length, 0));
    // First chord occupies beats [0,4).
    const firstChordNotes = notes.filter((n) => n.start === 0);
    expect(firstChordNotes.length).toBe(voiced[0]!.pitches.length);
    for (const n of firstChordNotes) expect(n.duration).toBe(4);
  });

  it("quarters: a hit every beat", () => {
    const voiced = voiceProgression(prog, { voiceLeading: false });
    const notes = renderChords(voiced, { rhythm: "quarters", beatsPerBar: 4 });
    // 4 chords x 4 beats x pitches-per-chord.
    const expectedHits = 4 * 4;
    const expectedNotes = voiced.reduce((n, v) => n + v.pitches.length, 0) * 4;
    expect(notes.length).toBe(expectedNotes);
    const starts = [...new Set(notes.map((n) => n.start))].toSorted((a, b) => a - b);
    expect(starts.length).toBe(expectedHits);
    for (const n of notes) expect(n.duration).toBe(0.9);
  });

  it("offbeat-stabs: hits land on +0.5 offsets with reduced velocity", () => {
    const voiced = voiceProgression(prog, { voiceLeading: false });
    const notes = renderChords(voiced, { rhythm: "offbeat-stabs", beatsPerBar: 4, velocity: 90 });
    for (const n of notes) {
      expect(n.start % 1).toBeCloseTo(0.5, 9);
      expect(n.duration).toBe(0.4);
      expect(n.velocity).toBe(80);
    }
  });

  it("bassOctaves adds a pitch exactly 12 below the voicing's lowest pitch", () => {
    const voiced = voiceProgression(prog, { voiceLeading: false });
    const withoutBass = renderChords(voiced, { rhythm: "whole", bassOctaves: 0 });
    const withBass = renderChords(voiced, { rhythm: "whole", bassOctaves: 1 });
    expect(withBass.length).toBe(withoutBass.length + voiced.length);
    const firstChordLowest = Math.min(...voiced[0]!.pitches);
    const bassNote = withBass.find((n) => n.start === 0 && n.pitch === firstChordLowest - 12);
    expect(bassNote).toBeDefined();
  });

  it("pads/truncates to fit when bars doesn't evenly match chord count", () => {
    const threeChords = parseProgression("I-IV-V", C_MAJOR);
    const voiced = voiceProgression(threeChords, { voiceLeading: false });
    const notes = renderChords(voiced, { bars: 4, beatsPerBar: 4, rhythm: "whole" });
    const starts = [...new Set(notes.map((n) => n.start))].toSorted((a, b) => a - b);
    expect(starts).toEqual([0, 16 / 3, 32 / 3]);
    for (const n of notes) expect(n.duration).toBeCloseTo(16 / 3, 9);
  });

  it("is deterministic and sorted by start then pitch", () => {
    const voiced = voiceProgression(prog, { style: "spread" });
    const a = renderChords(voiced, { rhythm: "half" });
    const b = renderChords(voiced, { rhythm: "half" });
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) {
      const prev = a[i - 1]!;
      const cur = a[i]!;
      expect(cur.start > prev.start || (cur.start === prev.start && cur.pitch >= prev.pitch)).toBe(
        true,
      );
    }
  });
});

describe("explicit quality suffixes (maj/min)", () => {
  const aMinor = { rootNote: 9, intervals: [0, 2, 3, 5, 7, 8, 10] };

  it("Vmaj forces the major dominant in natural minor (the i-iv-Vmaj-i cadence)", () => {
    const [i, iv, V, i2] = parseProgression("i-iv-Vmaj-i", aMinor);
    expect(i!.quality).toBe("min");
    expect(iv!.quality).toBe("min");
    expect(V!.quality).toBe("maj");
    expect(V!.intervals).toEqual([0, 4, 7]);
    expect(V!.rootPc).toBe(4); // E stays diatonic — only the quality is forced
    expect(i2!.intervals).toEqual([0, 3, 7]);
  });

  it("min forces a minor triad on a naturally-major degree", () => {
    const cMajor = { rootNote: 0, intervals: [0, 2, 4, 5, 7, 9, 11] };
    const [IVmin] = parseProgression("IVmin", cMajor);
    expect(IVmin!.quality).toBe("min");
    expect(IVmin!.intervals).toEqual([0, 3, 7]);
    expect(IVmin!.rootPc).toBe(5);
  });

  it("still rejects unknown suffix combos", () => {
    expect(() => parseProgression("Vmaj7", aMinor)).toThrowError(/Vmaj7/);
  });
});
