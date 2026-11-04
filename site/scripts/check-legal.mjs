// SPDX-License-Identifier: GPL-2.0-or-later
// The agreements and policies, after the build:
//   - every file in legal/ (but README.md and RESEARCH.md) has a row with a /terms/<slug> route in the version
//     table of legal/README.md, and every row names a file that is there; slugs and routes are unique;
//   - the SHA-256 in each row is the hash of the file's bytes, and dist/terms/<slug>.txt is those same bytes;
//   - lib/legal.mjs DOCS (the map for a folder without a README) is the README table;
//   - each page has its version line, the "In short" box marked as not binding, the side list of its headings
//     (every entry an id on the page), "Download as text" and the sha256; /terms lists every text with its box.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { at } from "./lib/paths.mjs";
import { DOCS, NOT_SERVED, legalDir, legalDocs, readmeTable, sha256 } from "./lib/legal.mjs";

const dir = legalDir(), dist = at("dist"), bad = [];
const table = readmeTable(dir);
if (!table) { console.error(`check-legal: no README.md with the version table in ${dir}`); process.exit(1); }
const files = readdirSync(dir).filter((f) => f.endsWith(".md") && !NOT_SERVED.includes(f)).sort();
const byFile = new Map(table.map((r) => [r.file, r]));
for (const f of files) {
  const r = byFile.get(f);
  if (!r) bad.push(`legal/${f}: no row in the README version table`);
  else if (!r.slug) bad.push(`legal/${f}: its route "${r.route}" is not /terms/<slug>`);
}
for (const r of table) if (!existsSync(resolve(dir, r.file))) bad.push(`README row ${r.file}: no such file`);
for (const k of ["slug", "file"]) { const seen = new Set(); for (const r of table) { if (seen.has(r[k])) bad.push(`README: ${k} ${r[k]} twice`); seen.add(r[k]); } }
for (const r of table) if (NOT_SERVED.includes(r.file)) bad.push(`README: ${r.file} has a route but is not served`);
const docs = JSON.stringify(DOCS), fromTable = JSON.stringify(table.map((r) => [r.slug, r.file, r.title]));
if (docs !== fromTable) bad.push(`lib/legal.mjs DOCS differs from the README table:\n    DOCS   ${docs}\n    README ${fromTable}`);

const html = (p) => { const f = resolve(dist, "." + p, "index.html"); return existsSync(f) ? readFileSync(f, "utf8") : null; };
const index = html("/terms");
if (!index) bad.push("dist: no /terms page");
for (const t of legalDocs(dir)) {
  if (!t.found) continue;
  const where = `/terms/${t.doc} (${t.file})`;
  if (t.sha256 !== t.listed) bad.push(`${where}: README says sha256 ${t.listed}, the file is ${t.sha256}`);
  const txt = resolve(dist, "terms", `${t.doc}.txt`);
  if (!existsSync(txt)) bad.push(`${where}: no ${t.doc}.txt in dist`);
  else if (sha256(readFileSync(txt)) !== t.listed) bad.push(`${where}: the served text is not the bytes the README hashes`);
  if (!t.versionLine) bad.push(`${where}: no "Version N, effective ..." line after the title`);
  if (!t.short) bad.push(`${where}: no "In short" box after the version line`);
  if (!t.toc.length) bad.push(`${where}: no ## headings for the side list`);
  const h = html(`/terms/${t.doc}`);
  if (!h) { bad.push(`${where}: not built`); continue; }
  const ids = new Set([...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  if (ids.size !== [...h.matchAll(/\sid="([^"]+)"/g)].length) bad.push(`${where}: an id twice on the page`);
  for (const e of t.toc) if (!ids.has(e.id) || !h.includes(`href="#${e.id}"`)) bad.push(`${where}: side list entry #${e.id} has no heading or no link`);
  const must = [[t.versionLine, "the version line"], ['class="short"', "the In short box"], ["Not binding", "the not-binding mark"], ['class="toc"', "the side list"],
    [`href="/terms/${t.doc}.txt"`, "the Download as text link"], ["Download as text", "the Download as text words"], [`<code>${t.listed}</code>`, "the sha256 from the README"]];
  for (const [s, what] of must) if (s && !h.includes(s)) bad.push(`${where}: no ${what}`);
  if (index && (!index.includes(`href="/terms/${t.doc}"`) || !index.includes(t.short?.lines[0]?.html ?? "\0"))) bad.push(`/terms: does not list ${t.doc} with its In short box`);
}
if (bad.length) { console.error(`check-legal: ${bad.length} problem(s)\n  ${bad.join("\n  ")}`); process.exit(1); }
console.log(`check-legal: ${files.length} texts in legal/ (README and RESEARCH not served), each with a /terms route in the README table, its sha256 equal to the file and to the served text, its version line, In short box marked not binding, side list, download link and sha256 on the page; /terms lists all ${files.length}`);
