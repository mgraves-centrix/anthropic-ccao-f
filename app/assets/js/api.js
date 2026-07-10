// Typed-ish fetch wrappers for /api/* (spec §III.4). The client only ever sees
// keyless payloads except from submit()/answer().
async function req(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["content-type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`/api${path}`, opts);
  if (r.status === 401) { window.location.href = "/login"; throw new Error("unauthenticated"); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status: r.status, data });
  return data;
}

export const api = {
  catalog: () => req("GET", "/catalog"),
  createAttempt: (examId, mode, filters) => req("POST", "/attempts", { examId, mode, filters }),
  resume: (examId) => req("GET", `/attempts${examId ? `?examId=${encodeURIComponent(examId)}` : ""}`),
  save: (attemptId, patch) => req("PATCH", `/attempts/${encodeURIComponent(attemptId)}`, patch),
  answer: (attemptId, qid, answer) => req("POST", `/attempts/${encodeURIComponent(attemptId)}/answer`, { qid, answer }),
  submit: (attemptId) => req("POST", `/attempts/${encodeURIComponent(attemptId)}/submit`),
  history: (scope, examId, window) =>
    req("GET", `/me/history?scope=${scope}${examId ? `&examId=${encodeURIComponent(examId)}` : ""}&window=${window}`),
  study: (examId) => req("GET", `/study/${encodeURIComponent(examId)}`),
  requestAccess: (justification) => req("POST", "/access-requests", { justification }),
  listRequests: () => req("GET", "/access-requests"),
  decide: (provider, userId, decision, role) => req("POST", "/access-requests/decision", { provider, userId, decision, role }),
};
