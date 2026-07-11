// Practice/Mock question runner + results (spec §III.8/§10). Practice gives
// instant feedback; Mock withholds until submit and shows a live timer anchored
// to the server expiresAt. Results show the verdict banner + study recommendations.
import { api } from "../api.js";
import { renderDomainBars } from "../charts/domainBars.js";
import { go } from "../router.js";
import { esc, safeHref } from "../util.js";
import { renderReview } from "./review.js";

export async function renderRunner(host, { examId, mode, filters }) {
  host.innerHTML = `<div class="card"><p class="loading">Preparing your ${esc(mode)}…</p></div>`;
  let att;
  try {
    att = await api.createAttempt(examId, mode, mode === "practice" ? (filters || { count: 10 }) : undefined);
  } catch (e) {
    host.innerHTML = `<div class="card"><p>Could not start: ${esc(e.message)}</p>` +
      (e.status === 409 ? `<p class="muted">Nothing matches this selection yet — take some questions first.</p>` : "") + `</div>`;
    return;
  }
  const S = { qs: att.questions, idx: 0, answers: {}, flags: new Set(), rev: 1, attemptId: att.attemptId, feedback: {}, bookmarked: new Set() };
  api.bookmarkList(examId).then((bs) => { S.bookmarked = new Set(bs.map((b) => b.qid)); draw(); }).catch(() => {});
  let timer = null;
  if (mode === "mock" && att.expiresAt) startTimer(host, att.expiresAt, () => finish(true));

  function startTimer(_h, expiresAt, onExpire) {
    const tick = () => {
      const ms = Date.parse(expiresAt) - Date.now();
      const t = document.getElementById("mockTimer");
      if (ms <= 0) { if (t) t.textContent = "0:00"; clearInterval(timer); onExpire(); return; }
      const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
      if (t) t.textContent = `${m}:${String(s).padStart(2, "0")}`;
    };
    tick(); timer = setInterval(tick, 1000);
  }

  async function save() {
    try { const r = await api.save(S.attemptId, { rev: S.rev, currentIndex: S.idx, answers: S.answers, flags: [...S.flags] }); S.rev = r.rev; }
    catch { /* offline cache tolerated; server is source of truth */ }
  }

  function select(qid, i, type) {
    const cur = new Set(S.answers[qid] || []);
    if (type === "single") { S.answers[qid] = [i]; }
    else { cur.has(i) ? cur.delete(i) : cur.add(i); S.answers[qid] = [...cur]; }
    if (mode === "practice") return practiceFeedback(qid);
    draw();
  }

  async function practiceFeedback(qid) {
    try {
      S.feedback[qid] = await api.answer(S.attemptId, qid, S.answers[qid]);
    } catch { /* ignore */ }
    draw();
  }

  function draw() {
    const q = S.qs[S.idx];
    const type = q.type;
    const sel = new Set(S.answers[q.qid] || []);
    const fb = S.feedback[q.qid];
    const opts = q.options.map((o, i) => {
      let cls = "opt" + (sel.has(i) ? " selected" : "");
      if (fb) { if (fb.correctKeys.includes(i)) cls += " correct"; else if (sel.has(i)) cls += " wrong"; }
      return `<button class="${cls}" data-i="${i}" ${fb ? "disabled" : ""}>${esc(o)}</button>`;
    }).join("");
    const timerHtml = mode === "mock" ? `<span class="timer" id="mockTimer" aria-label="time remaining">…</span>` : "";
    const marked = S.bookmarked.has(q.qid);
    host.innerHTML =
      `<div class="runner">` +
      `<div class="runner__top"><span class="pill">${esc(examId)}</span>` +
      `<span class="mono">${S.idx + 1} / ${S.qs.length}</span>` +
      `<button class="bmk${marked ? " on" : ""}" data-bmk aria-pressed="${marked}" title="Bookmark this question">${marked ? "★" : "☆"}</button>` +
      `${timerHtml}</div>` +
      (q.scenarioId ? `<div class="scenario-frame mono">Scenario ${esc(q.scenarioId)}</div>` : "") +
      `<div class="card qcard"><p class="qstem">${esc(q.stem)}</p>` +
      (type === "multiple" ? `<p class="mono muted">Select ${q.selectCount || "all that apply"}.</p>` : "") +
      `<div class="opts">${opts}</div>` +
      (fb ? `<div class="rationale ${fb.correct ? "right" : "wrong"}"><strong>${fb.correct ? "Correct" : "Not quite"}.</strong> ${esc(fb.rationale)}` +
        (fb.reference?.url ? ` <a href="${esc(safeHref(fb.reference.url))}" target="_blank" rel="noreferrer">${esc(fb.reference.text || "reference")}</a>` : "") + `</div>` : "") +
      `</div>` +
      `<div class="runner__nav">` +
      `<button class="btn" data-nav="prev" ${S.idx === 0 ? "disabled" : ""}>Prev</button>` +
      `<button class="btn" data-nav="flag">${S.flags.has(q.qid) ? "Unflag" : "Flag"}</button>` +
      (S.idx < S.qs.length - 1 ? `<button class="btn btn--primary" data-nav="next">Next</button>`
        : `<button class="btn btn--primary" data-nav="submit">Submit</button>`) +
      `</div></div>`;

    host.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => select(q.qid, Number(b.dataset.i), type)));
    host.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => nav(b.dataset.nav, q.qid)));
    const bmk = host.querySelector("[data-bmk]");
    if (bmk) bmk.addEventListener("click", async () => {
      try {
        if (S.bookmarked.has(q.qid)) { await api.bookmarkRemove(examId, q.qid); S.bookmarked.delete(q.qid); }
        else { await api.bookmarkSet(examId, q.qid); S.bookmarked.add(q.qid); }
        draw();
      } catch { /* ignore */ }
    });
  }

  async function nav(action, qid) {
    if (action === "flag") { S.flags.has(qid) ? S.flags.delete(qid) : S.flags.add(qid); await save(); return draw(); }
    if (action === "prev") { S.idx = Math.max(0, S.idx - 1); await save(); return draw(); }
    if (action === "next") { S.idx = Math.min(S.qs.length - 1, S.idx + 1); await save(); return draw(); }
    if (action === "submit") return finish(false);
  }

  async function finish(auto) {
    if (timer) clearInterval(timer);
    await save();
    let res;
    try { res = await api.submit(S.attemptId); }
    catch (e) { host.innerHTML = `<div class="card"><p>Submit failed: ${esc(e.message)}</p></div>`; return; }
    renderResults(host, examId, res, auto, S.attemptId);
  }

  draw();
}

