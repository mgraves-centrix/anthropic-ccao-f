// ============================================================================
// Business logic (spec §III.4/§III.9/§III.6a). Pure and testable: takes repos +
// principal + input, returns DTOs. Azure Function files are thin adapters over
// these. The answer key is read ONLY in practiceAnswer + submitAttempt.
// ============================================================================
import type { ExamsRepo, QuestionsRepo, ScenariosRepo, AttemptsRepo, UsersRepo, StudyGuideRepo } from "./repos.js";
import type {
  ExamMeta, QuestionRow, QuestionPublic, AttemptRow, SubmitResult, AccessStatus, Role,
} from "./types.js";
import { projectQuestion } from "./project.js";
import { scoreAttempt, apportion } from "./scoring.js";
import { shuffled } from "./shuffle.js";
import {
  type ClientPrincipal, type AuthConfig, getVerifiedEmail, isAutoApproveDomain,
  newRequestRow, hasRole,
} from "./auth.js";

export class ServiceError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

export interface Ctx {
  exams: ExamsRepo; questions: QuestionsRepo; scenarios: ScenariosRepo;
  attempts: AttemptsRepo; users: UsersRepo; study: StudyGuideRepo;
}
export interface Opts { now?: number; rand?: () => number; }

const DAY = 86400000;
const iso = (ms: number) => new Date(ms).toISOString();
const nowMs = (o?: Opts) => o?.now ?? Date.now();
const rnd = (o?: Opts) => o?.rand ?? Math.random;
const id = (rand: () => number) => "a_" + Math.floor(rand() * 1e9).toString(36) + Math.floor(rand() * 1e9).toString(36);

function sample<T>(pool: readonly T[], n: number, rand: () => number): T[] {
  return shuffled(pool, rand).slice(0, Math.min(n, pool.length));
}

/** Map display-order answer indices back to the stored (original) option indices. */
function toOriginal(display: number[], order?: number[]): number[] {
  if (!order) return display;
  return display.map((d) => order[d]).filter((x): x is number => x !== undefined);
}

// ---- Access / registration (spec §III.6a) ----------------------------------
export async function accessRequest(
  p: ClientPrincipal, justification: string, ctx: Ctx, cfg: AuthConfig, o?: Opts,
): Promise<{ status: AccessStatus }> {
  const existing = await ctx.users.get(p.identityProvider, p.userId);
  if (existing && existing.status === "active") return { status: "active" };

  const email = getVerifiedEmail(p);
  const auto = isAutoApproveDomain(email, cfg.autoApproveDomains);
  const status: AccessStatus = auto ? "active" : "pending";
  const role: Role = "authorized";
  const row = newRequestRow(p, justification, status, role, iso(nowMs(o)));
  await ctx.users.put(row);
  return { status };
}

export async function listPending(admin: ClientPrincipal, ctx: Ctx): Promise<unknown[]> {
  requireAdmin(admin);
  return (await ctx.users.list()).filter((u) => u.status === "pending");
}

export async function decideRequest(
  admin: ClientPrincipal, targetProvider: string, targetUserId: string,
  decision: "approve" | "deny", role: Role, ctx: Ctx, o?: Opts,
): Promise<{ ok: true }> {
  requireAdmin(admin);
  const u = await ctx.users.get(targetProvider, targetUserId);
  if (!u) throw new ServiceError(404, "request not found");
  u.status = decision === "approve" ? "active" : "denied";
  u.role = role;
  u.decidedBy = admin.userId;
  u.decidedAt = iso(nowMs(o));
  await ctx.users.put(u);
  return { ok: true };
}

function requireAdmin(p: ClientPrincipal) {
  if (!hasRole(p.userRoles, "admin")) throw new ServiceError(403, "admin only");
}

// ---- Catalog ---------------------------------------------------------------
export async function catalog(ctx: Ctx): Promise<ExamMeta[]> {
  return (await ctx.exams.list()).filter((e) => e.status !== "authoring" || true);
}

