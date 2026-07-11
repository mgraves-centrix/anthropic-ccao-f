// Practice/Mock question runner + results (spec §III.8/§9/§10). Practice gives
// instant feedback; Mock withholds until submit with a server-anchored timer.
// Supports server-authoritative RESUME (Resume / Start over) and surfaces the
// two-tab/two-device conflict (409 -> load latest / overwrite).
import { api } from "../api.js";
import { renderDomainBars } from "../charts/domainBars.js";
import { go } from "../router.js";
import { esc, safeHref, announce, toast } from "../util.js";
import { renderReview } from "./review.js";

export async function renderRunner(host, { examId, mode, filters }) {
  host.innerHTML = `<div class="card"><p class="loading">Checking for an in-progress ${esc(mode)}…</p></div>`;
  let existing = [];
  try { existing = (await api.resume(examId)).filter((a) => a.mode === mode); } catch { /* offline / none */ }
  if (existing.length) return promptResume(host, examId, mode, filters, existing[0]);
  return start(host, examId, mode, filters, null);
}

// Spec §9: closing the tab mid-session must offer Resume / Start over.
function promptResume(host, examId, mode, filters, att) {
  const answered = Object.values(att.progress?.answers || {}).filter((a) => a?.length).length;
  const remain = att.remainingMs != null ? ` · ${Math.ceil(att.remainingMs / 60000)} min left` : "";
  host.innerHTML =
    `<div class="card"><h3>Resume your ${esc(mode)}?</h3>` +
    `<p>You have an in-progress ${esc(mode)} — ${answered}/${att.questions.length} answered${remain}.</p>` +
    (mode === "mock" ? `<p class="muted">The mock timer kept running while you were away.</p>` : "") +
    `<div class="runner__nav"><button class="btn btn--primary" id="resumeBtn">Resume</button>` +
    `<button class="btn" id="startoverBtn">Start over</button></div></div>`;
  host.querySelector("#resumeBtn").addEventListener("click", () => start(host, examId, mode, filters, att));
  host.querySelector("#startoverBtn").addEventListener("click", () => start(host, examId, mode, filters, null));
}

