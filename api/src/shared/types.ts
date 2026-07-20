// ============================================================================
// FROZEN SHARED CONTRACTS (spec §III.3/§III.4). Import read-only; changes go
// through the Integrator only. DTOs are the parsed shapes; Table rows store
// complex fields as JSON strings.
// ============================================================================

export type ExamId = string;
export type QuestionType = "single" | "multiple";
export type ExamFormat = "standard" | "scenario";
export type AttemptMode = "practice" | "mock";
export type AttemptStatus = "in-progress" | "submitted" | "expired";
export type Verdict = "green" | "amber" | "red";
export type Role = "authorized" | "reviewer" | "admin";
export type AccessStatus = "pending" | "active" | "denied";

export interface Domain {
  id: number;
  name: string;
  weight: number; // percent (0..100)
}

export interface ExamTheme {
  accent: string;
  accentInk: string;
  accentTint: string;
  accentDark: string;
  accentInkDark: string;
  accentTintDark: string;
  onAccent: string;
}

export interface ExamMeta {
  examId: ExamId;
  name: string;
  itemCount: number;
  timeLimitMin: number;
  cutScore: number;
  scaleMin: number;
  scaleMax: number;
  format: ExamFormat;
  price: number;
  status: "live" | "authoring";
  domains: Domain[];
  scenarios?: { id: string; title: string }[];
  theme: ExamTheme;
  version?: number;      // content version (bumped when the bank changes)
  updatedAt?: string;    // ISO date of last content update
  changelog?: { version: number; date: string; note: string }[];
}

/** A user's bookmark + optional personal note on a question. */
export interface Bookmark {
  userId: string;
  examId: ExamId;
  qid: string;
  note?: string;
  createdAt: string;
}

/** Per-user, per-question spaced-repetition stats (Leitner box). */
export interface QuestionStat {
  userId: string;
  examId: ExamId;
  qid: string;
  seen: number;
  wrong: number;
  box: number;          // 0 (new/hard) .. 5 (mastered)
  lastResultAt: string;
  dueAt: string;        // when it should next be reviewed
}

export type PracticeSource = "all" | "weak" | "incorrect" | "bookmarked" | "qids";

/** Server-only question row — HOLDS THE ANSWER KEY. Never sent to the client. */
export interface QuestionRow {
  examId: ExamId;
  questionId: string;
  domain: number;
  type: QuestionType;
  stem: string;
  options: string[];
  scenarioId?: string;
  selectCount?: number;
  correct: number[]; // KEY
  rationale: string; // server-only until scored
  referenceText: string; // server-only until scored
  referenceUrl?: string; // server-only until scored
  status: "published" | "draft";
}

/** Public projection sent to the browser — NO key fields (spec §III.2 project.ts). */
export interface QuestionPublic {
  qid: string;
  stem: string;
  options: string[];
  type: QuestionType;
  domain: number;
  scenarioId?: string;
  selectCount?: number;
}

export interface ScenarioRow {
  examId: ExamId;
  scenarioId: string;
  title: string;
  frame: string;
  primaryDomains: number[];
}

export interface AttemptProgress {
  currentIndex: number;
  answers: Record<string, number[]>;
  flags: string[];
  questionOrder: string[];
  optionOrder: Record<string, number[]>;
  scenarioPick?: string[];
  practiceElapsedMs?: number;
}

export interface ByDomain {
  [domainId: string]: { c: number; t: number };
}

export interface AttemptRow {
  userId: string;
  examId: ExamId;
  attemptId: string;
  mode: AttemptMode;
  status: AttemptStatus;
  startedAt: string;
  expiresAt?: string;
  submittedAt?: string;
  scaled?: number;
  correctCount?: number;
  totalCount?: number;
  byDomain?: ByDomain;
  wrongQids?: string[];   // persisted on submit — powers retry-incorrect
  progress?: AttemptProgress;
  rev: number;
  purgeAt: string;
}

export interface AuthorizedUserRow {
  provider: string;
  providerUserId: string;
  role: Role;
  status: AccessStatus;
  email: string;
  displayName: string;
  justification?: string;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
}

/** Result of scoring a submitted attempt (spec §III.4 submit response). */
export interface WeakDomain {
  id: number;
  name: string;
  pct: number;
  weight: number;
}

export interface ReviewItem {
  qid: string;
  yourAnswer: number[];
  correct: boolean;
  correctKeys: number[];
  rationale: string;
  reference: { text: string; url?: string };
}

export interface SubmitResult {
  scaled: number;
  pass: boolean;
  verdict: Verdict;
  correct: number;
  total: number;
  byDomain: Record<string, { c: number; t: number; pct: number }>;
  weakDomains: WeakDomain[];
  review: ReviewItem[];
}
