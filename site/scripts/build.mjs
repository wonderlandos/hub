// SPDX-License-Identifier: GPL-2.0-or-later
// Builds the hub into dist/: plain files for Cloudflare Pages. No bundler and no dependencies.
//   node scripts/build.mjs           reads data/index.json (or HUB_INDEX: a file or an https address)
// Browsing needs no Worker: the pages are rendered here from the published index; the only live parts are the
// sign-in state, publishing and reports, which src/hub.js asks the Worker for on the same origin.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { at, ORIGIN } from "./lib/paths.mjs";
import { loadIndex, KINDS, ownerPath } from "./lib/data.mjs";
import { manifest } from "./lib/imagefiles.mjs";
import * as R from "./lib/render.mjs";
import { TRUST_LABEL } from "./lib/data.mjs";

const dist = at("dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(resolve(dist, "assets"), { recursive: true });
if (existsSync(at("public"))) cpSync(at("public"), dist, { recursive: true });

const put = (path, text) => { const f = resolve(dist, "." + path); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };
const css = readFileSync(at("src/tokens.css"), "utf8") + "\n" + readFileSync(at("src/hub.css"), "utf8");
const hashed = (name, ext, text) => { const n = `/assets/${name}.${createHash("sha256").update(text).digest("hex").slice(0, 10)}.${ext}`; put(n, text); return n; };
const assets = { origin: ORIGIN, css: hashed("hub", "css", css), js: hashed("hub", "js", readFileSync(at("src/hub.js"), "utf8")), theme: hashed("theme", "js", readFileSync(at("src/theme.js"), "utf8")) };

const idx = await loadIndex();
R.setNames(idx);
const images = manifest();
const pages = [];
const add = (path, html) => { put(path === "/" ? "/index.html" : `${path}/index.html`, html); pages.push(path); };

add("/", R.home(idx, assets));
for (const k of KINDS) add(`/${k.dir}`, R.kindPage(k, idx, assets));
for (const e of idx.entries) add(e.url_path, R.listing(e, assets, images));
for (const o of idx.owners) add(ownerPath(o), R.ownerPage(o, assets));
add("/search", R.search(assets));
add("/publish", R.publish(assets));
add("/report", R.report(assets));
add("/signin", R.signin(assets));
put("/404.html", R.notFound(assets));

// What the client search reads: small, one row per listing.
put("/search.json", JSON.stringify(idx.entries.map((e) => ({
  u: e.url_path, n: e.name, s: e.summary, k: e.kind, a: e.ownerInfo.name, t: e.trust, tl: TRUST_LABEL[e.trust],
  c: e.categories || [], id: e.id,
}))));

const noindex = new Set(["/search", "/report", "/signin"]);
put("/sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.filter((p) => !noindex.has(p)).map((p) => `<url><loc>${ORIGIN}${p === "/" ? "/" : p}</loc></url>`).join("\n")}\n</urlset>\n`);
put("/robots.txt", `User-agent: *\nAllow: /\nDisallow: /auth/\nDisallow: /api/\nSitemap: ${ORIGIN}/sitemap.xml\n`);
put("/_headers", `/assets/*
  Cache-Control: public, max-age=31536000, immutable
/img/*
  Cache-Control: public, max-age=604800
/search.json
  Cache-Control: public, max-age=300
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'
`);
console.log(`build: ${pages.length} pages + 404, ${idx.entries.length} listings, ${idx.owners.length} makers, index serial ${idx.serial}`);
