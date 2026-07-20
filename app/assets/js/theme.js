// Theme toggle (spec §14). Persists per user in localStorage; defaults to OS.
const KEY = "cert-portal-theme";

export function applyStoredTheme() {
  const saved = localStorage.getItem(KEY);
  if (saved === "light" || saved === "dark") {
    document.documentElement.setAttribute("data-theme", saved);
  } else {
    document.documentElement.removeAttribute("data-theme"); // follow prefers-color-scheme
  }
}

export function currentTheme() {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr) return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function wireThemeToggle(btn) {
  if (!btn) return;
  btn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    localStorage.setItem(KEY, next);
    document.documentElement.setAttribute("data-theme", next);
  });
}
