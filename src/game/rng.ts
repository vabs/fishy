/** Returns a float in [0, 1). The sim takes one of these so rounds can be replayed from a seed. */
export type Rng = () => number;

/** mulberry32: small, fast, good enough for gameplay randomness. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Picks a key with probability proportional to its weight. Undefined if every weight is 0. */
export function pickWeighted<K extends string>(rng: Rng, weights: Partial<Record<K, number>>): K | undefined {
  const entries = (Object.entries(weights) as [K, number | undefined][]).filter(([, w]) => (w ?? 0) > 0);
  const total = entries.reduce((sum, [, w]) => sum + (w ?? 0), 0);
  if (total <= 0) return undefined;
  let roll = rng() * total;
  for (const [key, w] of entries) {
    roll -= w ?? 0;
    if (roll < 0) return key;
  }
  // Float rounding can leave a sliver past the last weight.
  return entries[entries.length - 1]?.[0];
}
