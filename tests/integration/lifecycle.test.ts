import { describe, it, expect } from "vitest";
import { buildCtx } from "./helpers.js";
import { mulberry32 } from "../../api/src/shared/shuffle.js";
import {
  createAttempt, saveAttempt, submitAttempt, practiceAnswer, resume, catalog, studyGuide,
} from "../../api/src/shared/service.js";

const U = "user-1";
const T0 = Date.parse("2026-07-10T12:00:00Z");
const opts = (now = T0, seed = 123) => ({ now, rand: mulberry32(seed) });

describe("catalog", () => {
  it("returns exams without keys", async () => {
    const ctx = await buildCtx();
    const cat = await catalog(ctx);
    expect(cat.map((e) => e.examId).sort()).toEqual(["SCN", "STD"]);
    expect(JSON.stringify(cat)).not.toContain("correct");
  });
});

describe("mock lifecycle + scoring", () => {
  it("creates 6-item blueprint mock, scores all-correct = 1000 pass", async () => {
    const ctx = await buildCtx();
    const o = opts();
    const att = await createAttempt(U, "STD", "mock", undefined, ctx, o);
    expect(att.questions).toHaveLength(6);
    expect(att.expiresAt).toBeDefined();

    // Act as the client: read stored optionOrder to choose correct DISPLAY positions.
    const stored = await ctx.attempts.find(U, att.attemptId);
    const order = stored!.progress!.optionOrder;
    const qorder = stored!.progress!.questionOrder;
    const answers: Record<string, number[]> = {};
    for (const qid of qorder) {
      const q = await ctx.questions.get("STD", qid);
      // display position d where optionOrder[d] === original correct index
      answers[qid] = q!.correct.map((c) => order[qid]!.indexOf(c));
    }
    await saveAttempt(U, att.attemptId, { rev: 1, answers }, ctx, o);
    const res = await submitAttempt(U, att.attemptId, ctx, o);
    expect(res.correct).toBe(6);
    expect(res.scaled).toBe(1000);
    expect(res.pass).toBe(true);
    expect(res.verdict).toBe("green");
  });

  it("mock withholds per-item feedback (practiceAnswer → 403)", async () => {
    const ctx = await buildCtx();
    const att = await createAttempt(U, "STD", "mock", undefined, ctx, opts());
    const qid = att.questions[0]!.qid;
    await expect(practiceAnswer(U, att.attemptId, qid, [0], ctx)).rejects.toMatchObject({ status: 403 });
  });

  it("submit is idempotent", async () => {
    const ctx = await buildCtx();
    const o = opts();
    const att = await createAttempt(U, "STD", "mock", undefined, ctx, o);
    await saveAttempt(U, att.attemptId, { rev: 1, answers: {} }, ctx, o);
    const r1 = await submitAttempt(U, att.attemptId, ctx, o);
    const r2 = await submitAttempt(U, att.attemptId, ctx, o);
    expect(r1.scaled).toBe(r2.scaled);
  });
});

describe("practice instant feedback", () => {
  it("returns correctness + rationale for the answered item", async () => {
    const ctx = await buildCtx();
    const o = opts();
    const att = await createAttempt(U, "STD", "practice", { count: 4 }, ctx, o);
    const stored = await ctx.attempts.find(U, att.attemptId);
    const qid = att.questions[0]!.qid;
    const q = await ctx.questions.get("STD", qid);
    const correctDisplay = q!.correct.map((c) => stored!.progress!.optionOrder[qid]!.indexOf(c));
    const fb = await practiceAnswer(U, att.attemptId, qid, correctDisplay, ctx);
    expect(fb.correct).toBe(true);
    expect(fb.rationale).toContain("reason");
  });
});

describe("resume + two-tab conflict", () => {
  it("restores question/option order; stale rev → 409", async () => {
    const ctx = await buildCtx();
    const o = opts();
    const att = await createAttempt(U, "STD", "practice", { count: 4 }, ctx, o);
    const stored = await ctx.attempts.find(U, att.attemptId);
    const r = await resume(U, "STD", ctx, o);
    expect(r[0]!.progress!.questionOrder).toEqual(stored!.progress!.questionOrder);

    await saveAttempt(U, att.attemptId, { rev: 1, currentIndex: 2 }, ctx, o); // rev→2
    await expect(saveAttempt(U, att.attemptId, { rev: 1, currentIndex: 3 }, ctx, o))
      .rejects.toMatchObject({ status: 409 });
  });
});

describe("mock timer keeps running → auto-submit on expiry", () => {
  it("finalizes an expired mock as 'expired' and removes it from in-progress", async () => {
    const ctx = await buildCtx();
    const att = await createAttempt(U, "STD", "mock", undefined, ctx, opts());
    // 121 minutes later
    const later = { now: T0 + 121 * 60000, rand: mulberry32(9) };
    const inprog = await resume(U, "STD", ctx, later);
    expect(inprog).toHaveLength(0); // auto-submitted away
    const stored = await ctx.attempts.find(U, att.attemptId);
    expect(stored!.status).toBe("expired");
    expect(stored!.submittedAt).toBeDefined();
  });
});

describe("3-day auto-clear of incompletes", () => {
  it("purges an in-progress practice attempt older than 3 days", async () => {
    const ctx = await buildCtx();
    const att = await createAttempt(U, "STD", "practice", { count: 4 }, ctx, opts());
    const later = { now: T0 + 3 * 86400000 + 1000, rand: mulberry32(1) };
    await resume(U, "STD", ctx, later); // triggers lazy cleanup
    expect(await ctx.attempts.find(U, att.attemptId)).toBeUndefined();
  });
});

describe("study guide", () => {
  it("returns the seeded guide (no key material)", async () => {
    const ctx = await buildCtx();
    const g = await studyGuide(ctx, "STD") as { title: string; sections: unknown[] };
    expect(g.title).toBe("Standard Study Guide");
    expect(g.sections).toHaveLength(1);
    expect(await studyGuide(ctx, "NOPE")).toBeNull();
  });
});

describe("scenario mock (CCAR-F shape)", () => {
  it("draws 4 scenarios, groups their questions, records scenarioPick", async () => {
    const ctx = await buildCtx();
    const att = await createAttempt(U, "SCN", "mock", undefined, ctx, opts());
    expect(att.scenarios).toHaveLength(4);
    // every returned question belongs to one of the chosen scenarios
    const picked = new Set(att.scenarios!.map((s) => s.id));
    for (const q of att.questions) expect(picked.has(q.scenarioId!)).toBe(true);
    const stored = await ctx.attempts.find(U, att.attemptId);
    expect(stored!.progress!.scenarioPick).toHaveLength(4);
  });
});
