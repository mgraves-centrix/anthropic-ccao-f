import { MemoryTableRepo } from "../../api/src/shared/tables.js";
import { ExamsRepo, QuestionsRepo, ScenariosRepo, AttemptsRepo, UsersRepo, StudyGuideRepo, BookmarksRepo, StatsRepo } from "../../api/src/shared/repos.js";
import type { Ctx } from "../../api/src/shared/service.js";
import type { ClientPrincipal } from "../../api/src/shared/auth.js";
import type { ExamMeta, QuestionRow } from "../../api/src/shared/types.js";

const theme: ExamMeta["theme"] = {
  accent: "#3b44d9", accentInk: "#2a31a8", accentTint: "#ececfb",
  accentDark: "#8b93ff", accentInkDark: "#b6bbff", accentTintDark: "#23253a", onAccent: "#ffffff",
};

export async function buildCtx(): Promise<Ctx> {
  const ctx: Ctx = {
    exams: new ExamsRepo(new MemoryTableRepo()),
    questions: new QuestionsRepo(new MemoryTableRepo()),
    scenarios: new ScenariosRepo(new MemoryTableRepo()),
    attempts: new AttemptsRepo(new MemoryTableRepo()),
    users: new UsersRepo(new MemoryTableRepo()),
    study: new StudyGuideRepo(new MemoryTableRepo()),
    bookmarks: new BookmarksRepo(new MemoryTableRepo()),
    stats: new StatsRepo(new MemoryTableRepo()),
  };
  await ctx.study.put("STD", { title: "Standard Study Guide", sections: [{ id: "s1", label: "Intro", kind: "prose", body: ["Study."] }] });

  // Standard exam
  await ctx.exams.put({
    examId: "STD", name: "Standard Test", itemCount: 6, timeLimitMin: 120, cutScore: 720,
    scaleMin: 100, scaleMax: 1000, format: "standard", price: 99, status: "live",
    domains: [{ id: 1, name: "Alpha", weight: 50 }, { id: 2, name: "Beta", weight: 50 }], theme,
  });
  const q = (i: number, domain: number, correct: number[], type: QuestionRow["type"]): QuestionRow => ({
    examId: "STD", questionId: `Q${i}`, domain, type,
    stem: `Stem ${i}?`, options: [`opt${i}a`, `opt${i}b`, `opt${i}c`, `opt${i}d`],
    correct, rationale: `Because reason ${i}.`,
    referenceText: "Claude Docs", referenceUrl: "https://docs.claude.com/x", status: "published",
  });
  for (let i = 1; i <= 5; i++) await ctx.questions.put(q(i, 1, [i % 4], "single"));
  for (let i = 6; i <= 10; i++) await ctx.questions.put(q(i, 2, i === 6 ? [0, 2] : [i % 4], i === 6 ? "multiple" : "single"));

  // Scenario exam
  await ctx.exams.put({
    examId: "SCN", name: "Scenario Test", itemCount: 60, timeLimitMin: 120, cutScore: 720,
    scaleMin: 100, scaleMax: 1000, format: "scenario", price: 125, status: "live",
    domains: [1, 2, 3, 4, 5].map((id) => ({ id, name: `D${id}`, weight: 20 })),
    scenarios: [1, 2, 3, 4, 5, 6].map((n) => ({ id: `S${n}`, title: `Scenario ${n}` })), theme,
  });
  for (let n = 1; n <= 6; n++) {
    await ctx.scenarios.put({ examId: "SCN", scenarioId: `S${n}`, title: `Scenario ${n}`, frame: `Frame text ${n}`, primaryDomains: [((n - 1) % 5) + 1] });
    for (let k = 0; k < 3; k++) {
      await ctx.questions.put({
        examId: "SCN", questionId: `S${n}-${k}`, domain: ((n - 1) % 5) + 1, type: "single",
        stem: `Scenario ${n} q${k}?`, options: ["a", "b", "c", "d"], scenarioId: `S${n}`,
        correct: [k % 4], rationale: "r", referenceText: "Docs", referenceUrl: "https://docs.claude.com/y", status: "published",
      });
    }
  }
  return ctx;
}

export function principal(
  identityProvider: string, userId: string, opts: { email?: string; roles?: string[] } = {},
): ClientPrincipal {
  const p: ClientPrincipal = {
    identityProvider, userId, userDetails: opts.email ?? userId, userRoles: opts.roles ?? ["authenticated"],
  };
  if (opts.email) p.claims = [{ typ: "emails", val: opts.email }];
  return p;
}
