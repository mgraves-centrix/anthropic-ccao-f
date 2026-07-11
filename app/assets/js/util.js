// Shared rendering helpers.
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Only allow http(s) links to be rendered; anything else (javascript:, data:) → "#". */
export function safeHref(url) {
  const u = String(url ?? "").trim();
  return /^https?:\/\//i.test(u) ? u : "#";
}