// ---- Study guide (no key material; safe to serve) --------------------------
export async function studyGuide(ctx: Ctx, examId: string): Promise<unknown> {
  return (await ctx.study.get(examId)) ?? null;
}

// ---- Create attempt (spec §III.4 POST /attempts) ---------------------------
export interface AttemptPayload {
  attemptId: string; mode: AttemptRow["mode"]; expiresAt?: string; serverNow: string;
  scenarios?: { id: string; title: string; frame: string }[];
  questions: QuestionPublic[];
}

export async function createAttempt(
  userId: string, examId: string, mode: AttemptRow["mode"],
  filters: { domains?: number[]; count?: number } | undefined, ctx: Ctx, o?: Opts,
): Promise<AttemptPayload> {
  const rand = rnd(o);
  const t = nowMs(o);
  const exam = await ctx.exams.get(examId);
  if (!exam) throw new ServiceError(404, "exam not found");
  await cleanup(userId, ctx, o); // lazy purge/finalize on create

  const pool = await ctx.questions.listPublished(examId);
  if (pool.length === 0) throw new ServiceError(409, "no questions seeded for exam");

  let selected: QuestionRow[] = [];
  let scenarioPick: string[] | undefined;
  let scenariosOut: AttemptPayload["scenarios"];

  if (mode === "mock" && exam.format === "scenario") {
    const scens = await ctx.scenarios.list(examId);
    const chosen = sample(scens, 4, rand);
    scenarioPick = chosen.map((s) => s.scenarioId);
    scenariosOut = chosen.map((s) => ({ id: s.scenarioId, title: s.title, frame: s.frame }));
    for (const s of chosen) {
      const scenPool = pool.filter((q) => q.scenarioId === s.scenarioId);
      selected.push(...sample(scenPool, 15, rand));
    }
  } else {
    let base = pool;
    if (filters?.domains?.length) base = base.filter((q) => filters.domains!.includes(q.domain));
    const count = mode === "mock" ? exam.itemCount : Math.min(filters?.count ?? 10, base.length);
    if (mode === "mock") {
      const byDom: Record<number, QuestionRow[]> = {};
      for (const q of base) (byDom[q.domain] ??= []).push(q);
      const avail: Record<number, number> = {};
      for (const d of exam.domains) avail[d.id] = (byDom[d.id] ?? []).length;
      const alloc = apportion(count, exam.domains, avail);
      for (const d of exam.domains) selected.push(...sample(byDom[d.id] ?? [], alloc[d.id] ?? 0, rand));
    } else {
      selected = sample(base, count, rand);
    }
  }

  // per-attempt randomization: question order + option order (recorded for resume)
  const ordered = mode === "mock" && exam.format === "scenario"
    ? selected // keep scenario grouping; order within handled below
    : shuffled(selected, rand);
  const questionOrder = ordered.map((q) => q.questionId);
  const optionOrder: Record<string, number[]> = {};
  for (const q of ordered) {
    optionOrder[q.questionId] = shuffled(q.options.map((_, i) => i), rand);
  }

  const attemptId = id(rand);
  const startedAt = iso(t);
  const expiresAt = mode === "mock" ? iso(t + exam.timeLimitMin * 60000) : undefined;
  const row: AttemptRow = {
    userId, examId, attemptId, mode, status: "in-progress", startedAt,
    rev: 1, purgeAt: iso(t + 3 * DAY),
    progress: { currentIndex: 0, answers: {}, flags: [], questionOrder, optionOrder, ...(scenarioPick ? { scenarioPick } : {}) },
  };
  if (expiresAt) row.expiresAt = expiresAt;
  await ctx.attempts.put(row);

  const questions = ordered.map((q) => projectQuestion(q, optionOrder[q.questionId]));
  const payload: AttemptPayload = { attemptId, mode, serverNow: startedAt, questions };
  if (expiresAt) payload.expiresAt = expiresAt;
  if (scenariosOut) payload.scenarios = scenariosOut;
  return payload;
}

