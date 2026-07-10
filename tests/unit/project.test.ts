import { describe, it, expect } from "vitest";
import { projectQuestion, FORBIDDEN_CLIENT_FIELDS } from "../../api/src/shared/project.js";
import type { QuestionRow } from "../../api/src/shared/types.js";

const row: QuestionRow = {
  examId: "CCAO-F",
  questionId: "D1-01",
  domain: 1,
  type: "single",
  stem: "Which prompt is best?",
  options: ["A", "B", "C", "D"],
  correct: [2],
  rationale: "C is specific.",
  referenceText: "Claude Docs — Be clear and direct",
  referenceUrl: "https://docs.claude.com/x",
  status: "published",
};

describe("projectQuestion — key-safety", () => {
  it("returns only public fields, NEVER key/rationale/reference", () => {
    const pub = projectQuestion(row) as unknown as Record<string, unknown>;
    for (const f of FORBIDDEN_CLIENT_FIELDS) {
      expect(pub, `leaked ${f}`).not.toHaveProperty(f);
    }
    expect(Object.keys(pub).sort()).toEqual(["domain", "options", "qid", "stem", "type"]);
  });

  it("serialized payload contains no answer/rationale substrings", () => {
    const json = JSON.stringify(projectQuestion(row));
    expect(json).not.toContain("rationale");
    expect(json).not.toContain("docs.claude.com");
    expect(json).not.toContain("\"correct\"");
  });

  it("applies option order without exposing the key", () => {
    const pub = projectQuestion(row, [3, 2, 1, 0]);
    expect(pub.options).toEqual(["D", "C", "B", "A"]);
    expect(pub as unknown as Record<string, unknown>).not.toHaveProperty("correct");
  });
});