// ---- Results: verdict banner + study recommendations (spec §10, decision I) --
export function renderResults(host, examId, res, auto, attemptId) {
  const bars = renderDomainBars(Object.entries(res.byDomain).map(([id, v]) => ({ id, name: `Domain ${id}`, avgPct: v.pct })));
  const recs = res.weakDomains?.length
    ? `<div class="card recs"><h3>Study recommendations</h3><p class="muted">Biggest score levers first.</p><ul>` +
      res.weakDomains.map((d) =>
        `<li><a href="#/exam/${encodeURIComponent(examId)}/study">${esc(d.name)}</a> — ${d.pct}% (weight ${d.weight}%) <span class="mono">study this →</span></li>`
      ).join("") + `</ul></div>`
    : "";
  host.innerHTML =
    `<div class="verdict verdict--${res.verdict}" role="status">` +
    `<div class="verdict__icon" aria-hidden="true">${res.verdict === "green" ? "✓" : res.verdict === "amber" ? "!" : "✕"}</div>` +
    `<div><div class="verdict__score">${res.scaled} <span class="mono">/ 1000</span></div>` +
    `<div>${res.pass ? (res.verdict === "green" ? "Pass — exam-ready" : "Pass — but thin") : "Below the 720 cut"}` +
    (auto ? " · auto-submitted (time expired)" : "") + `</div></div></div>` +
    `<div class="card"><h3>By domain</h3>${bars}</div>` +
    recs +
    `<div class="runner__nav">` +
    (attemptId ? `<button class="btn btn--primary" id="reviewBtn">Review answers</button>` : "") +
    (res.weakDomains?.length || res.correct < res.total ? `<button class="btn" id="retryBtn">Retry incorrect</button>` : "") +
    `<button class="btn" id="backHome">Back to exam</button></div>`;
  const back = document.getElementById("backHome");
  if (back) back.addEventListener("click", () => go(`#/exam/${encodeURIComponent(examId)}/home`));
  const rev = document.getElementById("reviewBtn");
  if (rev) rev.addEventListener("click", () => renderReview(host, examId, attemptId));
  const retry = document.getElementById("retryBtn");
  if (retry) retry.addEventListener("click", () => renderRunner(host, { examId, mode: "practice", filters: { source: "incorrect" } }));
}
