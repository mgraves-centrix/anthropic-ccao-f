// Azure Functions v4 HTTP endpoints (spec §III.4). Thin adapters over the tested
// service layer. authLevel is 'anonymous' because SWA EasyAuth + staticwebapp
// route roles gate access; each handler re-derives principal/roles server-side.
import { app, type HttpResponseInit } from "@azure/functions";
import { json, handle, enforceAuthed, enforce, body } from "../shared/http.js";
import { ctxFromEnv, authConfig, auditRepo } from "../shared/context.js";
import { resolveRoles, makeGithubOrgCheck, type ClientPrincipal } from "../shared/auth.js";
import { audit } from "../shared/audit.js";
import * as svc from "../shared/service.js";

// ---- rolesSource: POST /api/GetRoles ---------------------------------------
app.http("GetRoles", {
  methods: ["POST"], authLevel: "anonymous", route: "GetRoles",
  handler: (req) => handle(async () => {
    const p = (await body<ClientPrincipal>(req));
    if (!p?.userId) return json(200, { roles: [] });
    const cfg = authConfig();
    const orgCheck = (cfg.authzMode === "github-org" || cfg.authzMode === "both") && cfg.githubOrg && process.env.GITHUB_TOKEN
      ? makeGithubOrgCheck(process.env.GITHUB_TOKEN, cfg.githubOrg, cfg.githubTeam)
      : undefined;
    const roles = await resolveRoles(p, ctxFromEnv().users, cfg, orgCheck);
    return json(200, { roles });
  }),
});

// ---- Self-service registration ---------------------------------------------
app.http("accessRequestCreate", {
  methods: ["POST"], authLevel: "anonymous", route: "access-requests",
  handler: (req) => handle(async () => {
    const p = enforceAuthed(req, "read");
    const { justification } = await body<{ justification?: string }>(req);
    return json(200, await svc.accessRequest(p, justification ?? "", ctxFromEnv(), authConfig()));
  }),
});
app.http("accessRequestList", {
  methods: ["GET"], authLevel: "anonymous", route: "access-requests",
  handler: (req) => handle(async () => {
    const p = enforce(req, "admin", "read");
    return json(200, await svc.listPending(p, ctxFromEnv()));
  }),
});
app.http("accessRequestDecide", {
  methods: ["POST"], authLevel: "anonymous", route: "access-requests/decision",
  handler: (req) => handle(async () => {
    const p = enforce(req, "admin", "read");
    const b = await body<{ provider: string; userId: string; decision: "approve" | "deny"; role?: "authorized" | "reviewer" }>(req);
    const res = await svc.decideRequest(p, b.provider, b.userId, b.decision, b.role ?? "authorized", ctxFromEnv());
    await audit(auditRepo(), { userId: p.userId, event: `access.${b.decision}`, route: "access-requests/decision", meta: { target: `${b.provider}|${b.userId}` } });
    return json(200, res);
  }),
});

// ---- Catalog ---------------------------------------------------------------
app.http("catalog", {
  methods: ["GET"], authLevel: "anonymous", route: "catalog",
  handler: (req) => handle(async () => {
    enforce(req, "authorized", "read");
    return json(200, await svc.catalog(ctxFromEnv()));
  }),
});

// ---- Study guide -----------------------------------------------------------
app.http("studyGuide", {
  methods: ["GET"], authLevel: "anonymous", route: "study/{examId}",
  handler: (req) => handle(async () => {
    enforce(req, "authorized", "read");
    return json(200, await svc.studyGuide(ctxFromEnv(), req.params.examId!));
  }),
});

