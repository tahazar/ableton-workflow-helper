/**
 * awh endless player (docs/design/endless-player.md).
 *
 * One file, ESM, zero dependencies. This exact file is imported both by
 * `packages/cli/test/endless.test.ts` (Node/vitest, no DOM/Web Audio) and
 * by the emitted `index.html` (browser), so there is no second copy of the
 * decision logic. To keep that safe, the file is split into two halves:
 *
 *   1. Pure decision core: the PRNG, section picker, variant picker, mute
 *      roller, and fluctuation walk. Every one of these is a pure function
 *      of (spec, state[, extra ids]) -> new value, with no reference to
 *      `window`/`document`/`AudioContext` anywhere in the call graph. This
 *      is the half vitest exercises directly.
 *   2. Audio engine + bootstrap: Web Audio scheduling, DOM/UI wiring. Every
 *      reference to browser globals lives inside function bodies here, and
 *      the only top-level side effect (the bootstrap block at the bottom)
 *      is guarded by `typeof window !== "undefined"`, so importing this
 *      module under Node is inert.
 *
 * Same seed + same spec => byte-identical decision sequence: every pure
 * function below takes an explicit rngState (a plain uint32) and returns a
 * new one rather than mutating a closure. There is no Math.random/Date.now
 * anywhere in section 1.
 */

// ============================================================================
// 1. Pure decision core
// ============================================================================

const BEATS_PER_BAR = 4; // v1: 4/4 only (EndlessSpec.sig)
const GAIN_WALK_TIME_CONSTANT_S = 4; // "multi-second time constant" per design doc
const FILTER_WALK_TIME_CONSTANT_S = 6;

/**
 * mulberry32, written as a pure step: (rngState) -> {value in [0,1), state}.
 * The standard mulberry32 body, returning the advanced state instead of
 * mutating a closed-over variable, so callers can replay/branch/compare
 * sequences deterministically.
 */
export function nextRandom(rngState) {
  let state = (rngState + 0x6d2b79f5) | 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state };
}

/** Normalize any integer seed into a valid mulberry32 rng state. */
export function seedToRngState(seed) {
  return (seed >>> 0) | 0;
}

export function findSection(spec, sectionId) {
  const section = spec.sections.find((s) => s.id === sectionId);
  if (!section) throw new Error(`endless player: unknown section "${sectionId}"`);
  return section;
}

export function sectionDurationSeconds(spec, section) {
  return (section.bars * BEATS_PER_BAR * 60) / spec.bpm;
}

function trailingRunLength(history, id) {
  let n = 0;
  for (let i = history.length - 1; i >= 0 && history[i] === id; i--) n++;
  return n;
}

function weightedPick(edges, rngValue) {
  const total = edges.reduce((sum, e) => sum + e.weight, 0);
  let r = rngValue * total;
  for (const edge of edges) {
    if (r < edge.weight) return edge;
    r -= edge.weight;
  }
  return edges[edges.length - 1];
}

/** Fresh, empty performance state for `spec`, seeded with `seed` (already
 * resolved; see `resolveSeed` in the audio-engine half for turning the
 * spec's seed:0 "random each load" into a concrete number). */
export function createInitialState(spec, seed) {
  const fluctuation = {};
  for (const layer of spec.layers) {
    fluctuation[layer.id] = {
      gainOffsetDb: 0,
      filterHz: layer.fluctuate ? (layer.fluctuate.filterHz[0] + layer.fluctuate.filterHz[1]) / 2 : null,
    };
  }
  return {
    rngState: seedToRngState(seed),
    currentSectionId: null,
    sectionHistory: [],
    variantHistory: {},
    fluctuation,
  };
}

