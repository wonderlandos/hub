// SPDX-License-Identifier: GPL-2.0-or-later
// Runs the built wasm in headless Chromium: the 69 replay files and 8 file certificate vectors, the fixture files against the native bytes, one
// signature check timed. Build first: ./build.sh test
// Run: CHROME=/tmp/cw-tools/chrome PLAYWRIGHT=/tmp/cw-tools/node_modules/playwright-core node tests/browser.mjs
import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? "playwright-core");
const T = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".wasm": "application/wasm" };
const page = `<!doctype html><meta charset=utf-8><script type=module>
import init, * as hc from "/pkg-web-test/hubcheck.js";
const get = async (p) => new Uint8Array(await (await fetch(p)).arrayBuffer());
const text = async (p) => (await fetch(p)).text();
const out = { replay: [], same: {}, errors: [] };
try {
  await init();
  const names = await (await fetch("/tests/vectors/")).json();
  const pki = await text("/tests/vectors/pki.json");
  for (const n of names.filter((n) => n !== "pki.json")) out.replay.push([n, hc.replay_vector(pki, await text("/tests/vectors/" + n))]);
  out.filecert = [];
  for (const n of await (await fetch("/tests/vectors/filecert/")).json()) out.filecert.push([n, hc.replay_filecert_vector(await text("/tests/vectors/filecert/" + n))]);
  const store = await text("/fixtures/store.json"), now = Number(await text("/fixtures/now.txt"));
  for (const [f, k] of [["person.wol","app"],["org.wol","app"],["wolos.wol","app"],["unsigned.wol","app"],["namespace.wol","app"],["origin.wol","app"],["listing.wol","app"],["trusted.wol","app"],["weather.wolplug","plugin"]]) {
    const b = await get("/fixtures/" + f);
    out.same[f] = [hc.check(b, k), hc.verify(b, k, store, now), hc.inspect(b, k, store, now)];
  }
  const b = await get("/fixtures/person.wol");
  const ts = [];
  for (let i = 0; i < 11; i++) { const t = performance.now(); hc.verify(b, "app", store, now); ts.push(performance.now() - t); }
  out.first = ts[0]; ts.sort((a, c) => a - c); out.median = ts[5];
  out.ua = navigator.userAgent;
} catch (e) { out.errors.push(String(e && e.stack || e)); }
window.result = out;
</script>`;
const srv = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") { res.writeHead(200, { "content-type": "text/html" }); return res.end(page); }
  if (p === "/tests/vectors/filecert/") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(readdirSync(join(root, "tests/vectors/filecert")).filter((f) => f.endsWith(".json")))); }
  if (p === "/tests/vectors/") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(readdirSync(join(root, "tests/vectors")).filter((f) => f.endsWith(".json")))); }
  const f = resolve(root, "." + p);
  if (!f.startsWith(root) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": T[extname(f)] ?? "application/octet-stream" });
  createReadStream(f).pipe(res);
});
await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/tmp/cw-tools/chrome", args: ["--no-sandbox", "--password-store=basic", "--use-mock-keychain"] });
const pg = await browser.newPage();
const consoleErrors = [];
pg.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
await pg.goto(`http://127.0.0.1:${srv.address().port}/`);
await pg.waitForFunction("window.result", null, { timeout: 60000 });
const r = await pg.evaluate("window.result");
await browser.close();
srv.close();

assert.deepEqual(r.errors, []);
assert.equal(r.replay.length, 68);
for (const [n, why] of r.replay) assert.equal(why, "", `${n}: ${why}`);
console.log("ok - 69 replay files (pki.json and 68 vectors) replay to their recorded results in headless Chromium");
assert.equal(r.filecert.length, 8);
for (const [n, why] of r.filecert) assert.equal(why, "", `${n}: ${why}`);
console.log("ok - 8 file certificate vectors replay in headless Chromium");
const bin = join(root, "target/release/hubcheck"), store = join(root, "fixtures/store.json"), now = readFileSync(join(root, "fixtures/now.txt"), "utf8");
for (const [f, [c, v, i]] of Object.entries(r.same)) {
  const k = f.endsWith(".wolplug") ? "plugin" : "app", p = join(root, "fixtures", f);
  const nat = (...a) => execFileSync(bin, a, { encoding: "utf8" }).trimEnd();
  assert.equal(c, nat("check", k, p));
  assert.equal(v, nat("verify", k, p, "--store", store, "--now", now));
  assert.equal(i, nat("inspect", k, p, "--store", store, "--now", now));
}
console.log(`ok - check, verify and inspect of ${Object.keys(r.same).length} files print the native bytes`);
assert.deepEqual(consoleErrors, []);
console.log(`timing - verify of a signed .wol in ${r.ua.match(/Chrome\/[\d.]+/)?.[0] ?? "Chromium"}: first ${r.first.toFixed(1)} ms, median of 11 ${r.median.toFixed(1)} ms`);
