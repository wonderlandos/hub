// SPDX-License-Identifier: GPL-2.0-or-later
// The size budget, measured on dist/: what a page costs to load, gzipped. Per page: its HTML, the stylesheet,
// its scripts (the admin shell: also the panel's script it loads; pictures are separate and lazy). Budgets: a page at most 20 KB of HTML, 12 KB of CSS and
// 12 KB of script in all (the site's own budget for script besides its framework is 150 KB; the hub has no framework).
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { at } from "./lib/paths.mjs";
import { builtPages } from "./lib/visible.mjs";

const gz = (b) => gzipSync(b, { level: 9 }).length;
const read = (p) => readFileSync(at("dist", "." + p));
const bad = [], rows = [];
let shared = 0;
for (const r of builtPages(at("dist"))) {
  const file = r === "/404" ? "/404.html" : (r === "/" ? "" : r) + "/index.html";
  const html = read(file), text = html.toString();
  const refs = [...text.matchAll(/(?:href|src|data-admin)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  const css = refs.filter((x) => x.endsWith(".css")).reduce((n, x) => n + gz(read(x)), 0);
  const js = refs.filter((x) => x.endsWith(".js")).reduce((n, x) => n + gz(read(x)), 0);
  shared = css + js;
  rows.push([r, gz(html), css, js]);
  if (gz(html) > 20480) bad.push(`${r}: HTML ${gz(html)} bytes gzipped, over 20 KB`);
  if (css > 12288) bad.push(`${r}: CSS ${css} bytes gzipped, over 12 KB`);
  if (js > 12288) bad.push(`${r}: script ${js} bytes gzipped, over 12 KB`);
  // The panel's second script (Audit, People, Listings, Health) loads only when one of those tabs opens: its own budget.
  const more = text.match(/data-more="(\/assets\/[^"]+)"/);
  if (more) { const m = gz(read(more[1])); rows.push([`${r} (more tabs)`, 0, 0, m]); if (m > 12288) bad.push(`${r} (more tabs): script ${m} bytes gzipped, over 12 KB`); }
}
const w = Math.max(...rows.map((r) => r[0].length));
console.log(rows.map(([r, h, c, j]) => `  ${r.padEnd(w)}  html ${String(h).padStart(5)}  css ${String(c).padStart(5)}  js ${String(j).padStart(5)}  total ${String(h + c + j).padStart(6)} bytes gzipped`).join("\n"));
if (bad.length) { console.error(`check-size: ${bad.length} over budget\n  ${bad.join("\n  ")}`); process.exit(1); }
console.log(`check-size: ${rows.length} pages inside the budget (shared CSS and script ${shared} bytes gzipped, cached after the first page)`);