// ---- Save / resume ---------------------------------------------------------
export async function saveAttempt(
  userId: string, attemptId: string,
  patch: { rev: number; currentIndex?: number; answers?: Record<string, number[]>; flags?: string[]; practiceElapsedMs?: number },
  ctx: Ctx, o?: Opts,
): Promise<{ ok: true; rev: number; savedAt: string; serverNow: string; expiresAt?: string }> {
  const a = await ctx.attempts.find(userId, attemptId);
  if (!a || a.status !== "in-progress") throw new ServiceError(404, "no in-progress attempt");
  if (patch.rev !== a.rev) throw new ServiceError(409, "stale rev");
  a.progress = a.progress ?? { currentIndex: 0, answers: {}, flags: [], questionOrder: [], optionOrder: {} };
  if (patch.currentIndex !== undefined) a.progress.currentIndex = patch.currentIndex;
  if (patch.answers) a.progress.answers = patch.answers;
  if (patch.flags) a.progress.flags = patch.flags;
  if (patch.practiceElapsedMs !== undefined) a.progress.practiceElapsedMs = patch.practiceElapsedMs;
  a.rev += 1;
  await ctx.attempts.put(a);
  const savedAt = iso(nowMs(o));
  const res: { ok: true; rev: number; savedAt: string; serverNow: string; expiresAt?: string } =
    { ok: true, rev: a.rev, savedAt, serverNow: savedAt };
  if (a.expiresAt) res.expiresAt = a.expiresAt;
  return res; // NB: never returns correctness
}

export async function resume(userId: string, examId: string | undefined, ctx: Ctx, o?: Opts) {
  await cleanup(userId, ctx, o);
  const all = await ctx.attempts.listByUser(userId, examId);
  const t = nowMs(o);
  const out = [];
  for (const a of all) {
    if (a.status !== "in-progress") continue;
    const remainingMs = a.expiresAt ? Math.max(0, Date.parse(a.expiresAt) - t) : undefined;
    out.push({
      attemptId: a.attemptId, examId: a.examId, mode: a.mode,
      expiresAt: a.expiresAt, remainingMs, progress: a.progress, // keys never stored here
    });
  }
  return out;
}

// ---- Practice instant feedback (spec: Practice only) -----------------------
export async function practiceAnswer(
  userId: string, attemptId: string, qid: string, answer: number[], ctx: Ctx,
) {
  const a = await ctx.attempts.find(userId, attemptId);
  if (!a) throw new ServiceError(404, "attempt not found");
  if (a.mode !== "practice") throw new ServiceError(403, "feedback withheld until submit");
  // Only questions that are actually part of THIS attempt may be answered — prevents
  // harvesting the exam's answer key by passing arbitrary qids to /answer.
  if (!a.progress?.questionOrder?.includes(qid)) throw new ServiceError(404, "question not in attempt");
  const q = await ctx.questions.get(a.examId, qid);
  if (!q) throw new ServiceError(404, "question not found");
  const orig = toOriginal(answer, a.progress?.optionOrder?.[qid]);
  const key = [...q.correct].sort((x, y) => x - y);
  const given = [...orig].sort((x, y) => x - y);
  const correct = key.length === given.length && key.every((v, i) => v === given[i]);
  return { correct, correctKeys: q.correct, rationale: q.rationale, reference: { text: q.referenceText, url: q.referenceUrl } };
}