async function start(host, examId, mode, filters, resumed) {
  let att = resumed;
  if (!att) {
    host.innerHTML = `<div class="card"><p class="loading">Preparing your ${esc(mode)}…</p></div>`;
    try { att = await api.createAttempt(examId, mode, mode === "practice" ? (filters || { count: 10 }) : undefined); }
    catch (e) {
      host.innerHTML = `<div class="card"><p>Could not start: ${esc(e.message)}</p>` +
        (e.status === 409 ? `<p class="muted">Nothing matches this selection yet — take some questions first.</p>` : "") + `</div>`;
      return;
    }
  }
  const S = {
    qs: att.questions, idx: att.progress?.currentIndex ?? 0,
    answers: { ...(att.progress?.answers || {}) }, flags: new Set(att.progress?.flags || []),
    rev: att.rev ?? 1, attemptId: att.attemptId, feedback: {}, bookmarked: new Set(), conflict: false,
  };
  api.bookmarkList(examId).then((bs) => { S.bookmarked = new Set(bs.map((b) => b.qid)); draw(); }).catch(() => {});
  let timer = null;
  if (mode === "mock" && att.expiresAt) startTimer(att.expiresAt, () => finish(true));

  // Keyboard shortcuts (WCAG 2.1.1 Keyboard). Ignore while typing in a field.
  function onKey(e) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (!host.querySelector(".qcard")) return; // only while a question is shown
    const q = S.qs[S.idx];
    const k = e.key.toLowerCase();
    if (e.key >= "1" && e.key <= "9") {
      const i = Number(e.key) - 1;
      if (i < q.options.length && !S.feedback[q.qid]) { e.preventDefault(); select(q.qid, i, q.type); }
    } else if (k === "n" || e.key === "ArrowRight") { if (S.idx < S.qs.length - 1) { e.preventDefault(); nav("next"); } }
    else if (k === "p" || e.key === "ArrowLeft") { if (S.idx > 0) { e.preventDefault(); nav("prev"); } }
    else if (k === "f") { e.preventDefault(); nav("flag", q.qid); }
    else if (k === "b") { e.preventDefault(); host.querySelector("[data-bmk]")?.click(); }
    else if (k === "u") { e.preventDefault(); nav("unanswered"); }
  }
  window.addEventListener("keydown", onKey);

  function firstUnanswered() {
    for (let d = 1; d <= S.qs.length; d++) { const i = (S.idx + d) % S.qs.length; if (!(S.answers[S.qs[i].qid]?.length)) return i; }
    return -1;
  }

  function startTimer(expiresAt, onExpire) {
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
    try {
      const r = await api.save(S.attemptId, { rev: S.rev, currentIndex: S.idx, answers: S.answers, flags: [...S.flags] });
      S.rev = r.rev;
    } catch (e) {
      if (e.status === 409) handleConflict(e); // continued on another device
      // else: offline cache tolerated; server is source of truth
    }
  }

  // Spec §9: two-tab/two-device conflict — surface, don't silently clobber.
  function handleConflict(e) {
    if (S.conflict) return;
    S.conflict = true;
    const bar = document.createElement("div");
    bar.className = "conflict-bar";
    bar.innerHTML = `<span>⚠ This attempt was continued on another device.</span> ` +
      `<button class="btn" data-load>Load latest</button> <button class="btn" data-over>Overwrite</button>`;
    host.prepend(bar);
    bar.querySelector("[data-load]").addEventListener("click", async () => { bar.remove(); S.conflict = false; await reloadFromServer(); });
    bar.querySelector("[data-over]").addEventListener("click", async () => {
      bar.remove(); S.conflict = false;
      if (e.data?.rev != null) S.rev = e.data.rev; // adopt server rev, then re-save our state
      await save();
    });
  }

  async function reloadFromServer() {
    try {
      const list = (await api.resume(examId)).filter((a) => a.attemptId === S.attemptId);
      if (!list.length) { host.innerHTML = `<div class="card"><p>This attempt was finished elsewhere.</p><button class="btn" id="bk">Back</button></div>`; host.querySelector("#bk").addEventListener("click", () => go(`#/exam/${encodeURIComponent(examId)}/home`)); return; }
      const a = list[0];
      S.qs = a.questions; S.idx = a.progress.currentIndex; S.answers = { ...a.progress.answers }; S.flags = new Set(a.progress.flags); S.rev = a.rev;
      draw();
    } catch { /* ignore */ }
  }

  function select(qid, i, type) {
    const cur = new Set(S.answers[qid] || []);
    if (type === "single") { S.answers[qid] = [i]; }
    else { cur.has(i) ? cur.delete(i) : cur.add(i); S.answers[qid] = [...cur]; }
    if (mode === "practice") return practiceFeedback(qid);
    save(); draw();
  }

  async function practiceFeedback(qid) {
    try { S.feedback[qid] = await api.answer(S.attemptId, qid, S.answers[qid]); } catch { /* ignore */ }
    save(); draw();
  }

  function navmap() {
    return `<div class="navmap" role="group" aria-label="Question navigator">` +
      S.qs.map((qq, i) => {
        const answered = (S.answers[qq.qid]?.length ?? 0) > 0;
        const flagged = S.flags.has(qq.qid);
        const cls = `navdot${answered ? " answered" : ""}${flagged ? " flagged" : ""}${i === S.idx ? " current" : ""}`;
        const label = `Question ${i + 1}${answered ? ", answered" : ", unanswered"}${flagged ? ", flagged for review" : ""}${i === S.idx ? ", current" : ""}`;
        return `<button class="${cls}" data-goto="${i}" aria-label="${label}"${i === S.idx ? ' aria-current="true"' : ""}>${i + 1}${flagged ? '<span aria-hidden="true">⚑</span>' : ""}</button>`;
      }).join("") + `</div>`;
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
      `<button class="btn${S.flags.has(q.qid) ? " is-flagged" : ""}" data-nav="flag">${S.flags.has(q.qid) ? "Unflag" : "⚑ Flag for review"}</button>` +
      `<button class="btn" data-nav="next" ${S.idx >= S.qs.length - 1 ? "disabled" : ""}>Next</button>` +
      (firstUnanswered() >= 0 ? `<button class="btn" data-nav="unanswered">Next unanswered</button>` : "") +
      `<button class="btn btn--primary" data-nav="submit">Review &amp; submit</button>` +
      `</div>` + navmap() +
      `<p class="mono muted kbd-hint">Shortcuts: <kbd>1</kbd>–<kbd>${q.options.length}</kbd> answer · <kbd>N</kbd>/<kbd>P</kbd> move · <kbd>U</kbd> next unanswered · <kbd>F</kbd> flag · <kbd>B</kbd> bookmark</p>` +
      `</div>`;

    host.querySelectorAll(".opt").forEach((b) => b.addEventListener("click", () => select(q.qid, Number(b.dataset.i), type)));
    host.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => nav(b.dataset.nav, q.qid)));
    host.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", async () => { S.idx = Number(b.dataset.goto); await save(); draw(); }));
    const bmk = host.querySelector("[data-bmk]");
    if (bmk) bmk.addEventListener("click", async () => {
      try {
        if (S.bookmarked.has(q.qid)) { await api.bookmarkRemove(examId, q.qid); S.bookmarked.delete(q.qid); }
        else { await api.bookmarkSet(examId, q.qid); S.bookmarked.add(q.qid); }
        draw();
      } catch { /* ignore */ }
    });
    const answered = (S.answers[q.qid]?.length ?? 0) > 0;
    announce(`Question ${S.idx + 1} of ${S.qs.length}${answered ? ", answered" : ""}${S.flags.has(q.qid) ? ", flagged" : ""}`);
  }

  async function nav(action, qid) {
    if (action === "flag") { S.flags.has(qid) ? S.flags.delete(qid) : S.flags.add(qid); await save(); return draw(); }
    if (action === "prev") { S.idx = Math.max(0, S.idx - 1); await save(); return draw(); }
    if (action === "next") { S.idx = Math.min(S.qs.length - 1, S.idx + 1); await save(); return draw(); }
    if (action === "unanswered") { const i = firstUnanswered(); if (i >= 0) { S.idx = i; await save(); draw(); } else { toast("All questions answered", "info"); } return; }
    if (action === "submit") return reviewBeforeSubmit();
  }

  async function reviewBeforeSubmit() {
    await save();
    const unanswered = [], flagged = [];
    S.qs.forEach((q, i) => { if (!(S.answers[q.qid]?.length)) unanswered.push(i); if (S.flags.has(q.qid)) flagged.push(i); });
    const dots = (list, extra) => `<div class="navmap">` + list.map((i) =>
      `<button class="navdot${extra}${(S.answers[S.qs[i].qid]?.length) ? " answered" : ""}" data-goto="${i}">${i + 1}</button>`).join("") + `</div>`;
    host.innerHTML =
      `<div class="card"><h3>Review &amp; submit</h3>` +
      `<p class="mono">${S.qs.length - unanswered.length} of ${S.qs.length} answered${flagged.length ? ` · ${flagged.length} flagged` : ""}.</p>` +
      (unanswered.length
        ? `<p><strong>${unanswered.length} unanswered</strong> — you can still go back:</p>${dots(unanswered, "")}`
        : `<p class="muted">All questions answered.</p>`) +
      (flagged.length ? `<p><strong>Flagged for review:</strong></p>${dots(flagged, " flagged")}` : "") +
      `<div class="runner__nav">` +
      `<button class="btn" data-back>Keep working</button>` +
      `<button class="btn btn--primary" data-confirm>Submit ${esc(mode)}${unanswered.length ? ` (${unanswered.length} blank)` : ""}</button>` +
      `</div></div>`;
    host.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", async () => { S.idx = Number(b.dataset.goto); await save(); draw(); }));
    host.querySelector("[data-back]").addEventListener("click", () => draw());
    host.querySelector("[data-confirm]").addEventListener("click", () => finish(false));
  }

  async function finish(auto) {
    if (timer) clearInterval(timer);
    window.removeEventListener("keydown", onKey);
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
        `<li><a href="#/exam/${encodeURIComponent(examId)}/study#study-domain-${d.id}">${esc(d.name)}</a> — ${d.pct}% (weight ${d.weight}%) <span class="mono">study this →</span></li>`
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
    `<button class="btn" id="pdfBtn">Save as PDF</button>` +
    `<button class="btn" id="backHome">Back to exam</button></div>`;
  const pdf = document.getElementById("pdfBtn");
  if (pdf) pdf.addEventListener("click", () => window.print());
  const back = document.getElementById("backHome");
  if (back) back.addEventListener("click", () => go(`#/exam/${encodeURIComponent(examId)}/home`));
  const rev = document.getElementById("reviewBtn");
  if (rev) rev.addEventListener("click", () => renderReview(host, examId, attemptId));
  const retry = document.getElementById("retryBtn");
  if (retry) retry.addEventListener("click", () => renderRunner(host, { examId, mode: "practice", filters: { source: "incorrect" } }));
}
