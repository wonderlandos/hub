// SPDX-License-Identifier: GPL-2.0-or-later
// Pictures are sharp (UX rule 9), the WolOS site's check-images adapted. After the build, in every page of dist/:
//   - every <img> has width and height;
//   - a raster picture is never shown wider than its natural width at 1x (width attribute and an inline
//     max-width of at most that), with no min-width class;
//   - it sits in a <picture> whose lossless WebP source exists, with a 2x srcset when a 2x file exists;
//   - every file named in src or srcset exists in dist/.
// On disk: every PNG under public/img has a lossless WebP of the same size, an @2x file is exactly twice its
// 1x file, no JPEG anywhere.
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { at } from "./lib/paths.mjs";
import { manifest, pngSize, webpInfo, walk } from "./lib/imagefiles.mjs";

const dist = at("dist");
const images = manifest();
const pages = walk(dist).filter((f) => f.endsWith(".html"));
const bad = [];
const RASTER = /\.(png|webp|gif|jpe?g)$/i;
const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`, "i").exec(tag)?.[1];
const files = (srcset) => (srcset || "").split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);
const inDist = (u) => existsSync(join(dist, decodeURIComponent(u.split(/[?#]/)[0])));
let imgs = 0, pictures = 0;

for (const f of pages) {
  const path = "/" + relative(dist, f).replace(/(^|\/)index\.html$/, "");
  const html = readFileSync(f, "utf8").replace(/<script\b[\s\S]*?<\/script>/g, "");
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    imgs++;
    const tag = m[0], src = attr(tag, "src") || "";
    const where = `${path}: <img src="${src}">`;
    const w = Number(attr(tag, "width")), h = Number(attr(tag, "height"));
    if (!(w > 0) || !(h > 0)) bad.push(`${where} has no width/height`);
    for (const u of [src, ...files(attr(tag, "srcset"))]) if (u.startsWith("/") && !inDist(u)) bad.push(`${where}: ${u} is not in dist/`);
    if (/\.jpe?g$/i.test(src)) bad.push(`${where}: a JPEG picture`);
    if (!RASTER.test(src) || !src.startsWith("/")) continue;
    pictures++;
    const meta = images[src];
    if (!meta) { bad.push(`${where}: not found under public/img`); continue; }
    if (w > meta.w) bad.push(`${where}: width ${w} is above its natural ${meta.w}`);
    const max = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(attr(tag, "style") || "");
    if (!max) bad.push(`${where}: no inline max-width, so CSS can show it above its natural ${meta.w}px`);
    else if (Number(max[1]) > meta.w) bad.push(`${where}: max-width ${max[1]}px is above its natural ${meta.w}px`);
    if (/(^|\s)(min-w-|min-width)/.test(attr(tag, "class") || "")) bad.push(`${where}: a min-width class can stretch it`);
    if (meta.png.some(([, d]) => d === 2) && !/\s2x\b/.test(attr(tag, "srcset") || "")) bad.push(`${where}: has a 2x file but no 2x srcset`);
    const before = html.slice(Math.max(0, m.index - 2000), m.index);
    const open = before.lastIndexOf("<picture"), close = before.lastIndexOf("</picture>");
    const pic = open > close ? before.slice(open) : "";
    const webp = /<source\b[^>]*type="image\/webp"[^>]*>/.exec(pic)?.[0];
    if (!webp) bad.push(`${where}: no <picture> with a WebP <source>`);
    else for (const u of files(attr(webp, "srcset"))) if (!inDist(u)) bad.push(`${where}: WebP ${u} is not in dist/`);
    // The link around the picture opens the lightbox on the largest file.
    if (!/<a class="pic" href="[^"]+" data-lightbox=""[^>]*>$/.test(before.slice(0, open))) bad.push(`${where}: not in a lightbox link`);
  }
}
let pngs = 0, twox = 0;
for (const p of walk(at("public/img"))) {
  const rel = "/" + relative(at("public"), p);
  if (/\.jpe?g$/i.test(p)) bad.push(`${rel}: JPEG (pictures are PNG + lossless WebP)`);
  if (!p.endsWith(".png")) continue;
  pngs++;
  const [w, h] = pngSize(p), wp = p.replace(/\.png$/, ".webp");
  if (!existsSync(wp)) bad.push(`${rel}: no WebP beside it`);
  else { const i = webpInfo(wp); if (!i?.lossless) bad.push(`${rel.replace(/\.png$/, ".webp")}: not lossless`); else if (i.w !== w || i.h !== h) bad.push(`${rel.replace(/\.png$/, ".webp")}: ${i.w}x${i.h}, the PNG is ${w}x${h}`); }
  const one = p.replace(/@2x\.png$/, ".png");
  if (one !== p) { twox++; if (!existsSync(one)) bad.push(`${rel}: an @2x file without its 1x file`); else { const [w1, h1] = pngSize(one); if (w !== 2 * w1 || h !== 2 * h1) bad.push(`${rel}: ${w}x${h} is not twice ${w1}x${h1}`); } }
}
if (bad.length) { console.error(`check-images: ${bad.length} problems\n  ${bad.slice(0, 100).join("\n  ")}`); process.exit(1); }
console.log(`check-images: ${pages.length} pages, ${imgs} <img> with sizes, ${pictures} pictures never above 1x, each with WebP and a 2x srcset; ${pngs} PNGs (${twox} at @2x) each with a lossless WebP, no JPEG`);
