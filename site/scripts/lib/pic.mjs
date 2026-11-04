// SPDX-License-Identifier: GPL-2.0-or-later
// One way to show a picture (UX rule 9), the same markup as the WolOS site: sized at its natural 1x width and
// never wider (an inline max-width), a 2x srcset, lossless WebP first with the PNG as the fallback, inside a
// link to the largest file so a click opens the lightbox (src/hub.js) and, without scripts, the picture itself.
import { esc } from "./html.mjs";

export function picParts(images, src) {
  const m = images[src];
  if (!m) return null;
  const set = (list) => list.map(([u, d]) => `${u} ${d}x`).join(", ");
  const top = m.png[m.png.length - 1], topWebp = m.webp[m.webp.length - 1];
  return {
    w: m.w, h: m.h, src: m.png[0][0],
    srcset: m.png.length > 1 || m.png[0][1] !== 1 ? set(m.png) : undefined,
    webp: m.webp.length ? set(m.webp) : undefined,
    full: top[0], fullWebp: topWebp?.[0], fw: m.w * top[1], fh: m.h * top[1],
  };
}

/** The picture as HTML; `alt` is plain text. An unknown src fails the build. */
export function picHtml(images, src, alt, { zoom = true, eager = false } = {}) {
  const p = picParts(images, src);
  if (!p) throw new Error(`pic: ${src} is not in public/img (a PNG with its WebP, and name@2x.png at twice the size)`);
  const img = `<img src="${esc(p.src)}"${p.srcset ? ` srcset="${esc(p.srcset)}"` : ""} width="${p.w}" height="${p.h}" alt="${esc(alt)}" loading="${eager ? "eager" : "lazy"}" decoding="async" style="max-width:${p.w}px">`;
  const pic = `<picture>${p.webp ? `<source type="image/webp" srcset="${esc(p.webp)}">` : ""}${img}</picture>`;
  if (!zoom) return pic;
  return `<a class="pic" href="${esc(p.full)}" data-lightbox="" data-webp="${esc(p.fullWebp || "")}" data-w="${p.w}" data-fw="${p.fw}" data-fh="${p.fh}">${pic}</a>`;
}
