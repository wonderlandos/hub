// SPDX-License-Identifier: GPL-2.0-or-later
// The pictures of the fixture listings (data/index.json): small drawn windows in the WolOS look, captured
// at 1x and 2x (name.png, name@2x.png) with a lossless WebP beside each, as the site keeps its pictures.
// Only for the fixtures; a real listing's screenshots come from its author. Run: npm run fixtures.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./lib/browser.mjs";

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(HERE, "public/img/listings");
const tokens = readFileSync(resolve(HERE, "src/tokens.css"), "utf8");

const css = `${tokens}
html,body{margin:0;background:var(--wol-bg);color:var(--wol-text);font-family:var(--font-sans);font-size:var(--text-sm)}
.win{position:absolute;inset:16px;border-radius:var(--wol-radius-window);background:var(--wol-surface);border:1px solid var(--wol-border);box-shadow:0 18px 40px -18px var(--wol-shadow);overflow:hidden;display:flex;flex-direction:column}
.bar{height:38px;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid var(--wol-border);font-weight:600}
.dot{width:11px;height:11px;border-radius:99px;background:var(--wol-surface-2)}
.grow{flex:1;display:flex;min-height:0}
.side{width:34%;border-right:1px solid var(--wol-border);padding:10px;display:flex;flex-direction:column;gap:6px}
.item{padding:8px 10px;border-radius:var(--wol-radius-md)}
.item b{display:block;font-size:var(--text-sm)} .item span{color:var(--wol-text-2);font-size:var(--text-xs)}
.sel{background:var(--wol-selection)}
.main{flex:1;padding:18px 22px;line-height:1.6}
.main h1{font-size:var(--text-lg);margin:0 0 8px}
.dim{color:var(--wol-text-2)}
.search{margin:2px 0 6px;padding:7px 10px;border-radius:var(--wol-radius-md);background:var(--wol-surface-2)}
mark{background:var(--wol-selection);color:inherit;border-radius:3px;padding:0 2px}
.tile{position:absolute;inset:16px;border-radius:var(--wol-radius-lg);background:var(--wol-surface);border:1px solid var(--wol-border);padding:18px 20px;box-shadow:0 18px 40px -18px var(--wol-shadow)}
.week{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-top:16px;text-align:center}
.day{padding:10px 0;border-radius:var(--wol-radius-md);background:var(--wol-surface-2)}
.sun{width:22px;height:22px;border-radius:99px;margin:6px auto;background:var(--wol-yellow)}
.cloud{width:26px;height:16px;border-radius:99px;margin:9px auto;background:var(--wol-text-2)}
.rain{width:22px;height:22px;border-radius:99px 99px 99px 0;transform:rotate(-45deg);margin:6px auto;background:var(--wol-blue)}
.big{font-size:var(--text-2xl);font-weight:650}
.split{flex:1;display:grid;grid-template-columns:1fr 1fr;min-height:0}
.split>div{padding:16px 20px;line-height:1.6}
.split>div+div{border-left:1px solid var(--wol-border)}
.src{font-family:var(--font-mono);font-size:var(--text-xs);color:var(--wol-text-2)}
.src p{margin:0 0 4px}
.prev h2{font-size:var(--text-lg);margin:0 0 6px} .prev ul{margin:6px 0;padding-left:18px}
`;

const notes = (search) => `<div class="win"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span style="margin-left:8px">Notes</span></div><div class="grow"><div class="side">
${search ? `<div class="search">garden</div>` : ""}
<div class="item sel"><b>Garden plan</b><span>Tomatoes by the fence, herbs in pots</span></div>
<div class="item"><b>${search ? "Saturday" : "Groceries"}</b><span>${search ? "Water the garden first" : "Oats, apples, coffee"}</span></div>
<div class="item"><b>${search ? "Seeds" : "Book club"}</b><span>${search ? "Ask about garden beans" : "Chapter four for Thursday"}</span></div>
${search ? "" : `<div class="item"><b>Ideas</b><span>A shelf for the hallway</span></div>`}
</div><div class="main"><h1>Garden plan</h1><p>Tomatoes by the fence, where the sun stays longest. Basil, mint and thyme in pots by the door.</p><p class="dim">${search ? "Three notes mention <mark>garden</mark>." : "Saved a moment ago"}</p></div></div></div>`;

const weather = `<div class="tile"><div class="dim">Lisbon</div><div class="big">21°</div><div class="dim">Sunny, a light breeze</div><div class="week">
${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => `<div class="day"><div class="dim">${d}</div><div class="${["sun", "sun", "cloud", "rain", "cloud", "sun", "sun"][i]}"></div><div>${[21, 22, 19, 16, 18, 22, 23][i]}°</div></div>`).join("")}
</div></div>`;

const markdown = `<div class="win"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span style="margin-left:8px">Notes</span></div><div class="split"><div class="src"><p># Reading list</p><p>&nbsp;</p><p>Books for the **long** weekend:</p><p>- The quiet garden</p><p>- A year of soup</p><p>- *Maps of small towns*</p></div><div class="prev"><h2>Reading list</h2><p>Books for the <b>long</b> weekend:</p><ul><li>The quiet garden</li><li>A year of soup</li><li><i>Maps of small towns</i></li></ul></div></div></div>`;

const SHOTS = [["notes-list", 720, 450, notes(false)], ["notes-search", 720, 450, notes(true)], ["weather-tile", 520, 240, weather], ["markdown-preview", 720, 400, markdown]];

const b = await launch();
for (const [name, w, h, body] of SHOTS) {
  for (const scale of [1, 2]) {
    const pg = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, colorScheme: "light" })).newPage();
    await pg.setContent(`<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`);
    const png = resolve(OUT, scale === 1 ? `${name}.png` : `${name}@2x.png`);
    await pg.screenshot({ path: png });
    execFileSync("convert", [png, "-define", "webp:lossless=true", "-define", "webp:method=6", "-define", "webp:exact=true", png.replace(/\.png$/, ".webp")]);
    await pg.context().close();
  }
}
await b.close();
console.log(`fixture-shots: ${SHOTS.length} pictures at 1x and 2x, each with a lossless WebP`);
