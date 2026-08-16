/** Deterministic 32-bit PRNG (mulberry32). Same seed -> same sequence. */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a per-variant seed from a base seed and variant index. */
export function variantSeed(baseSeed: number, variant: number): number {
  return (baseSeed * 31 + variant * 2654435761) >>> 0;
}
