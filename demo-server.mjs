// Minimal static file server for trying the UI with fake data: `npm run demo`.
// Serves the project folder only; there is no /api, so nothing touches eBird.
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);

    // Stay inside the project folder, and never serve secrets
    if (!filePath.startsWith(ROOT + path.sep) || path.basename(filePath).startsWith(".env")) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    fs.readFile(filePath, (err, body) => {
      if (err) {
        res.writeHead(404).end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
    });
  })
  .listen(PORT, () => {
    console.log(`Demo running at http://localhost:${PORT}/?demo`);
    console.log(`Partial-results warning: http://localhost:${PORT}/?demo=warning`);
  });
