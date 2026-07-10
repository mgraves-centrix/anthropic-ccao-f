// ============================================================================
// Typed repositories over TableRepo (spec §III.3). Centralizes JSON (de)serialize
// of complex fields so the answer key stays a server-side concern in one place.
// ============================================================================
import type { TableRepo, Entity } from "./tables.js";
import { invTicks } from "./tables.js";
import type {
  ExamMeta, QuestionRow, ScenarioRow, AttemptRow, AuthorizedUserRow,
} from "./types.js";

const j = (v: unknown) => JSON.stringify(v);
const p = <T>(s: unknown, dflt: T): T => (typeof s === "string" ? (JSON.parse(s) as T) : dflt);

// ---- Exams -----------------------------------------------------------------
export class ExamsRepo {
  constructor(private t: TableRepo) {}
  async put(m: ExamMeta): Promise<void> {
    await this.t.upsert({
      partitionKey: "EXAM", rowKey: m.examId,
      name: m.name, itemCount: m.itemCount, timeLimitMin: m.timeLimitMin,
      cutScore: m.cutScore, scaleMin: m.scaleMin, scaleMax: m.scaleMax,
      format: m.format, price: m.price, status: m.status,
      domainsJson: j(m.domains), scenariosJson: j(m.scenarios ?? []),
      themeJson: j(m.theme),
    });
  }
  private map(e: Entity): ExamMeta {
    return {
      examId: e.rowKey, name: e.name as string, itemCount: e.itemCount as number,
      timeLimitMin: e.timeLimitMin as number, cutScore: e.cutScore as number,
      scaleMin: e.scaleMin as number, scaleMax: e.scaleMax as number,
      format: e.format as ExamMeta["format"], price: e.price as number,
      status: e.status as ExamMeta["status"],
      domains: p(e.domainsJson, []), scenarios: p(e.scenariosJson, []),
      theme: p(e.themeJson, {} as ExamMeta["theme"]),
    };
  }
  async get(examId: string): Promise<ExamMeta | undefined> {
    const e = await this.t.get("EXAM", examId);
    return e ? this.map(e) : undefined;
  }
  async list(): Promise<ExamMeta[]> {
    return (await this.t.queryPartition("EXAM")).map((e) => this.map(e));
  }
}

// ---- Questions (server-only key) -------------------------------------------
export class QuestionsRepo {
  constructor(private t: TableRepo) {}
  async put(q: QuestionRow): Promise<void> {
    await this.t.upsert({
      partitionKey: q.examId, rowKey: q.questionId,
      domain: q.domain, type: q.type, stem: q.stem, optionsJson: j(q.options),
      scenarioId: q.scenarioId ?? "", selectCount: q.selectCount ?? 0,
      correctJson: j(q.correct), rationale: q.rationale,
      referenceText: q.referenceText, referenceUrl: q.referenceUrl ?? "",
      status: q.status,
    });
  }
  private map(e: Entity): QuestionRow {
    const row: QuestionRow = {
      examId: e.partitionKey, questionId: e.rowKey, domain: e.domain as number,
      type: e.type as QuestionRow["type"], stem: e.stem as string,
      options: p(e.optionsJson, []), correct: p(e.correctJson, []),
      rationale: e.rationale as string, referenceText: e.referenceText as string,
      status: e.status as QuestionRow["status"],
    };
    if (e.scenarioId) row.scenarioId = e.scenarioId as string;
    if (e.selectCount) row.selectCount = e.selectCount as number;
    if (e.referenceUrl) row.referenceUrl = e.referenceUrl as string;
    return row;
  }
  async get(examId: string, qid: string): Promise<QuestionRow | undefined> {
    const e = await this.t.get(examId, qid);
    return e ? this.map(e) : undefined;
  }
  async listPublished(examId: string): Promise<QuestionRow[]> {
    return (await this.t.queryPartition(examId))
      .map((e) => this.map(e))
      .filter((q) => q.status === "published");
  }
}

// ---- Scenarios -------------------------------------------------------------
export class ScenariosRepo {
  constructor(private t: TableRepo) {}
  async put(s: ScenarioRow): Promise<void> {
    await this.t.upsert({
      partitionKey: `SC-${s.examId}`, rowKey: s.scenarioId,
      title: s.title, frame: s.frame, primaryDomainsJson: j(s.primaryDomains),
    });
  }
  async list(examId: string): Promise<ScenarioRow[]> {
    return (await this.t.queryPartition(`SC-${examId}`)).map((e) => ({
      examId, scenarioId: e.rowKey, title: e.title as string, frame: e.frame as string,
      primaryDomains: p(e.primaryDomainsJson, []),
    }));
  }
}

