/**
 * Deterministic seeded RNG (requirement 3.2).
 *
 * All randomness in the simulation must flow through an `Rng` instance derived
 * from the single world seed. Direct use of `Math.random()` is forbidden.
 *
 * Implementation: sfc32 (Small Fast Counter) seeded via splitmix32. Streams can
 * be derived with `deriveRng(parent, label)` so that independent subsystems
 * (e.g. one match vs. another) consume randomness in a stable order regardless
 * of how much the sibling stream consumes.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive (exact, via rejection sampling). */
  int(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Pick a uniformly random element. Throws on empty array. */
  pick<T>(items: readonly T[]): T;
  /** Standard normal (Box-Muller). */
  gaussian(mean?: number, stdDev?: number): number;
  /** Index into `weights` proportionally to each weight. */
  weightedIndex(weights: readonly number[]): number;
  /** Snapshot of internal state for checkpoints (requirement 3.2). */
  getState(): RngState;
  /** Restore a snapshot taken with getState(). */
  setState(state: RngState): void;
}

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

function splitmix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z ^= z >>> 16;
    z = Math.imul(z, 0x21f0aaad);
    z ^= z >>> 15;
    z = Math.imul(z, 0x735a2d97);
    z ^= z >>> 15;
    return z >>> 0;
  };
}

class Sfc32 implements Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    const mix = splitmix32(seed);
    this.a = mix();
    this.b = mix();
    this.c = mix();
    this.d = mix();
    // Warm up so nearby seeds decorrelate.
    for (let i = 0; i < 12; i++) this.next();
  }

  private nextUint32(): number {
    const t = (this.a + this.b + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  next(): number {
    return this.nextUint32() / 4294967296;
  }

  int(min: number, max: number): number {
    if (max < min) throw new Error(`int(): max ${max} < min ${min}`);
    const range = max - min + 1;
    // Rejection sampling for exact uniformity over ranges not dividing 2^32.
    const limit = 4294967296 - (4294967296 % range);
    let v = this.nextUint32();
    while (v >= limit) v = this.nextUint32();
    return min + (v % range);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick(): empty array");
    return items[this.int(0, items.length - 1)] as T;
  }

  gaussian(mean = 0, stdDev = 1): number {
    // Box-Muller; consume exactly two draws per call for determinism.
    const u1 = Math.max(this.next(), 1e-12);
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * stdDev;
  }

  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) throw new Error("weightedIndex(): non-positive total weight");
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i] as number;
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  getState(): RngState {
    return { a: this.a, b: this.b, c: this.c, d: this.d };
  }

  setState(state: RngState): void {
    this.a = state.a >>> 0;
    this.b = state.b >>> 0;
    this.c = state.c >>> 0;
    this.d = state.d >>> 0;
  }
}

export function createRng(seed: number): Rng {
  return new Sfc32(seed);
}

/**
 * Locale-independent string ordering for deterministic tie-breaks.
 * `localeCompare` varies with the host ICU configuration and would break
 * "same seed = same history" across machines.
 */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Stable 32-bit hash of a string (FNV-1a). */
export function hashLabel(label: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Derive an independent child stream from a numeric seed and a label, e.g.
 * `deriveSeed(worldSeed, "match:2026-08-15:ARS-MCI")`. Deriving (rather than
 * sharing one stream) keeps subsystems reproducible in isolation.
 */
export function deriveSeed(seed: number, label: string): number {
  return (Math.imul(seed >>> 0, 0x9e3779b1) ^ hashLabel(label)) >>> 0;
}

export function deriveRng(seed: number, label: string): Rng {
  return createRng(deriveSeed(seed, label));
}
