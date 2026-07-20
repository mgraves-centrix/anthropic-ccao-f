// Post-attempt review (spec nice-to-have): every question with your answer, the
// correct answer, rationale + reference, filterable (all / incorrect / flagged-
// bookmarked), with a bookmark toggle + personal note per item.
import { api } from "../api.js";
import { esc, safeHref } from "../util.js";

const state = { filter: "all" };

export async function renderReview(host, examId, attemptId) {
  host.innerHTML = `<div class="card"><p class="loading">Loading review…</p></div>`;
  let res, bookmarks;
  try {
    [res, bookmarks] = await Promise.all([api.review(attemptId), api.bookmarkList(examId).catch(() => [])]);
  } catch (e) {
    host.innerHTML = `<div class="card"><p>Could not load review: ${esc(e.message)}</p></div>`;
    return;
  }
  const marked = new Set(bookmarks.map((b) => b.qid));
  const items = res.review;

  const controls = `<div class="prog-controls">` +
    [["all", "All"], ["incorrect", "Incorrect"], ["bookmarked", "Bookmarked"]].map(([v, l]) =>
      `<button class="chip${state.filter === v ? " is-on" : ""}" data-f="${v}">${l}</button>`).join("") +
    `</div>`;

  const shown = items.filter((it) =>
    state.filter === "all" ? true : state.filter === "incorrect" ? !it.correct : marked.has(it.qid));

  host.innerHTML = controls +
    `<p class="muted mono">${res.correct}/${res.total} correct · scaled ${res.scaled}</p>` +
    (shown.length ? shown.map((it, i) => reviewCard(examId, it, marked.has(it.qid), i)).join("")
      : `<div class="chart-empty">No questions in this filter.</div>`);

  host.querySelectorAll("[data-f]").forEach((b) => b.addEventListener("click", () => { state.filter = b.dataset.f; renderReview(host, examId, attemptId); }));
  wireBookmarks(host, examId, marked);
}

function reviewCard(examId, it, isMarked, i) {
  const verdict = it.correct ? "right" : "wrong";
  return `<div class="card revq"><div class="revq__head">` +
    `<span class="rationale__verdict ${verdict}">${it.correct ? "Correct" : "Incorrect"}</span>` +
    `<button class="bmk${isMarked ? " on" : ""}" data-qid="${esc(it.qid)}" aria-pressed="${isMarked}" title="Bookmark">${isMarked ? "★" : "☆"}</button></div>` +
    `<p class="mono muted">${esc(it.qid)}</p>` +
    `<div class="rationale ${verdict}"><strong>Answer.</strong> ${esc(it.rationale)}` +
    (it.reference?.url ? ` <a href="${esc(safeHref(it.reference.url))}" target="_blank" rel="noreferrer">${esc(it.reference.text || "reference")}</a>` : "") + `</div>` +
    `<label class="note"><span class="mono muted">Note</span><textarea data-note="${esc(it.qid)}" rows="2" class="ra-textarea" placeholder="Add a personal note…"></textarea></label>` +
    `<div class="note__save"><button class="btn" data-savenote="${esc(it.qid)}">Save note</button></div></div>`;
}

function wireBookmarks(host, examId, marked) {
  host.querySelectorAll(".bmk").forEach((b) => b.addEventListener("click", async () => {
    const qid = b.dataset.qid;
    try {
      if (marked.has(qid)) { await api.bookmarkRemove(examId, qid); marked.delete(qid); b.textContent = "☆"; b.classList.remove("on"); }
      else { await api.bookmarkSet(examId, qid); marked.add(qid); b.textContent = "★"; b.classList.add("on"); }
    } catch { /* ignore */ }
  }));
  host.querySelectorAll("[data-savenote]").forEach((b) => b.addEventListener("click", async () => {
    const qid = b.dataset.savenote;
    const note = host.querySelector(`[data-note="${CSS.escape(qid)}"]`).value.slice(0, 2000);
    b.disabled = true; b.textContent = "Saving…";
    try { await api.bookmarkSet(examId, qid, note); b.textContent = "Saved"; }
    catch { b.textContent = "Save note"; b.disabled = false; }
  }));
}