/**
 * Section picker. First call (state.currentSectionId === null) always
 * enters the spec's first declared section (the performance's entry point;
 * no randomness consumed). After that: a weighted pick over
 * `transitions[currentSectionId]`, honoring `rules.maxConsecutive` by
 * excluding a self-edge once the current section has already played that
 * many times in a row. A section with no outgoing edges (or whose only
 * option was just excluded by maxConsecutive) self-loops rather than throw.
 * A dead end is a spec authoring problem `validateEndlessSpec`/`awh
 * endless build` should catch, not something the player crashes on.
 */
export function pickNextSection(spec, state) {
  if (state.currentSectionId == null) {
    const entry = spec.sections[0];
    if (!entry) throw new Error("endless player: spec has no sections");
    return { sectionId: entry.id, rngState: state.rngState };
  }
  const current = state.currentSectionId;
  const edges = spec.transitions[current] ?? [];
  const consecutive = trailingRunLength(state.sectionHistory, current);
  let candidates = edges.filter((e) => e.to !== current || consecutive < spec.rules.maxConsecutive);
  if (candidates.length === 0) candidates = edges.length > 0 ? edges : [{ to: current, weight: 1 }];
  const { value, state: rngState } = nextRandom(state.rngState);
  const picked = weightedPick(candidates, value);
  return { sectionId: picked.to, rngState };
}

/**
 * Variant picker for one (sectionId, layerId) pool. Honors
 * `rules.noRepeatVariant`: a variant can't repeat within its pool's last N
 * picks, unless the pool is too small to satisfy that (then the exclusion
 * is dropped for this pick rather than deadlocking).
 */
export function pickVariant(spec, state, sectionId, layerId) {
  const section = findSection(spec, sectionId);
  const pool = section.pools[layerId];
  if (!pool || pool.length === 0) {
    throw new Error(`endless player: section "${sectionId}" has no pool for layer "${layerId}"`);
  }
  const history = state.variantHistory[sectionId]?.[layerId] ?? [];
  const noRepeat = spec.rules.noRepeatVariant;
  const excluded = noRepeat > 0 ? new Set(history.slice(-noRepeat)) : new Set();
  let candidates = pool.map((_, i) => i).filter((i) => !excluded.has(i));
  if (candidates.length === 0) candidates = pool.map((_, i) => i);
  const { value, state: rngState } = nextRandom(state.rngState);
  const index = candidates[Math.min(candidates.length - 1, Math.floor(value * candidates.length))];
  return { index, file: pool[index], rngState };
}

/**
 * Mute roller for a section's non-protected layers. Each layer that has a
 * pool in this section (excluding `rules.protectedLayers`) independently
 * rolls against `section.layerMuteProbability`. Protected layers never
 * appear in the returned list because the loop skips them.
 */
export function rollMutes(spec, state, sectionId) {
  const section = findSection(spec, sectionId);
  const protectedSet = new Set(spec.rules.protectedLayers);
  const muted = [];
  let rngState = state.rngState;
  for (const layerId of Object.keys(section.pools)) {
    if (protectedSet.has(layerId)) continue;
    const { value, state: next } = nextRandom(rngState);
    rngState = next;
    if (value < (section.layerMuteProbability ?? 0)) muted.push(layerId);
  }
  return { muted, rngState };
}

/** One bounded-random-walk step, reflected/clamped into [min, max]. `dtSeconds`
 * and `timeConstantSeconds` set how far a single step can move: the walk is
 * slow/continuous, not a jump, when timeConstantSeconds is several seconds. */
export function boundedRandomWalkStep(value, min, max, rngState, dtSeconds, timeConstantSeconds) {
  const { value: r, state } = nextRandom(rngState);
  const stepScale = ((max - min) / 2) * (dtSeconds / Math.max(timeConstantSeconds, 1e-6));
  let next = value + (r * 2 - 1) * stepScale;
  if (next > max) next = max;
  if (next < min) next = min;
  return { value: next, state };
}

