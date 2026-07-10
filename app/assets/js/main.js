// Bootstrap (spec §III.8). Reads /.auth/me, applies theme, registers views,
// starts the hash router. CSP-safe: external modules only.
import { applyStoredTheme, wireThemeToggle } from "./theme.js";
import { register, startRouter } from "./router.js";
import { renderCatalog } from "./views/catalog.js";
import { renderExam } from "./views/exam.js";

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
  if (chip) chip.textContent = me?.userDetails || "";

  register("catalog", (el) => { document.body.removeAttribute("data-exam"); return renderCatalog(el); });
  register("exam", (el, route) => renderExam(el, route));

  const app = document.getElementById("app");
  await startRouter(app);
}

boot();
