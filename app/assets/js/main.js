// Bootstrap (spec §III.8). Reads /.auth/me, applies theme, registers views,
// starts the hash router. CSP-safe: external modules only.
import { applyStoredTheme, wireThemeToggle } from "./theme.js";
import { register, startRouter } from "./router.js";
import { renderCatalog } from "./views/catalog.js";
import { renderExam } from "./views/exam.js";
import { renderAdmin } from "./views/admin.js";
import { renderDrafts } from "./views/drafts.js";

async function whoAmI() {
  try {
    const r = await fetch("/.auth/me");
    if (!r.ok) return null;
    const { clientPrincipal } = await r.json();
    return clientPrincipal;
  } catch { return null; }
}

async function boot() {
  applyStoredTheme();
  wireThemeToggle(document.getElementById("themeToggle"));

  const me = await whoAmI();
  const chip = document.getElementById("userChip");
  if (chip) {
    const roles = me?.userRoles || [];
    const links =
      (roles.includes("admin") ? `<a href="#/admin" class="adminlink">Admin</a> ` : "") +
      (roles.includes("reviewer") || roles.includes("admin") ? `<a href="#/drafts" class="adminlink">Drafts</a> ` : "");
    chip.innerHTML = links + (me?.userDetails || "");
  }

  register("catalog", (el) => { document.body.removeAttribute("data-exam"); return renderCatalog(el); });
  register("exam", (el, route) => renderExam(el, route));
  register("admin", (el) => renderAdmin(el));
  register("drafts", (el) => renderDrafts(el));

  const app = document.getElementById("app");
  await startRouter(app);
  registerPwa();
}

function registerPwa() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
  // Installable PWA: surface an Install button when the browser offers it.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    const chip = document.getElementById("userChip");
    if (!chip || document.getElementById("installBtn")) return;
    const btn = document.createElement("button");
    btn.id = "installBtn"; btn.className = "iconbtn install-btn"; btn.textContent = "Install";
    btn.addEventListener("click", async () => { btn.remove(); e.prompt(); await e.userChoice; });
    chip.parentElement.insertBefore(btn, chip);
  });
}

boot();
