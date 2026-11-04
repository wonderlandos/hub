// SPDX-License-Identifier: GPL-2.0-or-later
// Serves dist/ as Pages does, on PORT (default 8788); /api and /auth answer 404 here.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { at } from "./lib/paths.mjs";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
const root = at("dist");
createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const f = [p, p + "/index.html"].map((c) => resolve(root, "." + c)).find((c) => existsSync(c) && statSync(c).isFile());
  res.writeHead(f ? 200 : 404, { "content-type": TYPES[extname(f || "404.html")] || "application/octet-stream" });
  res.end(readFileSync(f || resolve(root, "404.html")));
}).listen(Number(process.env.PORT) || 8788, () => console.log("dist/ on http://127.0.0.1:" + (Number(process.env.PORT) || 8788)));
