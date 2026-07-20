// Admin → Requests: approve/deny self-service access requests (spec §III.6a).
// Route is admin-gated by staticwebapp.config.json; the API re-checks the role.
import { api } from "../api.js";
import { esc, toast } from "../util.js";

export async function renderAdmin(el) {
  document.body.removeAttribute("data-exam");
  el.innerHTML = `<h1>Access requests</h1><div id="reqs"><p class="loading">Loading…</p></div>`;
  await load(el.querySelector("#reqs"));
}

async function load(host) {
  let reqs;
  try { reqs = await api.listRequests(); }
  catch (e) { host.innerHTML = `<div class="card"><p>${esc(e.message)}</p></div>`; return; }
  if (!reqs.length) { host.innerHTML = `<div class="card"><p class="muted">No pending requests.</p></div>`; return; }
  host.innerHTML = reqs.map((r) =>
    `<div class="card reqrow"><div><strong>${esc(r.displayName)}</strong> <span class="mono">${esc(r.email || "")}</span>` +
    `<br><span class="muted">${esc(r.provider)} · ${esc(r.justification || "no reason given")}</span></div>` +
    `<div class="reqrow__actions"><button class="btn btn--primary" data-a="approve" data-p="${esc(r.provider)}" data-u="${esc(r.providerUserId)}">Approve</button> ` +
    `<button class="btn" data-a="deny" data-p="${esc(r.provider)}" data-u="${esc(r.providerUserId)}">Deny</button></div></div>`
  ).join("");
  host.querySelectorAll("[data-a]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    try { await api.decide(b.dataset.p, b.dataset.u, b.dataset.a, "authorized"); toast(`Request ${b.dataset.a === "approve" ? "approved" : "denied"}`, "info"); await load(host); }
    catch (e) { toast(e.message, "error"); b.disabled = false; }
  }));
}
