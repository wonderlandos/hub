// SPDX-License-Identifier: GPL-2.0-or-later
// Builds the hub into dist/: plain files for Cloudflare Pages. No bundler and no dependencies.
//   node scripts/build.mjs           reads data/index.json (or HUB_INDEX: a file or an https address)
//   FACTS_DIR / FACTS_BASE           where the package pictures named in the index are (lib/facts.mjs)
//   STATEMENTS_DIR                   signed release statements as <id>/<version>.wsig (default data/statements)
//   LEGAL_DIR                        the agreements and policies as <doc>.md (default ../legal)
//   HUB_API=off                      no Worker behind the pages: they never call /api (sign-in links stay)
//   DIST                             where to write (default dist)
// Browsing needs no Worker: the store pages are rendered here from the published index. The live parts
// (sign-in, the agreements, publishing, the dashboard, reports, the admin panel) ask the Worker on the same origin.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { at, ORIGIN } from "./lib/paths.mjs";
import { loadIndex, KINDS, ownerPath, versionPath, TRUST_LABEL } from "./lib/data.mjs";
import { manifest } from "./lib/imagefiles.mjs";
import { facts } from "./lib/facts.mjs";
import * as R from "./lib/render.mjs";
import * as A from "./lib/render-account.mjs";
import { legalDocs } from "./lib/legal.mjs";

const dist = process.env.DIST ? resolve(process.env.DIST) : at("dist");
// HUB_API=off: a fully static hub (the fixture review deploy): no page asks the Worker for anything.
const apiOff = process.env.HUB_API === "off";
rmSync(dist, { recursive: true, force: true });
mkdirSync(resolve(dist, "assets"), { recursive: true });
if (existsSync(at("public"))) cpSync(at("public"), dist, { recursive: true });

const put = (path, text) => { const f = resolve(dist, "." + path); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };
const css = readFileSync(at("src/tokens.css"), "utf8") + "\n" + readFileSync(at("src/hub.css"), "utf8");
const hashed = (name, ext, text) => { const n = `/assets/${name}.${createHash("sha256").update(text).digest("hex").slice(0, 10)}.${ext}`; put(n, text); return n; };
const js = (name) => hashed(name, "js", readFileSync(at(`src/${name}.js`), "utf8"));
const assets = { apiOff, origin: ORIGIN, css: hashed("hub", "css", css), js: js("hub"), theme: js("theme"), search: js("search"), pictures: js("pictures"), account: js("account") };
const ADMIN = js("admin");

const idx = await loadIndex();
const NAMES = new Map(idx.entries.map((e) => [e.id, e.name]));
const warnings = await facts(dist).prepare(idx.entries);
const images = manifest();
const pages = [];
const add = (path, html) => { put(path === "/" ? "/index.html" : `${path}/index.html`, html); pages.push(path); };

/** A version's statement on the hub's own address, so "Verify offline" downloads it in one click. */
const statementOf = (e, r) => {
  const f = resolve(process.env.STATEMENTS_DIR || at("data/statements"), e.id, `${r.version}.wsig`);
  if (existsSync(f)) { const p = `/statements/${e.id}/${r.version}.wsig`; put(p, readFileSync(f)); return p; }
  return r.statement?.url || null;
};

add("/", R.home(idx, assets));
for (const k of KINDS) add(`/${k.dir}`, R.kindPage(k, idx, assets));
for (const c of idx.categories) add(`/categories/${c.slug}`, R.categoryPage(c, idx, assets));
for (const e of idx.entries) {
  add(e.url_path, R.listing(e, assets, images, NAMES));
  for (const r of e.releases) add(versionPath(e, r), R.version(e, r, assets, statementOf(e, r)));
}
for (const o of idx.owners) add(ownerPath(o), R.ownerPage(o, assets));
add("/search", R.search(assets));
add("/publish", A.publish(assets));
add("/dashboard", A.dashboard(assets));
add("/report", R.report(assets));
const legal = legalDocs();
for (const t of legal) { add(`/terms/${t.doc}`, R.terms(t, legal, assets)); if (t.found) put(`/terms/${t.doc}.txt`, t.text); }
add("/signin", R.signin(assets));
put("/admin/index.html", A.admin(assets, ADMIN)); // not in `pages`: never in the sitemap
put("/404.html", R.notFound(assets));

// What the client search reads: small, one row per listing.
put("/search.json", JSON.stringify(idx.entries.map((e) => ({
  u: e.url_path, n: e.name, s: e.summary, k: e.kind, a: e.ownerInfo.name, t: e.trust, tl: TRUST_LABEL[e.trust],
  c: e.categories || [], id: e.id, o: e.owner.login, ...(e.iconUrl ? { i: e.iconUrl } : { l: R.tileClass(e) }),
}))));

const noindex = new Set(["/search", "/report", "/signin", "/dashboard"]);
put("/sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.filter((p) => !noindex.has(p)).map((p) => `<url><loc>${ORIGIN}${p === "/" ? "/" : p}</loc></url>`).join("\n")}\n</urlset>\n`);
put("/robots.txt", `User-agent: *\nAllow: /\nDisallow: /auth/\nDisallow: /api/\nSitemap: ${ORIGIN}/sitemap.xml\n`);
put("/_headers", `/assets/*
  Cache-Control: public, max-age=31536000, immutable
/img/*
  Cache-Control: public, max-age=604800
/statements/*
  Cache-Control: public, max-age=300
  Content-Disposition: attachment
/search.json
  Cache-Control: public, max-age=300
/terms/*.txt
  Content-Type: text/plain; charset=utf-8
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'
/admin
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-store
  Referrer-Policy: no-referrer
/admin/*
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-store
  Referrer-Policy: no-referrer
`);
for (const w of warnings) console.warn(`build: picture left out: ${w}`);
console.log(`build: ${pages.length} pages + 404 + admin shell (${legal.filter((t) => t.found).length} of ${legal.length} terms written), ${idx.entries.length} listings, ${idx.categories.length} categories, ${idx.owners.length} makers, index serial ${idx.serial}`);