// ---- Attempts (PK=userId — privacy boundary) -------------------------------
export class AttemptsRepo {
  constructor(private t: TableRepo) {}
  private rk(a: AttemptRow): string { return `${a.examId}|${invTicks(a.startedAt)}|${a.attemptId}`; }
  async put(a: AttemptRow): Promise<void> {
    await this.t.upsert({
      partitionKey: a.userId, rowKey: this.rk(a),
      examId: a.examId, attemptId: a.attemptId, mode: a.mode, status: a.status,
      startedAt: a.startedAt, expiresAt: a.expiresAt ?? "", submittedAt: a.submittedAt ?? "",
      scaled: a.scaled ?? 0, correctCount: a.correctCount ?? 0, totalCount: a.totalCount ?? 0,
      byDomainJson: j(a.byDomain ?? {}), progressJson: j(a.progress ?? null),
      rev: a.rev, purgeAt: a.purgeAt,
    });
  }
  private map(e: Entity): AttemptRow {
    const a: AttemptRow = {
      userId: e.partitionKey, examId: e.examId as string, attemptId: e.attemptId as string,
      mode: e.mode as AttemptRow["mode"], status: e.status as AttemptRow["status"],
      startedAt: e.startedAt as string, rev: e.rev as number, purgeAt: e.purgeAt as string,
      byDomain: p(e.byDomainJson, {}),
    };
    if (e.expiresAt) a.expiresAt = e.expiresAt as string;
    if (e.submittedAt) a.submittedAt = e.submittedAt as string;
    if (e.scaled) a.scaled = e.scaled as number;
    if (e.correctCount !== undefined) a.correctCount = e.correctCount as number;
    if (e.totalCount !== undefined) a.totalCount = e.totalCount as number;
    const prog = p<AttemptRow["progress"] | null>(e.progressJson, null);
    if (prog) a.progress = prog;
    return a;
  }
  async find(userId: string, attemptId: string): Promise<AttemptRow | undefined> {
    const all = await this.t.queryPartition(userId);
    const e = all.find((x) => x.attemptId === attemptId);
    return e ? this.map(e) : undefined;
  }
  async listByUser(userId: string, examId?: string): Promise<AttemptRow[]> {
    const rows = await this.t.queryPartition(userId, examId ? `${examId}|` : undefined);
    return rows.map((e) => this.map(e));
  }
  async remove(a: AttemptRow): Promise<void> {
    await this.t.remove(a.userId, this.rk(a));
  }
}

// ---- Study guide (per exam) -------------------------------------------------
export class StudyGuideRepo {
  constructor(private t: TableRepo) {}
  async put(examId: string, guide: unknown): Promise<void> {
    await this.t.upsert({ partitionKey: `SG-${examId}`, rowKey: "guide", json: j(guide) });
  }
  async get(examId: string): Promise<unknown | undefined> {
    const e = await this.t.get(`SG-${examId}`, "guide");
    return e ? p(e.json, null) : undefined;
  }
}

// ---- Authorized users / access requests ------------------------------------
export class UsersRepo {
  constructor(private t: TableRepo) {}
  private rk(provider: string, providerUserId: string): string { return `${provider}|${providerUserId}`; }
  async put(u: AuthorizedUserRow): Promise<void> {
    await this.t.upsert({
      partitionKey: "USER", rowKey: this.rk(u.provider, u.providerUserId),
      provider: u.provider, providerUserId: u.providerUserId, role: u.role, status: u.status,
      email: u.email, displayName: u.displayName, justification: u.justification ?? "",
      requestedAt: u.requestedAt, decidedBy: u.decidedBy ?? "", decidedAt: u.decidedAt ?? "",
    });
  }
  private map(e: Entity): AuthorizedUserRow {
    const u: AuthorizedUserRow = {
      provider: e.provider as string, providerUserId: e.providerUserId as string,
      role: e.role as AuthorizedUserRow["role"], status: e.status as AuthorizedUserRow["status"],
      email: e.email as string, displayName: e.displayName as string,
      requestedAt: e.requestedAt as string,
    };
    if (e.justification) u.justification = e.justification as string;
    if (e.decidedBy) u.decidedBy = e.decidedBy as string;
    if (e.decidedAt) u.decidedAt = e.decidedAt as string;
    return u;
  }
  async get(provider: string, providerUserId: string): Promise<AuthorizedUserRow | undefined> {
    const e = await this.t.get("USER", this.rk(provider, providerUserId));
    return e ? this.map(e) : undefined;
  }
  async list(): Promise<AuthorizedUserRow[]> {
    return (await this.t.queryPartition("USER")).map((e) => this.map(e));
  }
}
