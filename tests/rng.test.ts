import { describe, expect, it } from "vitest";
import { createRng, deriveRng, deriveSeed } from "../src/core/rng.js";

describe("rng", () => {
  it("is deterministic for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it("produces different streams for different seeds", () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("derives stable child streams by label", () => {
    expect(deriveSeed(7, "match:x")).toBe(deriveSeed(7, "match:x"));
    expect(deriveSeed(7, "match:x")).not.toBe(deriveSeed(7, "match:y"));
    const a = deriveRng(7, "squad:ARS");
    const b = deriveRng(7, "squad:ARS");
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it("supports checkpoint save/restore of internal state", () => {
    const rng = createRng(9);
    for (let i = 0; i < 100; i++) rng.next();
    const snapshot = rng.getState();
    const after = Array.from({ length: 50 }, () => rng.next());
    rng.setState(snapshot);
    const replayed = Array.from({ length: 50 }, () => rng.next());
    expect(replayed).toEqual(after);
  });

  it("int() covers the inclusive range uniformly-ish", () => {
    const rng = createRng(3);
    const counts = new Map<number, number>();
    for (let i = 0; i < 6000; i++) {
      const v = rng.int(1, 6);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    for (let v = 1; v <= 6; v++) {
      expect(counts.get(v) ?? 0).toBeGreaterThan(800);
    }
  });
});
