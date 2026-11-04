// SPDX-License-Identifier: GPL-2.0-or-later
// Wonderland Doctrine and "No engineer talk" for the hub (the WolOS site's check-doctrine.mjs, adapted).
//   1. Upstream names stay out of our own words: the project names the OS test lists (data/doctrine.json, a
//      snapshot of the OS repo's doctrine_docs.rs tables, copied by sync-tokens.mjs) and every project and
//      holder credited in THIRD-PARTY.md, in src/, scripts/ and data/index.json.
//   2. The visible text of every built page (dist/**/index.html) carries no repository path, file name, decision
//      record number, run id, commit id, hedge ("not yet", "planned", ...) or build word (JSON, API, ...).
//      The listings' own sha256 is a fingerprint, not a commit id, and code blocks are code.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { at, ROOT } from "./lib/paths.mjs";
import { ALLOWED_ADDRESSES, ENGINEER, HEDGES, HUB_TALK, builtPages, scan, visible } from "./lib/visible.mjs";

const read = (p) => readFileSync(p, "utf8").replace(/\r\n?/g, "\n");
const list = JSON.parse(read(at("data/doctrine.json")));
if (list.prose.length < 2 || list.credited.length < 4) { console.error(`check-doctrine: the name list lost its entries (${list.prose.length} prose, ${list.credited.length} credited)`); process.exit(1); }

const WORD = /[\p{L}\p{N}_]/u;
function wordHits(t, pat) {
  for (let i = t.indexOf(pat); i >= 0; i = t.indexOf(pat, i + 1)) {
    const before = [...t.slice(0, i)].pop(), after = [...t.slice(i + pat.length)][0];
    if (!(before && WORD.test(before)) && !(after && WORD.test(after))) return true;
  }
  return false;
}
/** A line without its code spans and link targets. */
const prose = (l) => l.replace(/`[^`]*`?/g, "").replace(/\]\([^)]*\)?/g, "]");
// Words the site never uses for WolOS (positioning): it is an operating system.
const FORBIDDEN = ["distro", "distros"];

function walk(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (!["node_modules", "dist"].includes(f)) walk(p, exts, out); }
    else if (exts.some((e) => f.endsWith(e))) out.push(p);
  }
  return out;
}
const SELF = at("scripts/check-doctrine.mjs");
const files = [...walk(at("src"), [".js", ".css"]), ...walk(at("scripts"), [".mjs"]), at("data/index.json")].filter((p) => p !== SELF);
const bad = [];
const lineCheck = (where, l) => {
  const lower = l.toLowerCase();
  for (const name of list.credited) if (wordHits(lower, name)) bad.push(`${where}: "${name}" is credited in THIRD-PARTY.md and named only there: ${l.trim().slice(0, 140)}`);
  for (const w of FORBIDDEN) if (wordHits(lower, w)) bad.push(`${where}: "${w}": WolOS is an operating system: ${l.trim().slice(0, 140)}`);
  const p = prose(l);
  for (const [name, why] of list.prose) if (wordHits(p, name)) bad.push(`${where}: "${name}": ${why}: ${l.trim().slice(0, 140)}`);
};
for (const f of files) read(f).split("\n").forEach((l, i) => lineCheck(`${relative(ROOT, f)}:${i + 1}`, l));

// The scanner itself.
const [p0] = list.prose[0];
const self = [
  wordHits(`the ${p0} fragment`, p0), wordHits(`${p0}'s socket`, p0), !wordHits(`${p0.toLowerCase()}.conf`, p0), !wordHits(`${p0}X`, p0),
  scan(visible("<body><p>See docs/adr/0016-arch.md and CHANGELOG · ADR 0023 · rel012 · tests/test-installer.sh</p></body>"), [ENGINEER]).length >= 5,
  scan(visible("<body><p>Not yet proven on real hardware. Coming soon. In review for the next build.</p></body>"), [HEDGES]).length >= 4,
  scan(visible("<body><p>It reads JSON from the API and is safe.</p></body>"), [HUB_TALK]).length >= 3,
  scan(visible("<body><template><p>Secure and approved software.</p></template></body>"), [HUB_TALK]).length >= 2,
  // The one exact address passes; the bare word, a longer address or another domain still fail.
  scan(visible("<body><p>Write to security@wolos.org, or <a href=\"mailto:security@wolos.org\">security@wolos.org</a>.</p></body>"), [HUB_TALK]).length === 0,
  scan(visible("<body><p>Our security team: security@wolos.org.evil, security@wolos.org.uk, security@example.org, safe@wolos.org</p></body>"), [HUB_TALK]).length === 5,
  scan(visible('<body><pre>commit 0123456789abcdef0123456789abcdef01234567</pre><p>sha256 9c2e7a41f0b35d68e4a1c97b02f5d83e6b10a4c79d2e5f8b31c06a7d94e2b5f1</p><img alt="x"></body>'), [ENGINEER, HEDGES, HUB_TALK]).length === 0,
];
if (self.includes(false)) { console.error(`check-doctrine: scanner self-test failed: ${JSON.stringify(self)}`); process.exit(1); }

const DIST = at("dist");
if (!existsSync(resolve(DIST, "index.html"))) { console.error("check-doctrine: no dist/ (run the build first)"); process.exit(1); }
const routes = builtPages(DIST);
let lines = 0;
for (const route of routes) {
  const file = route === "/404" ? resolve(DIST, "404.html") : resolve(DIST, "." + route, "index.html");
  const vis = visible(read(file));
  lines += vis.length;
  vis.forEach((l) => lineCheck(`${route} (text)`, l));
  // The legal texts may name the hub's processors and file formats (a privacy policy must); the safety words still never pass.
  const lists = route === "/terms" || route.startsWith("/terms/") ? [HEDGES, HUB_TALK.slice(1)] : [ENGINEER, HEDGES, HUB_TALK];
  for (const [line, token, why] of scan(vis, lists)) bad.push(`${route}: ${why} "${token}": ${line.slice(0, 140)}`);
}
// The scripts' own messages are read by people too (the admin panel has all its words there): scan their strings.
let strings = 0;
for (const f of walk(at("src"), [".js"])) {
  const js = read(f).split("\n").flatMap((l) => [...l.matchAll(/"((?:[^"\\\n]|\\.){12,})"/g)].map((m) => m[1])).filter((s) => /\s/.test(s) && !/[<>]/.test(s));
  strings += js.length;
  for (const [line, token, why] of scan(js, [ENGINEER.slice(0, 4), HEDGES, HUB_TALK])) bad.push(`${relative(ROOT, f)}: ${why} "${token}": ${line.slice(0, 140)}`);
}
// The admin page is a closed shell: no visible words, no links to it from anywhere.
const adminFile = resolve(DIST, "admin", "index.html");
if (!existsSync(adminFile)) bad.push("/admin: no shell");
else if (visible(read(adminFile)).length) bad.push(`/admin: the shell shows words: ${visible(read(adminFile)).join(" | ").slice(0, 140)}`);

if (bad.length) { console.error(`check-doctrine: ${bad.length} problem(s)\n  ${bad.join("\n  ")}`); process.exit(1); }
console.log(`check-doctrine: ${files.length} source files, ${strings} script messages and ${routes.length} built pages (${lines} lines of visible text, templates included), ${list.prose.length + list.credited.length} names: no upstream names, no engineer talk, no hedges, never "safe", "secure" or "approved software" (only the exact addresses ${ALLOWED_ADDRESSES.join(", ")} may show such a word); the admin shell has no words`);
