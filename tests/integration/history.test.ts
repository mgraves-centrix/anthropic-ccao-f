import { describe, it, expect } from "vitest";
import { buildCtx } from "./helpers.js";
import { mulberry32 } from "../../api/src/shared/shuffle.js";
import { createAttempt, submitAttempt, history } from "../../api/src/shared/service.js";

const U = "hist-user";
const DAY = 86400000;
const t0 = Date.parse("2026-07-01T12:00:00Z");

async function finishMock(ctx: Awaited<ReturnType<typeof buildCtx>>, examId: string, at: number, seed: number) {
  const att = await createAttempt(U, examId, "mock", undefined, ctx, { now: at, rand: mulberry32(seed) });
  await submitAttempt(U, att.attemptId, ctx, { now: at });
}

describe("history() — windowing + scope (aggregates only)", () => {
  it("exam scope honors the 7/30-day window by date", async () => {
    const ctx = await buildCtx();
    await finishMock(ctx, "STD", t0, 1);            // day 0
    await finishMock(ctx, "STD", t0 + 2 * DAY, 2);  // day 2
    await finishMock(ctx, "STD", t0 + 9 * DAY, 3);  // day 9
    const now = t0 + 9 * DAY;

    const w7 = await history(U, "exam", "STD", 7, ctx, { now });
    expect(w7.points.length).toBe(2); // day 2 and day 9 fall within the 7-day window
    expect(w7.cutScore).toBe(720);

    const w30 = await history(U, "exam", "STD", 30, ctx, { now });
    expect(w30.points.length).toBe(3);
    expect(w30.byDomain).toBeDefined();
    expect(w30.points.every((p) => typeof p.scaled === "number" && typeof p.pass === "boolean")).toBe(true);
  });

  it("empty window yields no points but a valid shape", async () => {
    const ctx = await buildCtx();
    await finishMock(ctx, "STD", t0, 1);
    const r = await history(U, "exam", "STD", 7, ctx, { now: t0 + 60 * DAY });
    expect(r.points).toEqual([]);
    expect(r.byDomain).toBeDefined();
  });

  it("all-exams scope aggregates across exams (byExam)", async () => {
    const ctx = await buildCtx();
    await finishMock(ctx, "STD", t0 + DAY, 1);
    await finishMock(ctx, "SCN", t0 + DAY, 2);
    const r = await history(U, "all", undefined, 30, ctx, { now: t0 + 2 * DAY }) as { points: unknown[]; byExam: { examId: string }[] };
    expect(r.points.length).toBe(2);
    expect(r.byExam.map((e) => e.examId).sort()).toEqual(["SCN", "STD"]);
  });

  it("returns only aggregates — never questions or keys", async () => {
    const ctx = await buildCtx();
    await finishMock(ctx, "STD", t0, 1);
    const r = await history(U, "exam", "STD", 30, ctx, { now: t0 + DAY });
    expect(JSON.stringify(r)).not.toMatch(/"correct"|rationale|referenceUrl|stem|options/);
  });
});