/**
 * Advances every layer's continuous fluctuation values by `dtSeconds` of
 * (bounded) random walk: gain wanders +-`fluctuation.gainWalkDb`, and any
 * layer with `fluctuate.filterHz` also wanders its lowpass cutoff within
 * that range. This is the "layer 2" continuous mix movement from the
 * design doc. It is independent of section boundaries, unlike the other
 * three decision functions, which only fire when a section is entered.
 */
export function stepFluctuation(spec, state, dtSeconds) {
  const fluctuation = {};
  let rngState = state.rngState;
  const bound = spec.fluctuation.gainWalkDb;
  for (const layer of spec.layers) {
    const prev = state.fluctuation[layer.id] ?? { gainOffsetDb: 0, filterHz: null };
    const gainStep = boundedRandomWalkStep(prev.gainOffsetDb, -bound, bound, rngState, dtSeconds, GAIN_WALK_TIME_CONSTANT_S);
    rngState = gainStep.state;
    let filterHz = null;
    if (layer.fluctuate) {
      const [lo, hi] = layer.fluctuate.filterHz;
      const start = prev.filterHz ?? (lo + hi) / 2;
      const filterStep = boundedRandomWalkStep(start, lo, hi, rngState, dtSeconds, FILTER_WALK_TIME_CONSTANT_S);
      rngState = filterStep.state;
      filterHz = filterStep.value;
    }
    fluctuation[layer.id] = { gainOffsetDb: gainStep.value, filterHz };
  }
  return { fluctuation, state: rngState };
}

/**
 * The single entry point that ties the three per-section decision
 * functions together and updates history. It picks the next section, then
 * a variant for every layer with a pool in it, then rolls mutes, all from
 * one advancing rngState. It returns the new performance state plus a
 * plain-data `decision` describing what was chosen, which both the UI's
 * "honesty line" readout and the audio engine consume. Calling this
 * repeatedly from the same seed reproduces the exact same sequence of
 * decisions (see packages/cli/test/endless.test.ts "same seed -> identical
 * decision sequence").
 */
export function advanceToNextSection(spec, state) {
  const picked = pickNextSection(spec, state);
  const sectionId = picked.sectionId;
  let rngState = picked.rngState;
  const section = findSection(spec, sectionId);

  const variants = {};
  for (const layerId of Object.keys(section.pools)) {
    const vpick = pickVariant(spec, { ...state, rngState }, sectionId, layerId);
    variants[layerId] = { index: vpick.index, file: vpick.file };
    rngState = vpick.rngState;
  }

  const muteRoll = rollMutes(spec, { ...state, rngState }, sectionId);
  rngState = muteRoll.rngState;

  const sectionHistory = [...state.sectionHistory, sectionId].slice(-64);
  const variantHistory = { ...state.variantHistory };
  const perSection = { ...(variantHistory[sectionId] ?? {}) };
  for (const [layerId, v] of Object.entries(variants)) {
    perSection[layerId] = [...(perSection[layerId] ?? []), v.index].slice(-32);
  }
  variantHistory[sectionId] = perSection;

  const newState = { ...state, rngState, currentSectionId: sectionId, sectionHistory, variantHistory };
  return {
    state: newState,
    decision: {
      sectionId,
      bars: section.bars,
      durationSeconds: sectionDurationSeconds(spec, section),
      variants,
      muted: muteRoll.muted,
    },
  };
}

// ============================================================================
// 2. Audio engine + bootstrap (browser only, never called from Node/vitest)
// ============================================================================

function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

/** seed:0 in the spec means "fresh random seed each load" (design doc). This
 * is the one impure step in this file, isolated here so the pure core above
 * never touches Math.random/crypto. */
function resolveSeed(specSeed) {
  if (specSeed && specSeed !== 0) return specSeed;
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 0xffffffff);
}

/** 32-sample equal-power crossfade curve, 0 -> 1 (cosine taper). Used for
 * both the fade-in of an entering section's sources and the fade-out of the
 * outgoing one, so the two together sum to (approximately) constant power. */
