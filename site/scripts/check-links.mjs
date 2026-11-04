// SPDX-License-Identifier: GPL-2.0-or-later
// Every internal link, picture and asset in dist/ resolves to a file (as Cloudflare Pages serves it), every
// #fragment names an id on its page, every link inside search.json and the sitemap is a page, and the pages
// that need the Worker point only at its documented routes (/auth/login, /auth/logout, /api/*). External
// links are not fetched.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { at, ORIGIN } from "./lib/paths.mjs";

const dist = at("dist");
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
walk(dist);

const WORKER = /^\/(auth\/(login|logout|callback)|api\/(me|cla|orgs|listings|reports)(\/|$|\?))/;
const target = (path) => {
  const p = decodeURIComponent(path).replace(/\/+$/, "") || "/";
  for (const c of [p, `${p}/index.html`]) { const f = resolve(dist, "." + c); if (existsSync(f) && statSync(f).isFile()) return f; }
  return null;
};
const ids = new Map();
const idsOf = (f) => { if (!ids.has(f)) ids.set(f, new Set([...readFileSync(f, "utf8").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))); return ids.get(f); };
const bad = [];
let checked = 0, worker = 0;
const check = (from, href) => {
  if (href.startsWith(ORIGIN)) href = href.slice(ORIGIN.length) || "/";
  if (!href.startsWith("/") || href.startsWith("//")) return;
  checked++;
  const [pathq, frag] = href.split("#");
  const path = pathq.split("?")[0];
  if (WORKER.test(path + (pathq.includes("?") ? "?" : ""))) { worker++; return; }
  if (/^\/(auth|api)\//.test(path)) return bad.push(`${from}: ${href} (a Worker route that is not documented)`);
  const f = target(path);
  if (!f) return bad.push(`${from}: ${href} (no file)`);
  if (frag && f.endsWith(".html") && !idsOf(f).has(decodeURIComponent(frag))) bad.push(`${from}: ${href} (no #${frag})`);
};
const pages = files.filter((f) => f.endsWith(".html"));
for (const f of pages) {
  const rel = relative(dist, f);
  const html = readFileSync(f, "utf8");
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) check(rel, m[1].replace(/&amp;/g, "&"));
  for (const m of html.matchAll(/\ssrcset="([^"]+)"/g)) for (const s of m[1].split(",")) check(rel, s.trim().split(/\s+/)[0]);
  const l = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  if (!l && !html.includes('name="robots" content="noindex"')) bad.push(`${rel}: no canonical link`); else if (l) check(rel, l);
}
for (const e of JSON.parse(readFileSync(resolve(dist, "search.json"), "utf8"))) check("search.json", e.u);
for (const m of readFileSync(resolve(dist, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)) check("sitemap.xml", m[1]);
for (const must of ["404.html", "sitemap.xml", "robots.txt", "search.json", "_headers", "wolos-mark.svg", "favicon-32.png"]) if (!existsSync(resolve(dist, must))) bad.push(`missing dist/${must}`);
// Every listing in the index has its page, its maker and a way to report it.
const reportable = pages.filter((f) => /\/(apps|plugins|extensions)\/[^/]+\/index\.html$/.test(f)).filter((f) => !readFileSync(f, "utf8").includes('href="/report?listing='));
for (const f of reportable) bad.push(`${relative(dist, f)}: no Report link`);

if (bad.length) { console.error(`check-links: ${bad.length} broken of ${checked} links\n  ${bad.slice(0, 60).join("\n  ")}`); process.exit(1); }
console.log(`check-links: ${checked} internal links in ${pages.length} pages, search and sitemap: all resolve (${worker} go to the Worker's documented routes); every listing has a Report link`);
