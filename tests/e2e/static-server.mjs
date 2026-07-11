// Minimal static file server for the app/ directory (Playwright webServer).
// Serves real files; falls back to index.html so client hash-routing works.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../../app/", import.meta.url).pathname;
const PORT = process.env.E2E_PORT || 4173;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (path === "/" || path === "") path = "/index.html";
    let file = join(ROOT, path);
    let data;
    try { data = await readFile(file); }
    catch { file = join(ROOT, "index.html"); data = await readFile(file); }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(500); res.end("err");
  }
}).listen(PORT, () => console.log(`e2e static server on ${PORT}`));
