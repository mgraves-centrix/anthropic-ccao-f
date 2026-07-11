// Shared rendering helpers.
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Only allow http(s) links to be rendered; anything else (javascript:, data:) → "#". */
export function safeHref(url) {
  const u = String(url ?? "").trim();
  return /^https?:\/\//i.test(u) ? u : "#";
}

// Non-blocking toast notifications (replaces alert()). The container is an
// aria-live region so screen readers announce messages (WCAG 4.1.3 Status Messages).
function toastHost() {
  let h = document.getElementById("toasts");
  if (!h) { h = document.createElement("div"); h.id = "toasts"; h.className = "toasts"; h.setAttribute("aria-live", "polite"); h.setAttribute("role", "status"); document.body.appendChild(h); }
  return h;
}
export function toast(msg, kind = "info") {
  const t = document.createElement("div");
  t.className = `toast toast--${kind}`;
  t.textContent = msg;
  toastHost().appendChild(t);
  setTimeout(() => { t.classList.add("toast--out"); setTimeout(() => t.remove(), 250); }, 3200);
}

/** Announce a transient message to assistive tech without moving focus. */
export function announce(msg) {
  let live = document.getElementById("sr-live");
  if (!live) { live = document.createElement("div"); live.id = "sr-live"; live.className = "visually-hidden"; live.setAttribute("aria-live", "polite"); document.body.appendChild(live); }
  live.textContent = "";
  setTimeout(() => { live.textContent = msg; }, 30);
}