function equalPowerFadeInCurve() {
  const n = 32;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = Math.sin((Math.PI / 2) * (i / (n - 1)));
  return curve;
}
function equalPowerFadeOutCurve() {
  const n = 32;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = Math.cos((Math.PI / 2) * (i / (n - 1)));
  return curve;
}

const TICK_MS = 25; // lookahead scheduler tick
const HORIZON_S = 0.2; // schedule-ahead window

/**
 * Builds the Web Audio graph + lookahead scheduler for `spec` and returns a
 * small controller: start(), stop(), getDebugState(). All Web Audio API use
 * lives inside this function (never at module top level), so importing this
 * file in Node never touches AudioContext.
 */
export function createEngine(spec, options = {}) {
  const AudioContextCtor = options.AudioContextCtor ?? (typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : undefined);
  if (!AudioContextCtor) throw new Error("endless player: no AudioContext available in this environment");

  const seed = resolveSeed(spec.seed);
  let state = createInitialState(spec, seed);
  let ctx = null;
  let masterGain = null;
  const layerNodes = new Map(); // layerId -> { gain, filter }
  const bufferCache = new Map(); // file url -> AudioBuffer
  let nextBoundaryTime = 0;
  let tickHandle = null;
  let fluctuationLastTime = 0;
  let lastDecision = null;
  let playing = false;
  let startedAtCtxTime = 0;

  function ensureGraph() {
    ctx = new AudioContextCtor();
    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(ctx.destination);
    for (const layer of spec.layers) {
      const gain = ctx.createGain();
      gain.gain.value = dbToLinear(layer.gainDb);
      let filter = null;
      if (layer.fluctuate) {
        filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = (layer.fluctuate.filterHz[0] + layer.fluctuate.filterHz[1]) / 2;
        gain.connect(filter);
        filter.connect(masterGain);
      } else {
        gain.connect(masterGain);
      }
      layerNodes.set(layer.id, { gain, filter });
    }
  }

  async function loadBuffer(file) {
    if (bufferCache.has(file)) return bufferCache.get(file);
    const res = await fetch(file);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    bufferCache.set(file, buffer);
    return buffer;
  }

  async function preloadAllPools() {
    const files = new Set();
    for (const section of spec.sections) {
      for (const pool of Object.values(section.pools)) {
        for (const file of pool) files.add(file);
      }
    }
    await Promise.all([...files].map(loadBuffer));
  }

  function scheduleLayerSource(layerId, file, atTime, durationSeconds, muted) {
    const buffer = bufferCache.get(file);
    if (!buffer) return; // shouldn't happen post-preload; skip defensively
    const nodes = layerNodes.get(layerId);
    if (!nodes) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const instanceGain = ctx.createGain();
    const target = muted ? 0 : 1;
    const fadeS = Math.min(spec.crossfadeMs / 1000, durationSeconds / 2);
    instanceGain.gain.setValueCurveAtTime(equalPowerFadeInCurve().map((v) => v * target), atTime, fadeS);
    instanceGain.gain.setValueAtTime(target, atTime + fadeS);
    const fadeOutStart = atTime + durationSeconds - fadeS;
    instanceGain.gain.setValueAtTime(target, fadeOutStart);
    instanceGain.gain.setValueCurveAtTime(equalPowerFadeOutCurve().map((v) => v * target), fadeOutStart, fadeS);
    source.connect(instanceGain);
    instanceGain.connect(nodes.gain);
    source.start(atTime);
    source.stop(atTime + durationSeconds + 0.05);
  }

  function scheduleNextSection() {
    const { state: newState, decision } = advanceToNextSection(spec, state);
    state = newState;
    const mutedSet = new Set(decision.muted);
    for (const [layerId, v] of Object.entries(decision.variants)) {
      scheduleLayerSource(layerId, v.file, nextBoundaryTime, decision.durationSeconds, mutedSet.has(layerId));
    }
    lastDecision = { ...decision, startedAtCtxTime: nextBoundaryTime };
    nextBoundaryTime += decision.durationSeconds;
    if (options.onDecision) options.onDecision(decision);
  }

  function tick() {
    if (!ctx) return;
    while (nextBoundaryTime - ctx.currentTime < HORIZON_S) scheduleNextSection();
    const now = ctx.currentTime;
    const dt = fluctuationLastTime ? now - fluctuationLastTime : TICK_MS / 1000;
    fluctuationLastTime = now;
    const { fluctuation, state: rngState } = stepFluctuation(spec, state, dt);
    state = { ...state, fluctuation, rngState };
    for (const layer of spec.layers) {
      const nodes = layerNodes.get(layer.id);
      const f = fluctuation[layer.id];
      const linear = dbToLinear(layer.gainDb + f.gainOffsetDb);
      nodes.gain.gain.setTargetAtTime(linear, now, 0.5);
      if (nodes.filter && f.filterHz != null) {
        nodes.filter.frequency.setTargetAtTime(f.filterHz, now, 0.5);
      }
    }
    if (options.onTick) options.onTick(getDebugState());
  }

  function getDebugState() {
    return {
      seed,
      performanceNumber: seed,
      playing,
      elapsedSeconds: ctx ? ctx.currentTime - startedAtCtxTime : 0,
      currentSection: lastDecision,
      sectionHistory: state.sectionHistory.slice(-16),
    };
  }

  async function start() {
    if (playing) return;
    ensureGraph();
    await preloadAllPools();
    startedAtCtxTime = ctx.currentTime;
    nextBoundaryTime = ctx.currentTime + 0.1;
    playing = true;
    tickHandle = setInterval(tick, TICK_MS);
    tick();
  }

  function stop() {
    playing = false;
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = null;
    if (ctx) {
      ctx.close();
      ctx = null;
    }
  }

  return { start, stop, getDebugState, get spec() { return spec; } };
}

