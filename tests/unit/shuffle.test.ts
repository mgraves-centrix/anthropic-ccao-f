import { describe, it, expect } from "vitest";
import { shuffledIndices, mulberry32, shuffled } from "../../api/src/shared/shuffle.js";

describe("seeded shuffle — reproducible for resume, varied across attempts", () => {
  it("same seed → same order (stable resume)", () => {
    expect(shuffledIndices(10, 42)).toEqual(shuffledIndices(10, 42));
  });
  it("different seeds → different order (per-attempt randomness)", () => {
    expect(shuffledIndices(20, 1)).not.toEqual(shuffledIndices(20, 2));
  });
  it("is a permutation (no lost/duplicated items)", () => {
    const idx = shuffledIndices(50, 7);
    expect([...idx].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });
  it("shuffled preserves elements", () => {
    const src = ["a", "b", "c", "d"];
    const out = shuffled(src, mulberry32(3));
    expect([...out].sort()).toEqual([...src].sort());
  });
});
