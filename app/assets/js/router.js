// Hash router (spec §III.8): #/  and  #/exam/<id>/<tab>. Preserves place on
// exam switch. Views register render(el, params) handlers.
const routes = new Map();
export function register(name, render) { routes.set(name, render); }

export function parseHash() {
  const h = (location.hash || "#/").slice(1);
  const parts = h.split("/").filter(Boolean); // ["exam","CCAO-F","practice"]
  if (parts[0] === "exam" && parts[1]) {
    return { view: "exam", examId: decodeURIComponent(parts[1]), tab: parts[2] || "home" };
  }
  if (parts[0] === "admin") return { view: "admin" };
  if (parts[0] === "drafts") return { view: "drafts" };
  return { view: "catalog" };
}

export function go(path) { location.hash = path; }

export async function mount(el) {
  const route = parseHash();
  const render = routes.get(route.view) || routes.get("catalog");
  el.setAttribute("aria-busy", "true");
  try {
    await render(el, route);
  } catch (e) {
    el.innerHTML = `<div class="card"><p>Something went wrong: ${e.message}</p></div>`;
  } finally {
    el.removeAttribute("aria-busy");
  }
}

export function startRouter(el) {
  window.addEventListener("hashchange", () => mount(el));
  return mount(el);
}
