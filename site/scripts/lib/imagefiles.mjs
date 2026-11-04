// Reading picture files without dependencies: PNG and WebP sizes from their headers, and a walk.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { at } from "./paths.mjs";

/** [width, height] of a PNG (IHDR). */
export function pngSize(file) {
  const b = readFileSync(file);
  if (b.toString("ascii", 1, 4) !== "PNG") throw new Error(`${file}: not a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

/** { w, h, lossless } of a WebP (VP8L lossless, VP8 lossy, VP8X extended with a VP8L/VP8 chunk). */
export function webpInfo(file) {
  const b = readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  let o = 12, w = 0, h = 0, lossless = null;
  while (o + 8 <= b.length) {
    const id = b.toString("ascii", o, o + 4), n = b.readUInt32LE(o + 4), d = o + 8;
    if (id === "VP8X") { w = b.readUIntLE(d + 4, 3) + 1; h = b.readUIntLE(d + 7, 3) + 1; }
    if (id === "VP8L") { const bits = b.readUInt32LE(d + 1); lossless = true; if (!w) { w = (bits & 0x3fff) + 1; h = ((bits >> 14) & 0x3fff) + 1; } }
    if (id === "VP8 ") { lossless = false; if (!w) { w = b.readUInt16LE(d + 6) & 0x3fff; h = b.readUInt16LE(d + 8) & 0x3fff; } }
    if (lossless !== null) break;
    o = d + n + (n & 1);
  }
  return lossless === null ? null : { w, h, lossless };
}

/** Every file under dir (sorted); [] when dir is missing. */
export function walk(dir) {
  const out = [];
  const go = (d) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) go(p); else out.push(p); } };
  try { go(dir); } catch (e) { if (e.code !== "ENOENT") throw e; }
  return out;
}

/**
 * The pictures under public/img and public/store-icons, by URL of the 1x PNG: { w, h } at 1x in CSS
 * pixels, `png` and `webp` as [url, density] lists. A 2x capture is `name@2x.png` beside `name.png`, or
 * a manual capture recorded with scale 2 in public/img/manual/images.json (scripts/manual-images.mjs).
 */
export function manifest() {
  const f = at("public/img/manual/images.json");
  const manual = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).images || {} : {};
  const scaleOf = (u) => (u.startsWith("/img/manual/") && manual[u.slice("/img/manual/".length)]?.scale) || 1;
  const url = (p) => "/" + relative(at("public"), p).split("\\").join("/");
  const images = {};
  for (const png of ["public/img", "public/store-icons"].flatMap((d) => walk(at(d)))) {
    if (!png.endsWith(".png") || png.endsWith("@2x.png")) continue;
    const u = url(png), two = png.replace(/\.png$/, "@2x.png"), [w, h] = pngSize(png), s = scaleOf(u);
    const list = s === 2 ? [[u, 2]] : [[u, 1], ...(existsSync(two) ? [[url(two), 2]] : [])];
    const webp = list.filter(([p]) => existsSync(at("public" + p.replace(/\.png$/, ".webp")))).map(([p, d]) => [p.replace(/\.png$/, ".webp"), d]);
    images[u] = { w: Math.round(w / s), h: Math.round(h / s), png: list, webp: webp.length === list.length ? webp : [] };
  }
  return images;
}
