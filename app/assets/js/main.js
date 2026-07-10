// Bootstrap (spec §III.8). Reads /.auth/me, applies theme, mounts the router.
// Phase 3 fills views; this shell proves auth wiring + theming + CSP-safe boot.
import { applyStoredTheme, wireThemeToggle } from "./theme.js";

async function whoAmI() {
  try {
    const r = await fetch("/.auth/me");
    if (!r.ok) return null;
    const { clientPrincipal } = await r.json();
    return clientPrincipal; // { userId, userDetails, identityProvider, userRoles }
  } catch {
    return null;
  }
}

async function boot() {
  applyStoredTheme();
  wireThemeToggle(document.getElementById("themeToggle"));

  const app = document.getElementById("app");
  const me = await whoAmI();
  const chip = document.getElementById("userChip");

  if (!me) {
    // Local dev / not signed in — the SWA platform gates real routes.
    chip.textContent = "";
    app.innerHTML =
      '<div class="card"><h1>Anthropic Certification Study Portal</h1>' +
      '<p>Sign in to continue.</p>' +
      '<p><a class="btn btn--primary" href="/.auth/login/aad">Sign in with Microsoft</a> ' +
      '<a class="btn" href="/.auth/login/github">GitHub</a></p></div>';
    return;
  }

  chip.textContent = me.userDetails || "signed in";
  app.innerHTML =
    '<div class="card"><h1>Welcome</h1><p>Portal shell is live. Exam catalog and the ' +
    'four-tab workspace land in Phase 3.</p>' +
    '<p class="mono">roles: ' + (me.userRoles || []).join(", ") + "</p></div>";
}

boot();
