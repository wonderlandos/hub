// SPDX-License-Identifier: GPL-2.0-or-later
// Pictures that come from the package itself (its icon and screenshots, read from the file by the hub's
// check): the index names each by {sha256, type, width, height, size}. The build copies the bytes into
// dist/img/p/<sha256>.<png|webp> so the page shows them from its own address, after checking the hash,
// the type and the size the index gave. Bytes come from FACTS_DIR (a folder of <sha256> files, default
// data/facts) or FACTS_BASE (an https address the bytes sit under by sha256). A picture that is missing
// or does not match is left out and the build says so; it never fails a listing.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { at } from "./paths.mjs";

const EXT = { "image/png": "png", "image/webp": "webp" };
const HEX = /^[0-9a-f]{64}$/;

/** [w, h] from PNG or WebP header bytes, else null. */
export function sizeOf(b) {
  if (b.length > 24 && b.toString("ascii", 1, 4) === "PNG") return ["image/png", b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const id = b.toString("ascii", 12, 16), d = 20;
    if (id === "VP8X") return ["image/webp", b.readUIntLE(d + 4, 3) + 1, b.readUIntLE(d + 7, 3) + 1];
    if (id === "VP8L") { const v = b.readUInt32LE(d + 1); return ["image/webp", (v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
    if (id === "VP8 ") return ["image/webp", b.readUInt16LE(d + 6) & 0x3fff, b.readUInt16LE(d + 8) & 0x3fff];
  }
  return null;
}

export function facts(dist) {
  const dir = process.env.FACTS_DIR || at("data/facts"), base = process.env.FACTS_BASE;
  const out = resolve(dist, "img/p");
  const seen = new Map(), warnings = [];
  const bytes = async (h) => {
    const f = resolve(dir, h);
    if (existsSync(f)) return readFileSync(f);
    if (base && /^https:\/\//.test(base)) { const r = await fetch(`${base.replace(/\/$/, "")}/${h}`); if (r.ok) return Buffer.from(await r.arrayBuffer()); }
    return null;
  };
  /** The picture's address on the hub, or null. */
  async function place(ref, where) {
    if (!ref || !HEX.test(ref.sha256 || "") || !EXT[ref.type]) { warnings.push(`${where}: not a picture reference`); return null; }
    if (seen.has(ref.sha256)) return seen.get(ref.sha256);
    const b = await bytes(ref.sha256);
    let url = null;
    if (!b) warnings.push(`${where}: ${ref.sha256} not found`);
    else if (createHash("sha256").update(b).digest("hex") !== ref.sha256) warnings.push(`${where}: ${ref.sha256} has other bytes`);
    else {
      const s = sizeOf(b);
      if (!s || s[0] !== ref.type || s[1] !== ref.width || s[2] !== ref.height) warnings.push(`${where}: ${ref.sha256} is not a ${ref.type} of ${ref.width}x${ref.height}`);
      else { mkdirSync(out, { recursive: true }); url = `/img/p/${ref.sha256}.${EXT[ref.type]}`; writeFileSync(resolve(dist, "." + url), b); }
    }
    seen.set(ref.sha256, url);
    return url;
  }
  /** Fills e.iconUrl and each screenshot's url for every entry. */
  async function prepare(entries) {
    for (const e of entries) {
      e.iconUrl = e.icon ? await place(e.icon, `${e.id} icon`) : null;
      e.shotRefs = [];
      for (const [i, s] of (e.screenshots || []).entries()) {
        if (s.src) { e.shotRefs.push({ legacy: true, src: s.src, alt: s.alt }); continue; }
        const url = await place(s, `${e.id} screenshot ${i + 1}`);
        if (url) e.shotRefs.push({ url, w: s.width, h: s.height, alt: s.alt || s.caption || `${e.name}, picture ${i + 1}` });
      }
    }
    return warnings;
  }
  return { prepare };
}
