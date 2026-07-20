// Service worker (spec nice-to-have: installable PWA + offline shell). The app
// SHELL is cached for offline load; ALL /api/* and /.auth/* requests are
// network-only and never cached — scored actions and auth always require online.
const CACHE = "cert-portal-v1";
const SHELL = [
  "/", "/index.html", "/login.html", "/request-access.html",
  "/manifest.webmanifest", "/assets/icon.svg",
  "/assets/css/tokens.css", "/assets/css/app.css",
  "/assets/js/main.js", "/assets/js/router.js", "/assets/js/api.js", "/assets/js/theme.js", "/assets/js/util.js",
  "/assets/js/request-access.js",
  "/assets/js/views/catalog.js", "/assets/js/views/exam.js", "/assets/js/views/practice.js",
  "/assets/js/views/runner.js", "/assets/js/views/review.js", "/assets/js/views/progress.js", "/assets/js/views/admin.js",
  "/assets/js/charts/svgutil.js", "/assets/js/charts/scoreHistory.js", "/assets/js/charts/domainBars.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return; // never intercept mutations
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/.auth/")) return; // network-only
  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached ||
      fetch(e.request).then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match("/index.html")),
    ),
  );
});
