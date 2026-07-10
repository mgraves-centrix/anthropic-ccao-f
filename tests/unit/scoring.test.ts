import { describe, it, expect } from "vitest";
import {
  isItemCorrect,
  scaledFromAccuracy,
  verdictFor,
  apportion,
  weakDomains,
  scoreAttempt,
  CUT,
} from "../../api/src/shared/scoring.js";
import type { Domain, QuestionRow } from "../../api/src/shared/types.js";

describe("isItemCorrect — ALL-OR-NOTHING multi-select", () => {
  it("single correct", () => {
    expect(isItemCorrect([2], [2])).toBe(true);
    expect(isItemCorrect([2], [1])).toBe(false);
  });
  it("multi exact set (order-independent)", () => {
    expect(isItemCorrect([0, 3], [3, 0])).toBe(true);
  });
  it("multi partial is WRONG (no partial credit)", () => {
    expect(isItemCorrect([0, 3], [0])).toBe(false);
    expect(isItemCorrect([0, 3], [0, 3, 1])).toBe(false);
  });
  it("empty answer is wrong", () => {
    expect(isItemCorrect([1], [])).toBe(false);
  });
});

describe("scaledFromAccuracy + verdict", () => {
  it("formula endpoints", () => {
    expect(scaledFromAccuracy(0)).toBe(100);
    expect(scaledFromAccuracy(1)).toBe(1000);
    expect(scaledFromAccuracy(0.5)).toBe(550);
  });
  it("720 cut lands near 68.9% accuracy", () => {
    expect(scaledFromAccuracy(0.689)).toBeGreaterThanOrEqual(CUT);
    expect(scaledFromAccuracy(0.68)).toBeLessThan(CUT);
  });
  it("verdict bands: green>=760, amber 720..759, red<720", () => {
    expect(verdictFor(800)).toBe("green");
    expect(verdictFor(760)).toBe("green");
    expect(verdictFor(759)).toBe("amber");
    expect(verdictFor(720)).toBe("amber");
    expect(verdictFor(719)).toBe("red");
  });
});

describe("apportion — largest remainder, blueprint-weighted", () => {
  const domains: Domain[] = [
    { id: 1, name: "D1", weight: 27 },
    { id: 2, name: "D2", weight: 18 },
    { id: 3, name: "D3", weight: 20 },
    { id: 4, name: "D4", weight: 20 },
    { id: 5, name: "D5", weight: 15 },
  ];
  it("sums to total and respects availability", () => {
    const avail = { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100 };
    const out = apportion(60, domains, avail);
    const sum = Object.values(out).reduce((s, n) => s + n, 0);
    expect(sum).toBe(60);
    expect(out[1]).toBeGreaterThan(out[5]!); // heavier domain gets more
  });
  it("never exceeds available items", () => {
    const avail = { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 };
    const out = apportion(60, domains, avail);
    for (const id of [1, 2, 3, 4, 5]) expect(out[id]).toBeLessThanOrEqual(2);
  });
});

describe("scoreAttempt + weakDomains", () => {
  const domains: Domain[] = [
    { id: 1, name: "Heavy", weight: 40 },
    { id: 2, name: "Light", weight: 10 },
  ];
  const q = (id: string, domain: number, correct: number[]): QuestionRow => ({
    examId: "X",
    questionId: id,
    domain,
    type: correct.length > 1 ? "multiple" : "single",
    stem: "s",
    options: ["a", "b", "c", "d"],
    correct,
    rationale: "because",
    referenceText: "ref",
    referenceUrl: "https://docs.claude.com/x",
    status: "published",
  });
  it("scores and builds byDomain + review", () => {
    const questions = [q("A", 1, [0]), q("B", 1, [1]), q("C", 2, [2])];
    const answers = { A: [0], B: [3], C: [2] }; // A right, B wrong, C right
    const r = scoreAttempt(questions, answers, domains);
    expect(r.correct).toBe(2);
    expect(r.total).toBe(3);
    expect(r.byDomain["1"]).toEqual({ c: 1, t: 2, pct: 50 });
    expect(r.byDomain["2"]).toEqual({ c: 1, t: 1, pct: 100 });
    expect(r.review).toHaveLength(3);
  });
  it("weakDomains ranks by weakness*weight (biggest lever first)", () => {
    const byDomain = { "1": { c: 3, t: 5 }, "2": { c: 0, t: 5 } }; // D1 60%, D2 0%
    const w = weakDomains(byDomain, domains);
    // D2 is 0% but light(10); D1 60% but heavy(40): lever D1=(.1)*40=4 vs D2=(.7)*10=7 → D2 first
    expect(w[0]!.id).toBe(2);
    expect(w.map((d) => d.id)).toEqual([2, 1]);
  });
});
