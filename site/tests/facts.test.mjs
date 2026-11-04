// SPDX-License-Identifier: GPL-2.0-or-later
// lib/facts.mjs: package pictures named by the index in either shape, the old {sha256, type, width, height, size}
// and the Worker's {sha256, mime, w, h, size, file} (hub-worker listings.ts pictureView), checked and copied to dist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { facts } from "../scripts/lib/facts.mjs";

/** A PNG header that sizeOf reads as w x h (the bytes need not decode). */
const png = (w, h, salt) => {
  const b = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  b.write(salt, 30, "latin1");
  return b;
};
const sha = (b) => createHash("sha256").update(b).digest("hex");

function setup(name) {
  const root = mkdtempSync(join(tmpdir(), "hub-facts-"));
  const dir = join(root, "facts"), dist = join(root, "dist");
  mkdirSync(dir);
  mkdirSync(dist);
  process.env.FACTS_DIR = dir;
  delete process.env.FACTS_BASE;
  return { dir, dist, put: (b, file) => writeFileSync(join(dir, file ?? sha(b)), b), name };
}

test("the Worker's shape {sha256, mime, w, h, size, file}: icon and screenshots are placed, named as the CDN names them", async () => {
  const { dir, dist, put } = setup();
  const icon = png(256, 256, "icon"), shot = png(1280, 800, "shot");
  put(icon);
  put(shot, `${sha(shot)}.png`); // a folder that holds the CDN's own file names works too
  const view = (b, w, h) => ({ sha256: sha(b), mime: "image/png", w, h, size: b.length, file: `${sha(b)}.png` });
  const e = { id: "alice.notes", name: "Notes", icon: view(icon, 256, 256), screenshots: [view(shot, 1280, 800)] };
  const warnings = await facts(dist).prepare([e]);
  assert.deepEqual(warnings, []);
  assert.equal(e.iconUrl, `/img/p/${sha(icon)}.png`);
  assert.deepEqual(e.shotRefs, [{ url: `/img/p/${sha(shot)}.png`, w: 1280, h: 800, alt: "Notes, picture 1" }]);
  assert.ok(existsSync(join(dist, "img/p", `${sha(icon)}.png`)) && existsSync(join(dist, "img/p", `${sha(shot)}.png`)));
  assert.ok(dir);
});

test("the old shape {sha256, type, width, height} still works", async () => {
  const { dist, put } = setup();
  const icon = png(128, 128, "old");
  put(icon);
  const e = { id: "bob.tool", name: "Tool", icon: { sha256: sha(icon), type: "image/png", width: 128, height: 128, size: icon.length } };
  assert.deepEqual(await facts(dist).prepare([e]), []);
  assert.equal(e.iconUrl, `/img/p/${sha(icon)}.png`);
});

test("a Worker reference whose pixel size, type or file name lies is left out with a warning", async () => {
  const { dist, put } = setup();
  const b = png(64, 64, "lie");
  put(b);
  const good = { sha256: sha(b), mime: "image/png", w: 64, h: 64, size: b.length, file: `${sha(b)}.png` };
  for (const [what, ref] of [["size", { ...good, w: 65 }], ["type", { ...good, mime: "image/webp", file: `${sha(b)}.webp` }], ["file", { ...good, file: `${sha(b)}.webp` }], ["unknown type", { ...good, mime: "image/gif" }]]) {
    const e = { id: "eve.lies", name: "Lies", icon: ref };
    const warnings = await facts(dist).prepare([e]);
    assert.equal(e.iconUrl, null, what);
    assert.equal(warnings.length, 1, what);
  }
});

test("FACTS_BASE: a Worker reference is fetched by its CDN file name, an old one by its sha256", async () => {
  const { dist } = setup();
  const a = png(32, 32, "cdn-a"), b = png(48, 48, "cdn-b");
  const served = { [`${sha(a)}.png`]: a, [sha(b)]: b }, asked = [];
  process.env.FACTS_BASE = "https://cdn.wolos.org/plugins/pictures/";
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    asked.push(url);
    const body = served[url.split("/").pop()];
    return { ok: !!body, arrayBuffer: async () => body };
  };
  try {
    const e1 = { id: "a.b", name: "A", icon: { sha256: sha(a), mime: "image/png", w: 32, h: 32, size: a.length, file: `${sha(a)}.png` } };
    const e2 = { id: "c.d", name: "C", icon: { sha256: sha(b), type: "image/png", width: 48, height: 48, size: b.length } };
    assert.deepEqual(await facts(dist).prepare([e1, e2]), []);
    assert.deepEqual(asked, [`https://cdn.wolos.org/plugins/pictures/${sha(a)}.png`, `https://cdn.wolos.org/plugins/pictures/${sha(b)}`]);
    assert.ok(e1.iconUrl && e2.iconUrl);
  } finally {
    globalThis.fetch = real;
    delete process.env.FACTS_BASE;
  }
});
