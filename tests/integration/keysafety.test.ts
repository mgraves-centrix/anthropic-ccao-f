import { describe, it, expect } from "vitest";
import { buildCtx } from "./helpers.js";
import { mulberry32 } from "../../api/src/shared/shuffle.js";
import { createAttempt, saveAttempt, resume } from "../../api/src/shared/service.js";

const U = "user-ks";
const o = () => ({ now: Date.parse("2026-07-10T12:00:00Z"), rand: mulberry32(5) });
const LEAK = /"correct"|rationale|referenceUrl|docs\.claude\.com|"reference"/;

describe("KEY-LEAK GATE: no answer key in non-submit/answer payloads", () => {
  it("createAttempt payload carries stems+options only", async () => {
    const ctx = await buildCtx();
    const att = await createAttempt(U, "STD", "mock", undefined, ctx, o());
    expect(JSON.stringify(att)).not.toMatch(LEAK);
    for (const q of att.questions) {
      expect(Object.keys(q).sort()).toEqual(
        expect.arrayContaining(["qid", "stem", "options", "type", "domain"]),
      );
      expect(q as unknown as Record<string, unknown>).not.toHaveProperty("correct");
    }
  });

  it("save (PATCH) response has no correctness", async () => {
    const ctx = await buildCtx();
    const att = await createAttempt(U, "STD", "mock", undefined, ctx, o());
    const res = await saveAttempt(U, att.attemptId, { rev: 1, answers: { [att.questions[0]!.qid]: [0] } }, ctx, o());
    expect(JSON.stringify(res)).not.toMatch(LEAK);
    expect(res as Record<string, unknown>).not.toHaveProperty("correct");
  });

  it("resume payload has no keys", async () => {
    const ctx = await buildCtx();
    const att = await createAttempt(U, "STD", "mock", undefined, ctx, o());
    void att;
    const r = await resume(U, "STD", ctx, o());
    expect(JSON.stringify(r)).not.toMatch(LEAK);
  });
});
