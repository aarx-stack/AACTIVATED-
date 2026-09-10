/** Deterministic PRNG so the demo dataset is identical on every load. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T,>(rng: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rng() * arr.length)]!;

export const between = (rng: () => number, min: number, max: number): number =>
  min + rng() * (max - min);

export const intBetween = (rng: () => number, min: number, max: number): number =>
  Math.floor(between(rng, min, max + 1));

export const chance = (rng: () => number, p: number): boolean => rng() < p;
