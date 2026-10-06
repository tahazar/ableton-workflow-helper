/**
 * Pure-TS seeded synthesis for `awh endless demo`: small, deterministic,
 * dependency-free stems so the endless player has something to play with
 * zero owner assets (docs/design/endless-player.md). This is offline
 * render-to-buffer code (Node-only, no Web Audio), unrelated to the
 * player's decision core in packages/cli/assets/endless/player.js.
 * A tiny local seeded RNG lives here rather than reusing player.js's
 * PRNG: this is a different domain (offline synthesis parameters, not a
 * playback decision that needs cross-runtime determinism against a shared
 * test), and importing a plain .js asset into typechecked CLI source isn't
 * set up (see build.ts's runtime-path comment for why player.js is copied,
 * not imported).
 */

const SAMPLE_RATE = 44100;

/** mulberry32, self-contained (see file header for why this isn't shared
 * with player.js's copy). Closure-based (stateful) is fine here: this is
 * one-shot offline rendering, not something under determinism test. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function clampSample(x: number): number {
  return Math.max(-1, Math.min(1, x));
}

function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.round(clampSample(samples[i] ?? 0) * 32767);
  }
  return out;
}

/** One decaying sine burst (a kick "thump") added into `buf` starting at
 * sample `startSample`, exponential amplitude + a fast pitch drop. */
function addKick(buf: Float32Array, startSample: number, rng: () => number): void {
  const startFreq = 130 + rng() * 20;
  const endFreq = 45 + rng() * 10;
  const decay = 22 + rng() * 6;
  const durationSamples = Math.min(buf.length - startSample, Math.round(SAMPLE_RATE * 0.35));
  let phase = 0;
  for (let i = 0; i < durationSamples; i++) {
    const t = i / SAMPLE_RATE;
    const freq = endFreq + (startFreq - endFreq) * Math.exp(-t * 18);
    phase += (2 * Math.PI * freq) / SAMPLE_RATE;
    const env = Math.exp(-t * decay);
    const idx = startSample + i;
    buf[idx] = (buf[idx] ?? 0) + Math.sin(phase) * env * 0.9;
  }
}

/** A short filtered-noise burst (a hat "tick"): white noise through a
 * simple one-pole highpass-ish shaper (difference filter) then a fast
 * exponential decay envelope. `open` makes the burst longer (open hat). */
function addHat(buf: Float32Array, startSample: number, rng: () => number, open: boolean): void {
  const decay = open ? 10 : 45;
  const durationSamples = Math.min(
    buf.length - startSample,
    Math.round(SAMPLE_RATE * (open ? 0.25 : 0.06)),
  );
  let prev = 0;
  const alpha = 0.85; // one-pole coefficient: y[n] = x[n] - alpha*x[n-1], a crude highpass shaper
  let prevRaw = 0;
  for (let i = 0; i < durationSamples; i++) {
    const t = i / SAMPLE_RATE;
    const raw = rng() * 2 - 1;
    const filtered = raw - alpha * prevRaw;
    prevRaw = raw;
    prev = filtered;
    const env = Math.exp(-t * decay);
    const idx = startSample + i;
    buf[idx] = (buf[idx] ?? 0) + prev * env * 0.35;
  }
}

/** Renders a mixed kick+hat "drums" stem loop: four-on-the-floor kick plus
 * 8th-note hats (open hat on the last 8th of the loop), seeded so each
 * variant is audibly distinct but reproducible. */
export function renderDrumsLoop(bars: number, bpm: number, seed: number): Int16Array {
  const durationSeconds = (bars * 4 * 60) / bpm;
  const totalSamples = Math.round(durationSeconds * SAMPLE_RATE);
  const buf = new Float32Array(totalSamples);
  const rng = makeRng(seed);
  const beats = bars * 4;
  const secondsPerBeat = 60 / bpm;
  for (let beat = 0; beat < beats; beat++) {
    addKick(buf, Math.round(beat * secondsPerBeat * SAMPLE_RATE), rng);
  }
  const eighths = beats * 2;
  for (let e = 0; e < eighths; e++) {
    const isLastOfLoop = e === eighths - 1;
    addHat(buf, Math.round(e * 0.5 * secondsPerBeat * SAMPLE_RATE), rng, isLastOfLoop);
  }
  return toInt16(buf);
}

/** Renders a "bass" stem: a short seeded pattern of detuned-saw notes (a
 * saw built as a harmonic sum, cheaper/simpler than a real bandlimited
 * saw and plenty for a demo loop), one note per bar rooted a seeded degree
 * below a base MIDI note. */
export function renderBassLoop(bars: number, bpm: number, seed: number, rootMidi = 33): Int16Array {
  const durationSeconds = (bars * 4 * 60) / bpm;
  const totalSamples = Math.round(durationSeconds * SAMPLE_RATE);
  const buf = new Float32Array(totalSamples);
  const rng = makeRng(seed);
  const secondsPerBeat = 60 / bpm;
  const degrees = [0, 0, 3, 5, 7, -2]; // small seeded-choice palette (semitones)
  const harmonics = 6;
  for (let bar = 0; bar < bars; bar++) {
    const degree = degrees[Math.floor(rng() * degrees.length)] ?? 0;
    const midi = rootMidi + degree;
    const freq = midiToFreq(midi);
    const detune = 1 + (rng() * 2 - 1) * 0.004;
    const startSample = Math.round(bar * 4 * secondsPerBeat * SAMPLE_RATE);
    const noteSamples = Math.round(3.6 * secondsPerBeat * SAMPLE_RATE);
    const decay = 1.6;
    for (let i = 0; i < noteSamples && startSample + i < totalSamples; i++) {
      const t = i / SAMPLE_RATE;
      let sample = 0;
      for (let h = 1; h <= harmonics; h++) {
        sample += Math.sin(2 * Math.PI * freq * h * detune * t) / h;
      }
      const attack = Math.min(1, t / 0.01);
      const env = attack * Math.exp(-t * decay);
      const idx = startSample + i;
      buf[idx] = (buf[idx] ?? 0) + sample * env * 0.35;
    }
  }
  return toInt16(buf);
}

/** Renders a "pads" stem: 2-3 detuned sines sustained across the whole
 * loop with a slow attack/release, seeded root/detune per variant. */
export function renderPadsLoop(bars: number, bpm: number, seed: number, rootMidi = 57): Int16Array {
  const durationSeconds = (bars * 4 * 60) / bpm;
  const totalSamples = Math.round(durationSeconds * SAMPLE_RATE);
  const buf = new Float32Array(totalSamples);
  const rng = makeRng(seed);
  const voices = 2 + Math.floor(rng() * 2); // 2 or 3
  const chordSemitones = [0, 7, 12, 4]; // seeded subset of a simple triad-ish set
  const attack = durationSeconds * 0.25;
  const release = durationSeconds * 0.25;
  for (let v = 0; v < voices; v++) {
    const semis = chordSemitones[v % chordSemitones.length] ?? 0;
    const freq = midiToFreq(rootMidi + semis);
    const detune = 1 + (rng() * 2 - 1) * 0.006;
    const phaseOffset = rng() * Math.PI * 2;
    for (let i = 0; i < totalSamples; i++) {
      const t = i / SAMPLE_RATE;
      const env =
        t < attack
          ? t / attack
          : t > durationSeconds - release
            ? Math.max(0, (durationSeconds - t) / release)
            : 1;
      const sample = Math.sin(2 * Math.PI * freq * detune * t + phaseOffset);
      buf[i] = (buf[i] ?? 0) + sample * env * (0.22 / voices) * voices;
    }
  }
  return toInt16(buf);
}
