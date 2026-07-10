// ============================================================================
// Deterministic seeded shuffle (spec: per-attempt question + option order,
// recorded for stable resume). Server generates the order once at attempt
// creation and stores it; the seed makes it reproducible/testable.
// ============================================================================

/** Mulberry32 PRNG — small, fast, deterministic from a numeric seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates using a provided RNG. Returns a new array. */
export function shuffled<T>(items: readonly T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Shuffle indices [0..n) with a seed — used to record option/question order. */
export function shuffledIndices(n: number, seed: number): number[] {
  return shuffled(
    Array.from({ length: n }, (_, i) => i),
    mulberry32(seed),
  );
}
