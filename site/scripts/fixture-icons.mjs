// SPDX-License-Identifier: GPL-2.0-or-later
// Icons for the fixture listings (data/index.json), as a package would carry them: a 128 px PNG each, drawn in
// the WolOS icon colours. Written to data/facts/<sha256> with the reference put on the entry ({sha256, type,
// width, height, size}), the shape the hub's check reads from a real package. Only for the fixtures. Run:
// node scripts/fixture-icons.mjs
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { at } from "./lib/paths.mjs";
import { launch } from "./lib/browser.mjs";

const tokens = readFileSync(at("src/tokens.css"), "utf8");
const ICONS = {
  "org.wolos.notes": ["wolos", "M34 30h60v68H34z M44 46h40 M44 60h40 M44 74h26"],
  "alicedoe.weather": ["web", "M40 82h50a16 16 0 0 0 0-32a22 22 0 0 0-42-4a18 18 0 0 0-8 36z"],
  "examplelabs.markdown-preview": ["dev", "M28 40h72v48H28z M40 76V52l12 14l12-14v24 M80 52v24 M72 68l8 8l8-8"],
  "rivertools.clock": ["files", "M64 28a36 36 0 1 0 0.1 0z M64 44v22l14 10"],
};
const file = at("data/index.json");
const idx = JSON.parse(readFileSync(file, "utf8"));
mkdirSync(at("data/facts"), { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 128, height: 128 }, deviceScaleFactor: 1 });
for (const k of ["apps", "plugins", "extensions"]) for (const e of idx[k]) {
  const d = ICONS[e.id]; if (!d) continue;
  await page.setContent(`<style>${tokens}html,body{margin:0;background:transparent}</style><svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
<rect width="128" height="128" rx="30" fill="var(--wol-icon-${d[0]}-body)"/><path d="${d[1]}" fill="none" stroke="var(--wol-icon-paper)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
  const png = await page.screenshot({ omitBackground: true, type: "png" });
  const sha256 = createHash("sha256").update(png).digest("hex");
  writeFileSync(at("data/facts", sha256), png);
  e.icon = { sha256, type: "image/png", width: 128, height: 128, size: png.length };
}
await browser.close();
writeFileSync(file, JSON.stringify(idx, null, 2) + "\n");
console.log("fixture-icons: done");