// ---- Attempts: create / save / resume --------------------------------------
app.http("attemptsCreate", {
  methods: ["POST"], authLevel: "anonymous", route: "attempts",
  handler: (req) => handle(async () => {
    const p = enforce(req, "authorized", "attempts");
    const b = await body<{ examId: string; mode: "practice" | "mock"; filters?: svc.PracticeFilters }>(req);
    return json(200, await svc.createAttempt(p.userId, b.examId, b.mode, b.filters, ctxFromEnv()));
  }),
});
app.http("attemptsResume", {
  methods: ["GET"], authLevel: "anonymous", route: "attempts",
  handler: (req) => handle(async () => {
    const p = enforce(req, "authorized", "read");
    const examId = req.query.get("examId") ?? undefined;
    return json(200, await svc.resume(p.userId, examId, ctxFromEnv()));
  }),
});
app.http("attemptsSave", {
  methods: ["PATCH"], authLevel: "anonymous", route: "attempts/{attemptId}",
  handler: (req) => handle(async () => {
    const p = enforce(req, "authorized", "save");
    const b = await body<{ rev: number; currentIndex?: number; answers?: Record<string, number[]>; flags?: string[]; practiceElapsedMs?: number }>(req);
    return json(200, await svc.saveAttempt(p.userId, req.params.attemptId!, b, ctxFromEnv()));
  }),
});

// ---- Practice instant feedback ---------------------------------------------
app.http("practiceAnswer", {
  methods: ["POST"], authLevel: "anonymous", route: "attempts/{attemptId}/answer",
  handler: (req) => handle(async () => {
    const p = enforce(req, "authorized", "answer");
    const b = await body<{ qid: string; answer: number[] }>(req);
    return json(200, await svc.practiceAnswer(p.userId, req.params.attemptId!, b.qid, b.answer, ctxFromEnv()));
  }),
});

// ---- Submit (only key-bearing endpoint besides practice answer) ------------
app.http("attemptsSubmit", {
  methods: ["POST"], authLevel: "anonymous", route: "attempts/{attemptId}/submit",
  handler: (req) => handle(async () => {
    const p = enforce(req, "authorized", "submit");
    const res = await svc.submitAttempt(p.userId, req.params.attemptId!, ctxFromEnv());
    await audit(auditRepo(), { userId: p.userId, event: "submit", route: "attempts/submit", meta: { attemptId: req.params.attemptId, scaled: res.scaled } });
    return json(200, res);
  }),
});

// ---- Review a finalized attempt (post-submit) ------------------------------
app.http("attemptsReview", {
  methods: ["GET"], authLevel: "anonymous", route: "attempts/{attemptId}/review",
  handler: (req) => handle(async () => {
    const p = enforce(req, "authorized", "read");
    return json(200, await svc.getReview(p.userId, req.params.attemptId!, ctxFromEnv()));
  }),
});

// ---- Bookmarks & personal notes --------------------------------------------
app.http("bookmarkSet", {
  methods: ["POST"], authLevel: "anonymous", route: "bookmarks",
  handler: (req) => handle(async () => {
    const p = enforce(req, "authorized", "save");
    const b = await body<{ examId: string; qid: string; note?: string; remove?: boolean }>(req);
    if (b.remove) return json(200, await svc.removeBookmark(p.userId, b.examId, b.qid, ctxFromEnv()));
    return json(200, await svc.setBookmark(p.userId, b.examId, b.qid, b.note, ctxFromEnv()));
  }),
});
app.http("bookmarkList", {
  methods: ["GET"], authLevel: "anonymous", route: "bookmarks",
  handler: (req) => handle(async () => {
    const p = enforce(req, "authorized", "read");
    return json(200, await svc.listBookmarks(p.userId, req.query.get("examId") ?? undefined, ctxFromEnv()));
  }),
});

// ---- Reviewer draft preview (reviewer/admin role) --------------------------
app.http("examDrafts", {
  methods: ["GET"], authLevel: "anonymous", route: "exams/{examId}/drafts",
  handler: (req) => handle(async () => {
    const p = enforce(req, "authorized", "read"); // service enforces reviewer/admin
    return json(200, await svc.listDrafts(p, req.params.examId!, ctxFromEnv()));
  }),
});

// ---- History (aggregates only) ---------------------------------------------
app.http("history", {
  methods: ["GET"], authLevel: "anonymous", route: "me/history",
  handler: (req) => handle(async (): Promise<HttpResponseInit> => {
    const p = enforce(req, "authorized", "read");
    const scope = (req.query.get("scope") as "exam" | "all") ?? "exam";
    const examId = req.query.get("examId") ?? undefined;
    const window = (Number(req.query.get("window")) === 30 ? 30 : 7) as 7 | 30;
    return json(200, await svc.history(p.userId, scope, examId, window, ctxFromEnv()));
  }),
});
