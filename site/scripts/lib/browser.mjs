// SPDX-License-Identifier: GPL-2.0-or-later
// A headless browser for the proof screenshots and the fixture pictures, without making it a dependency:
// the browser automation module comes from PLAYWRIGHT_CORE (a folder holding it) and the browser from
// CHROME. Both are tools on the build machine, not part of the hub.
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";

export async function launch() {
  const dir = process.env.PLAYWRIGHT_CORE || "/tmp/cw-tools/node_modules/playwright-core";
  const { chromium } = createRequire(import.meta.url)(dir);
  const exe = process.env.CHROME || "/tmp/cw-tools/chrome";
  return chromium.launch({ executablePath: exe, args: ["--no-sandbox", "--password-store=basic", "--use-mock-keychain"] });
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };

/** Serves `root` as Pages does (file, or folder/index.html, else 404.html); `api(req, res)` answers /api and /auth first. */
export async function serve(root, api) {
  const srv = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (api && /^\/(api|auth)\//.test(url.pathname)) return api(req, res, url);
    const p = decodeURIComponent(url.pathname);
    let f = [p, p + "/index.html", p.replace(/\/$/, "") + "/index.html"].map((c) => resolve(root, "." + c)).find((c) => existsSync(c) && statSync(c).isFile());
    const status = f ? 200 : 404;
    f ||= resolve(root, "404.html");
    res.writeHead(status, { "content-type": TYPES[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  return { base: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() };
}
