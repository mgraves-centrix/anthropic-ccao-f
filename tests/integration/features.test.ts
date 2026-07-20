import { describe, it, expect } from "vitest";
import { buildCtx, principal } from "./helpers.js";
import { mulberry32 } from "../../api/src/shared/shuffle.js";
import {
  createAttempt, saveAttempt, submitAttempt, getReview,
  setBookmark, removeBookmark, listBookmarks, listDrafts,
} from "../../api/src/shared/service.js";
import type { QuestionRow } from "../../api/src/shared/types.js";

const U = "feat-user";
const opts = (seed = 1) => ({ now: Date.parse("2026-07-10T12:00:00Z"), rand: mulberry32(seed) });

async function practiceAllWrong(ctx: Awaited<ReturnType<typeof buildCtx>>) {
  const att = await createAttempt(U, "STD", "practice", { count: 4, domains: [1] }, ctx, opts());
  // submit with no answers → everything wrong
  await saveAttempt(U, att.attemptId, { rev: 1, answers: {} }, ctx, opts());
  const res = await submitAttempt(U, att.attemptId, ctx, opts());
  return { att, res };
}

describe("bookmarks & personal notes", () => {
  it("set (with note), list, and remove", async () => {
    const ctx = await buildCtx();
    await setBookmark(U, "STD", "Q1", "revisit the apportionment logic", ctx);
    let list = await listBookmarks(U, "STD", ctx);
    expect(list).toHaveLength(1);
    expect(list[0]!.qid).toBe("Q1");
    expect(list[0]!.note).toContain("apportionment");
    await removeBookmark(U, "STD", "Q1", ctx);
    list = await listBookmarks(U, "STD", ctx);
    expect(list).toHaveLength(0);
  });
});

describe("review mode (finalized attempts)", () => {
  it("409 before submit, full review after", async () => {
    const ctx = await buildCtx();
    const att = await createAttempt(U, "STD", "mock", undefined, ctx, opts());
    await expect(getReview(U, att.attemptId, ctx)).rejects.toMatchObject({ status: 409 });
    await saveAttempt(U, att.attemptId, { rev: 1, answers: {} }, ctx, opts());
    await submitAttempt(U, att.attemptId, ctx, opts());
    const review = await getReview(U, att.attemptId, ctx);
    expect(review.review.length).toBe(6);
    expect(review.review[0]).toHaveProperty("correctKeys");
  });
});

describe("retry-incorrect & weak practice", () => {
  it("source=incorrect draws only previously-wrong questions", async () => {
    const ctx = await buildCtx();
    const { res } = await practiceAllWrong(ctx);
    const wrong = new Set(res.review.filter((r) => !r.correct).map((r) => r.qid));
    expect(wrong.size).toBeGreaterThan(0);
    const retry = await createAttempt(U, "STD", "practice", { source: "incorrect" }, ctx, opts(2));
    expect(retry.questions.length).toBeGreaterThan(0);
    for (const q of retry.questions) expect(wrong.has(q.qid)).toBe(true);
  });

  it("source=weak surfaces low-box questions (SRS reset on wrong)", async () => {
    const ctx = await buildCtx();
    await practiceAllWrong(ctx);
    const weak = await createAttempt(U, "STD", "practice", { source: "weak" }, ctx, opts(3));
    expect(weak.questions.length).toBeGreaterThan(0);
  });

  it("source=bookmarked draws bookmarked questions", async () => {
    const ctx = await buildCtx();
    await setBookmark(U, "STD", "Q2", undefined, ctx);
    const bm = await createAttempt(U, "STD", "practice", { source: "bookmarked" }, ctx, opts(4));
    expect(bm.questions.map((q) => q.qid)).toContain("Q2");
  });

  it("empty selection → 409", async () => {
    const ctx = await buildCtx();
    await expect(createAttempt(U, "STD", "practice", { source: "incorrect" }, ctx, opts())).rejects.toMatchObject({ status: 409 });
  });
});

describe("configurable practice — reproducible by seed", () => {
  it("same seed yields the same question order", async () => {
    const ctx = await buildCtx();
    const a = await createAttempt("s1", "STD", "practice", { count: 4, seed: 77 }, ctx, opts());
    const b = await createAttempt("s2", "STD", "practice", { count: 4, seed: 77 }, ctx, opts(9));
    expect(a.questions.map((q) => q.qid)).toEqual(b.questions.map((q) => q.qid));
  });
});

describe("spaced-repetition stats", () => {
  it("wrong resets box to 0; correct advances it", async () => {
    const ctx = await buildCtx();
    await practiceAllWrong(ctx); // all wrong → box 0
    const s = await ctx.stats.list(U, "STD");
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((x) => x.box === 0 && x.wrong >= 1)).toBe(true);
  });
});

describe("reviewer draft preview", () => {
  it("reviewer/admin see drafts; others are forbidden", async () => {
    const ctx = await buildCtx();
    const draft: QuestionRow = {
      examId: "STD", questionId: "DRAFT-1", domain: 1, type: "single", stem: "A draft question?",
      options: ["a", "b", "c", "d"], correct: [0], rationale: "r", referenceText: "ref", status: "draft",
    };
    await ctx.questions.put(draft);
    const reviewer = principal("aad", "rev", { roles: ["authenticated", "authorized", "reviewer"] });
    const plain = principal("aad", "usr", { roles: ["authenticated", "authorized"] });
    const drafts = await listDrafts(reviewer, "STD", ctx);
    expect(drafts.map((d) => d.questionId)).toContain("DRAFT-1");
    await expect(listDrafts(plain, "STD", ctx)).rejects.toMatchObject({ status: 403 });
  });
});
