// SPDX-License-Identifier: GPL-2.0-or-later
// The headers hub.wolos.org is served with (Cloudflare Pages reads dist/_headers, written by build.mjs), asserted per
// route (QA-WEB-PRIVACY-4, -5, -9): HSTS, nosniff, frame and referrer policy, a Permissions-Policy that names the
// features it turns off, and a Content-Security-Policy without 'unsafe-inline' for scripts and without any host but the
// avatar images' (GitHub's image servers; the Privacy Policy section 6.3.1 names them) and Cloudflare Web Analytics' beacon
// (script-src-elem static.cloudflareinsights.com, connect-src cloudflareinsights.com: the zone's cookie-free analytics,
// injected at Cloudflare's edge, not by the hub's pages; nothing else). Builds a production dist in a
// temporary folder; DIST=<folder> reads one instead.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { at } from "./lib/paths.mjs";

/** Pages' _headers: a path pattern on its own line, then indented `Name: value` lines. */
export function parse(text) {
  const blocks = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) blocks.push({ pattern: line.trim(), headers: [] });
    else { const m = /^\s+([A-Za-z0-9-]+):\s*(.*)$/.exec(line); if (m) blocks.at(-1).headers.push([m[1].toLowerCase(), m[2].trim()]); }
  }
  return blocks;
}
const matches = (pattern, path) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(path);
/** The headers a path gets: every matching block, values of one name joined with ", " (as Pages does). */
export function headersFor(blocks, path) {
  const out = {};
  for (const b of blocks) if (matches(b.pattern, path)) for (const [k, v] of b.headers) out[k] = out[k] ? `${out[k]}, ${v}` : v;
  return out;
}

const own = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (own) {
  const bad = [];
  let dist = process.env.DIST, tmp = null;
  if (!dist) {
    tmp = mkdtempSync(join(tmpdir(), "hub-headers-")); dist = tmp;
    const r = spawnSync(process.execPath, [at("scripts/build.mjs")], { env: { ...process.env, HUB_FIXTURE: "", HUB_INDEX: "", DIST: dist }, encoding: "utf8" });
    if (r.status !== 0) { console.error(`check-headers: build failed: ${r.stderr}`); process.exit(1); }
  }
  const blocks = parse(readFileSync(join(dist, "_headers"), "utf8"));
  const ROUTES = ["/", "/apps/org.wolos.notes/", "/signin/", "/terms/privacy/", "/terms/privacy.txt", "/search.json", "/statements/org.wolos.notes/1.4.0.wsig", "/assets/hub.0123456789.js", "/admin/", "/admin/x", "/img/listings/x.png"];
  const csp = (h) => Object.fromEntries((h["content-security-policy"] || "").split(";").map((d) => d.trim()).filter(Boolean).map((d) => [d.split(/\s+/)[0], d.split(/\s+/).slice(1)]));
  for (const path of ROUTES) {
    const h = headersFor(blocks, path), at_ = (what) => bad.push(`${path}: ${what}`);
    const hsts = /^max-age=(\d+)(;.*)?$/.exec(h["strict-transport-security"] || "");
    if (!hsts || +hsts[1] < 15552000) at_(`Strict-Transport-Security max-age >= 15552000 expected, got ${h["strict-transport-security"]}`);
    if (h["x-content-type-options"] !== "nosniff") at_("X-Content-Type-Options: nosniff expected");
    if (h["x-frame-options"] !== "DENY" && !/\/admin/.test(path) === false && false) at_("");
    if (h["x-frame-options"] !== "DENY") at_(`X-Frame-Options: DENY expected, got ${h["x-frame-options"]}`);
    if (!/^(strict-origin-when-cross-origin|no-referrer)$/.test((h["referrer-policy"] || "").split(",").pop().trim())) at_(`Referrer-Policy expected, got ${h["referrer-policy"]}`);
    const pp = h["permissions-policy"] || "";
    for (const f of ["camera", "microphone", "geolocation"]) if (!pp.includes(`${f}=()`)) at_(`Permissions-Policy must turn ${f} off, got "${pp}"`);
    const c = csp(h);
    if (!c["default-src"]?.includes("'self'")) at_("CSP default-src 'self' expected");
    if (JSON.stringify(c["script-src"]) !== JSON.stringify(["'self'"])) at_(`CSP script-src must be 'self' alone, got ${c["script-src"]}`);
    if (!c["frame-ancestors"]?.includes("'none'")) at_("CSP frame-ancestors 'none' expected");
    if (!c["base-uri"]?.includes("'self'") || !c["form-action"]?.includes("'self'")) at_("CSP base-uri and form-action 'self' expected");
    if (JSON.stringify(c["script-src-elem"]) !== JSON.stringify(["'self'", "https://static.cloudflareinsights.com"])) at_(`CSP script-src-elem must be 'self' and the Web Analytics beacon alone, got ${c["script-src-elem"]}`);
    if (JSON.stringify(c["connect-src"]) !== JSON.stringify(["'self'", "https://cloudflareinsights.com"])) at_(`CSP connect-src must be 'self' and the Web Analytics endpoint alone, got ${c["connect-src"]}`);
    /* Each host only where it belongs: the avatars as images, the beacon as a script element, its endpoint as a connection. */
    const ALLOWED = { "img-src": ["https://avatars.githubusercontent.com"], "script-src-elem": ["https://static.cloudflareinsights.com"], "connect-src": ["https://cloudflareinsights.com"] };
    for (const [d, vs] of Object.entries(c)) for (const v of vs) if (/^https?:/.test(v) && !(ALLOWED[d] || []).includes(v)) at_(`CSP ${d} names a host it may not: ${v}`);
    if (h["access-control-allow-origin"]) at_(`the file sets Access-Control-Allow-Origin (${h["access-control-allow-origin"]}): pages are not read cross-origin`);
    if (/\/admin(\/|$)/.test(path) && !/noindex/.test(h["x-robots-tag"] || "")) at_("the admin shell must be noindex");
    if (/^\/assets\//.test(path) && !/immutable/.test(h["cache-control"] || "")) at_("assets must be immutable");
    if (/^\/statements\//.test(path) && !/attachment/.test(h["content-disposition"] || "")) at_("statements must be downloaded, not shown");
  }
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  if (bad.length) { console.error(`check-headers: ${bad.length} problem(s)\n  ${bad.join("\n  ")}`); process.exit(1); }
  console.log(`check-headers: ${ROUTES.length} routes have HSTS, nosniff, DENY, a referrer policy, a Permissions-Policy and a CSP with script-src 'self' and no host but the avatar servers (images) and the Web Analytics beacon (script element, connection)`);
}