// ---- Bootstrap: only runs in a browser page that embeds ENDLESS_SPEC ----
if (typeof window !== "undefined" && window.ENDLESS_SPEC) {
  const spec = window.ENDLESS_SPEC;
  const engine = createEngine(spec, {
    onTick: (debugState) => updateReadout(debugState),
  });
  window.__endlessEngine = engine; // Playwright smoke test hook

  function el(id) {
    return document.getElementById(id);
  }

  function updateReadout(debugState) {
    const perfEl = el("endless-performance");
    const sectionEl = el("endless-section");
    const variantsEl = el("endless-variants");
    const layersEl = el("endless-layers");
    const elapsedEl = el("endless-elapsed");
    if (perfEl) perfEl.textContent = `performance #${debugState.performanceNumber}`;
    if (debugState.currentSection) {
      if (sectionEl) sectionEl.textContent = `${debugState.currentSection.sectionId} (${debugState.currentSection.bars} bars)`;
      if (variantsEl) {
        variantsEl.textContent = Object.entries(debugState.currentSection.variants)
          .map(([layerId, v]) => `${layerId}: ${v.file}`)
          .join(" | ");
      }
      if (layersEl) {
        const muted = new Set(debugState.currentSection.muted);
        layersEl.textContent = spec.layers
          .map((l) => (muted.has(l.id) ? `[${l.id} muted]` : l.id))
          .join("  ");
      }
    }
    if (elapsedEl) elapsedEl.textContent = `${debugState.elapsedSeconds.toFixed(1)}s`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    const playButton = el("endless-play");
    if (playButton) {
      playButton.addEventListener("click", async () => {
        if (playButton.dataset.playing === "1") {
          engine.stop();
          playButton.dataset.playing = "0";
          playButton.textContent = "Play";
        } else {
          playButton.disabled = true;
          playButton.textContent = "Loading...";
          await engine.start();
          playButton.disabled = false;
          playButton.dataset.playing = "1";
          playButton.textContent = "Pause";
        }
      });
    }
  });
}
