// Azure Functions v4 HTTP endpoints (spec §III.4). Thin adapters over the tested
// service layer. authLevel is 'anonymous' because SWA EasyAuth + staticwebapp
// route roles gate access; each handler re-derives principal/roles server-side.
import { app, type HttpResponseInit } from "@azure/functions";
import { json, handle, require as requireRole, requireAuthed, body } from "../shared/http.js";
import { ctxFromEnv, authConfig } from "../shared/context.js";
import { resolveRoles, type ClientPrincipal } from "../shared/auth.js";
import * as svc from "../shared/service.js";

// ---- rolesSource: POST /api/GetRoles ---------------------------------------
app.http("GetRoles", {
  methods: ["POST"], authLevel: "anonymous", route: "GetRoles",
  handler: (req) => handle(async () => {
    const p = (await body<ClientPrincipal>(req));
    if (!p?.userId) return json(200, { roles: [] });
    const roles = await resolveRoles(p, ctxFromEnv().users, authConfig());
    return json(200, { roles });
  }),
});

// ---- Self-service registration ---------------------------------------------
app.http("accessRequestCreate", {
  methods: ["POST"], authLevel: "anonymous", route: "access-requests",
  handler: (req) => handle(async () => {
    const p = requireAuthed(req);
    const { justification } = await body<{ justification?: string }>(req);
    return json(200, await svc.accessRequest(p, justification ?? "", ctxFromEnv(), authConfig()));
  }),
});
app.http("accessRequestList", {
  methods: ["GET"], authLevel: "anonymous", route: "access-requests",
  handler: (req) => handle(async () => {
    const p = requireRole(req, "admin");
    return json(200, await svc.listPending(p, ctxFromEnv()));
  }),
});
app.http("accessRequestDecide", {
  methods: ["POST"], authLevel: "anonymous", route: "access-requests/decision",
  handler: (req) => handle(async () => {
    const p = requireRole(req, "admin");
    const b = await body<{ provider: string; userId: string; decision: "approve" | "deny"; role?: "authorized" | "reviewer" }>(req);
    return json(200, await svc.decideRequest(p, b.provider, b.userId, b.decision, b.role ?? "authorized", ctxFromEnv()));
  }),
});

// ---- Catalog ---------------------------------------------------------------
app.http("catalog", {
  methods: ["GET"], authLevel: "anonymous", route: "catalog",
  handler: (req) => handle(async () => {
    requireRole(req, "authorized");
    return json(200, await svc.catalog(ctxFromEnv()));
  }),
});

// ---- Study guide -----------------------------------------------------------
app.http("studyGuide", {
  methods: ["GET"], authLevel: "anonymous", route: "study/{examId}",
  handler: (req) => handle(async () => {
    requireRole(req, "authorized");
    return json(200, await svc.studyGuide(ctxFromEnv(), req.params.examId!));
  }),
});

// ---- Attempts: create / save / resume --------------------------------------
app.http("attemptsCreate", {
  methods: ["POST"], authLevel: "anonymous", route: "attempts",
  handler: (req) => handle(async () => {
    const p = requireRole(req, "authorized");
    const b = await body<{ examId: string; mode: "practice" | "mock"; filters?: { domains?: number[]; count?: number } }>(req);
    return json(200, await svc.createAttempt(p.userId, b.examId, b.mode, b.filters, ctxFromEnv()));
  }),
});
app.http("attemptsResume", {
  methods: ["GET"], authLevel: "anonymous", route: "attempts",
  handler: (req) => handle(async () => {
    const p = requireRole(req, "authorized");
    const examId = req.query.get("examId") ?? undefined;
    return json(200, await svc.resume(p.userId, examId, ctxFromEnv()));
  }),
});
app.http("attemptsSave", {
  methods: ["PATCH"], authLevel: "anonymous", route: "attempts/{attemptId}",
  handler: (req) => handle(async () => {
    const p = requireRole(req, "authorized");
    const b = await body<{ rev: number; currentIndex?: number; answers?: Record<string, number[]>; flags?: string[]; practiceElapsedMs?: number }>(req);
    return json(200, await svc.saveAttempt(p.userId, req.params.attemptId!, b, ctxFromEnv()));
  }),
});

// ---- Practice instant feedback ---------------------------------------------
app.http("practiceAnswer", {
  methods: ["POST"], authLevel: "anonymous", route: "attempts/{attemptId}/answer",
  handler: (req) => handle(async () => {
    const p = requireRole(req, "authorized");
    const b = await body<{ qid: string; answer: number[] }>(req);
    return json(200, await svc.practiceAnswer(p.userId, req.params.attemptId!, b.qid, b.answer, ctxFromEnv()));
  }),
});

// ---- Submit (only key-bearing endpoint besides practice answer) ------------
app.http("attemptsSubmit", {
  methods: ["POST"], authLevel: "anonymous", route: "attempts/{attemptId}/submit",
  handler: (req) => handle(async () => {
    const p = requireRole(req, "authorized");
    return json(200, await svc.submitAttempt(p.userId, req.params.attemptId!, ctxFromEnv()));
  }),
});

// ---- History (aggregates only) ---------------------------------------------
app.http("history", {
  methods: ["GET"], authLevel: "anonymous", route: "me/history",
  handler: (req) => handle(async (): Promise<HttpResponseInit> => {
    const p = requireRole(req, "authorized");
    const scope = (req.query.get("scope") as "exam" | "all") ?? "exam";
    const examId = req.query.get("examId") ?? undefined;
    const window = (Number(req.query.get("window")) === 30 ? 30 : 7) as 7 | 30;
    return json(200, await svc.history(p.userId, scope, examId, window, ctxFromEnv()));
  }),
});