// ---- Submit / finalize -----------------------------------------------------
export async function submitAttempt(
  userId: string, attemptId: string, ctx: Ctx, o?: Opts, statusOnFinal: "submitted" | "expired" = "submitted",
): Promise<SubmitResult> {
  const a = await ctx.attempts.find(userId, attemptId);
  if (!a) throw new ServiceError(404, "attempt not found");
  const exam = await ctx.exams.get(a.examId);
  if (!exam) throw new ServiceError(404, "exam not found");
  const order = a.progress?.questionOrder ?? [];
  const qs: QuestionRow[] = [];
  for (const qid of order) {
    const q = await ctx.questions.get(a.examId, qid);
    if (q) qs.push(q);
  }
  // translate each answer from display-order to original option indices before scoring
  const displayAnswers = a.progress?.answers ?? {};
  const optOrder = a.progress?.optionOrder ?? {};
  const answers: Record<string, number[]> = {};
  for (const qid of order) answers[qid] = toOriginal(displayAnswers[qid] ?? [], optOrder[qid]);
  const result = scoreAttempt(qs, answers, exam.domains);
  if (a.status === "in-progress") {
    a.status = statusOnFinal;
    a.submittedAt = iso(nowMs(o));
    a.scaled = result.scaled;
    a.correctCount = result.correct;
    a.totalCount = result.total;
    a.byDomain = Object.fromEntries(Object.entries(result.byDomain).map(([k, v]) => [k, { c: v.c, t: v.t }]));
    a.rev += 1;
    await ctx.attempts.put(a);
  }
  return result;
}

// ---- History (aggregates only) ---------------------------------------------
export async function history(
  userId: string, scope: "exam" | "all", examId: string | undefined, windowDays: 7 | 30, ctx: Ctx, o?: Opts,
) {
  const since = nowMs(o) - windowDays * DAY;
  const rows = (await ctx.attempts.listByUser(userId, scope === "exam" ? examId : undefined))
    .filter((a) => (a.status === "submitted" || a.status === "expired") && a.submittedAt && Date.parse(a.submittedAt) >= since);

  const points = rows.map((a) => ({
    date: (a.submittedAt ?? a.startedAt).slice(0, 10),
    scaled: a.scaled ?? 0, pass: (a.scaled ?? 0) >= 720, examId: a.examId,
  }));

  if (scope === "exam" && examId) {
    const exam = await ctx.exams.get(examId);
    const agg: Record<string, { c: number; t: number }> = {};
    for (const a of rows) for (const [d, v] of Object.entries(a.byDomain ?? {})) {
      agg[d] = agg[d] ?? { c: 0, t: 0 }; agg[d].c += v.c; agg[d].t += v.t;
    }
    const byDomain = (exam?.domains ?? []).map((d) => ({
      id: d.id, name: d.name,
      avgPct: agg[String(d.id)]?.t ? Math.round((agg[String(d.id)]!.c / agg[String(d.id)]!.t) * 100) : 0,
    }));
    return { scope, examId, window: windowDays, cutScore: exam?.cutScore ?? 720, points, byDomain };
  }
  // all-exams overview
  const byExamMap: Record<string, number[]> = {};
  for (const a of rows) (byExamMap[a.examId] ??= []).push(a.scaled ?? 0);
  const byExam = Object.entries(byExamMap).map(([eid, arr]) => ({
    examId: eid, avgScaled: Math.round(arr.reduce((s, n) => s + n, 0) / arr.length),
  }));
  return { scope, window: windowDays, cutScore: 720, points, byExam };
}

// ---- Lazy cleanup (spec §III.9): purge >3d incompletes; finalize expired mocks
export async function cleanup(userId: string, ctx: Ctx, o?: Opts): Promise<void> {
  const t = nowMs(o);
  const all = await ctx.attempts.listByUser(userId);
  for (const a of all) {
    if (a.status !== "in-progress") continue;
    if (a.mode === "mock" && a.expiresAt && Date.parse(a.expiresAt) <= t) {
      await submitAttempt(userId, a.attemptId, ctx, o, "expired"); // auto-submit on expiry
    } else if (Date.parse(a.purgeAt) <= t) {
      await ctx.attempts.remove(a);
    }
  }
}
