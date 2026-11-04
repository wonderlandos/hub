// SPDX-License-Identifier: GPL-2.0-or-later
// Headless Chromium proof of the built hub (run `npm run build` first): serves dist/ with a stand-in for the
// Worker, then, at 1280 and 480 pixels wide, light and dark:
//   - screenshots of the home page, a listing, a maker page, the publish page and a report;
//   - no horizontal scroll, no console errors, no failed requests;
//   - the keyboard alone: every control is reachable by Tab, "/" finds search, a picture opens in the viewer with
//     Enter, moves with the arrow keys, closes with Esc and gives the focus back;
//   - signed out and signed in (GET /api/me), the CLA, linking a repository and sending a report, by keyboard.
// Output: PROOF_OUT (default ../../../.claude/tmp/hub-site relative to the repository root of the WolOS checkout).
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { at } from "./lib/paths.mjs";
import { launch, serve } from "./lib/browser.mjs";

const OUT = resolve(process.env.PROOF_OUT || "/home/ubuntu/wolos/.claude/tmp/hub-site");
mkdirSync(OUT, { recursive: true });

/* The Worker, as HUB-worker froze it: GET /api/me, GET|POST /api/cla, POST /api/orgs, POST /api/listings, POST /api/reports. */
const state = { in: false, cla: false, posts: [] };
const CLA = { version: "0-test", text: "The contributor agreement, version 0-test.\n\nYou keep your work. You let the hub list it.", sha256: "ab".repeat(32) };
const me = () => ({ github_id: 5310001, login: "alicedoe", name: "Alice Doe", avatar: null, role: "member", cla: { current: CLA.version, accepted: state.cla ? CLA.version : null, accepted_at: 1, ok: state.cla },
  orgs: [{ github_org_id: 9910002, login: "examplelabs", role: "owner", linked: false, cla: null }] });
const api = (req, res, url) => {
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = data ? JSON.parse(data) : null;
    if (req.method === "POST") { state.posts.push([url.pathname, body, req.headers.origin]); }
    const p = url.pathname;
    if (p === "/api/me") return state.in ? send(200, me()) : send(401, { error: "signed-out", sentence: "Sign in first." });
    if (p === "/api/cla" && req.method === "GET") return send(200, CLA);
    if (p === "/api/cla") { if (body.sha256 !== CLA.sha256) return send(409, { error: "cla-changed", sentence: "The contributor agreement changed. Read the current version and accept it again." }); state.cla = true; return send(200, { cla: me().cla }); }
    if (p === "/api/orgs") return send(201, { org: {} });
    if (p === "/api/listings") { if (body.id !== "alicedoe.notes") return send(403, { error: "wrong-namespace", sentence: "Ids you publish as alicedoe start with alicedoe." }); return send(201, { id: body.id, name: body.name, source: { repo: body.repo } }); }
    if (p === "/api/reports") return send(201, { report: { id: 42 } });
    if (p === "/auth/logout") { state.in = false; return send(200, { signed_in: false }); }
    send(404, { error: "not-found", sentence: "There is nothing at this address." });
  });
};

const results = [];
const ok = (name, pass, detail = "") => { results.push([name, pass, detail]); console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`); };

const srv = await serve(at("dist"), api);
const browser = await launch();
const problems = [];
async function open(scheme, w, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/status of 40[134]|409/.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`failed: ${r.url()}`));
  return { ctx, page };
}
const noScroll = async (page, label) => {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, wide: [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(e).position !== "fixed" && !e.closest(".sr,.skip,pre"); }).slice(0, 3).map((e) => e.tagName + "." + e.className) }));
  ok(`${label}: no horizontal scroll`, o.sw <= o.iw && !o.wide.length, o.sw > o.iw || o.wide.length ? JSON.stringify(o) : "");
};

/* 1. Screenshots: home, a listing, a maker page, publish (signed in), report. */
const SHOTS = [["home", "/"], ["listing-plugin", "/plugins/alicedoe.weather"], ["listing-app", "/apps/org.wolos.notes"], ["listing-flagged", "/extensions/examplelabs.markdown-preview"], ["author", "/authors/alicedoe"], ["org", "/orgs/examplelabs"], ["apps", "/apps"], ["search", "/search?q=notes"], ["publish", "/publish"], ["report", "/report?listing=alicedoe.weather&version=2.1.0"]];
for (const scheme of ["light", "dark"]) for (const w of [1280, 480]) {
  const { ctx, page } = await open(scheme, w);
  for (const [name, path] of SHOTS) {
    state.in = name === "publish" || name === "report"; state.cla = name === "report";
    await page.goto(srv.base + path, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "*{animation:none!important;transition:none!important}" });
    if (name === "publish") await page.waitForSelector("#listing-form", { state: "hidden" }).catch(() => {});
    await page.waitForTimeout(150);
    await noScroll(page, `${name} ${w} ${scheme}`);
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    if (name === "home") ok(`${scheme}: page background follows the scheme`, scheme === "dark" ? bg === "rgb(25, 23, 32)" : bg === "rgb(243, 241, 248)", bg);
    if (["home", "listing-plugin", "listing-flagged", "author", "publish", "report", "search"].includes(name) || w === 1280) await page.screenshot({ path: `${OUT}/${name}-${w}-${scheme}.png`, fullPage: true });
  }
  await ctx.close();
}

/* 2. The keyboard alone. */
{
  const { ctx, page } = await open("light", 1280);
  state.in = false;
  await page.goto(srv.base + "/", { waitUntil: "networkidle" });
  const want = await page.evaluate(() => [...document.querySelectorAll("a[href],button,input,select,textarea,[tabindex='0']")].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return cs.visibility !== "hidden" && (r.width > 0 || e.classList.contains("stretch")); }).length);
  const reached = await (async () => { await page.goto(srv.base + "/", { waitUntil: "networkidle" }); const set = new Set(); for (let i = 0; i < want + 3; i++) { await page.keyboard.press("Tab"); set.add(await page.evaluate(() => { const a = document.activeElement; return a?.outerHTML?.slice(0, 80) + "@" + (a?.getBoundingClientRect().x | 0) + "," + (a?.getBoundingClientRect().y | 0); })); } return set.size; })();
  ok("home: Tab reaches every control", reached >= want - 1, `${reached} stops for ${want} controls`);
  await page.goto(srv.base + "/", { waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  ok("home: the first stop is the skip link", await page.evaluate(() => document.activeElement.className === "skip"));
  await page.keyboard.press("Enter");
  ok("home: the skip link moves into the content", await page.evaluate(() => location.hash === "#main"));

  await page.goto(srv.base + "/", { waitUntil: "networkidle" });
  await page.keyboard.press("/");
  ok('"/" focuses search', await page.evaluate(() => document.activeElement.id === "q"));
  await page.keyboard.type("weather");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/search\?q=weather/);
  await page.waitForSelector("#results li");
  ok("search by keyboard finds the weather tile", (await page.locator("#results li").count()) === 1 && /1 result/.test(await page.textContent("#count")));
  await page.fill("#q", "alice");
  ok("search by maker", (await page.locator("#results li").count()) === 1);
  await page.fill("#q", "zzzz");
  ok("search with no match says so", /Nothing matches/.test(await page.textContent("#count")));

  await page.goto(srv.base + "/apps/org.wolos.notes", { waitUntil: "networkidle" });
  await page.focus("a.pic");
  await page.keyboard.press("Enter");
  ok("picture opens in the viewer with Enter", await page.evaluate(() => document.querySelector("dialog.lightbox")?.open === true));
  const cap1 = await page.textContent("dialog.lightbox figcaption");
  await page.keyboard.press("ArrowRight");
  const cap2 = await page.textContent("dialog.lightbox figcaption");
  ok("arrow keys move between pictures", cap1 !== cap2, `${cap1.slice(0, 30)} -> ${cap2.slice(0, 30)}`);
  await page.waitForFunction(() => { const i = document.querySelector("dialog.lightbox img"); return i && i.complete && i.naturalWidth > 0; });
  const img = await page.evaluate(() => { const i = document.querySelector("dialog.lightbox img"); return { w: i.getBoundingClientRect().width, nat: i.naturalWidth, src: i.currentSrc }; });
  ok("the viewer shows the 2x file, at one file pixel per screen pixel at most", img.nat >= 1440 && img.w <= img.nat + 0.5, JSON.stringify(img));
  await page.keyboard.press("Escape");
  ok("Esc closes the viewer", await page.evaluate(() => !document.querySelector("dialog.lightbox").open));
  ok("the focus goes back to the picture", await page.evaluate(() => document.activeElement.matches("a.pic")));

  await page.click('#theme button[data-theme="dark"]');
  ok("the look switch picks dark and keeps it", await page.evaluate(() => document.documentElement.dataset.theme === "dark" && localStorage.getItem("theme") === "dark"));
  await page.screenshot({ path: `${OUT}/listing-app-1280-switch-dark.png`, fullPage: true });
  await page.click('#theme button[data-theme="auto"]');
  ok("Auto gives the choice back to the system", await page.evaluate(() => !document.documentElement.dataset.theme && !localStorage.getItem("theme")));

  // Signed out, a page offers sign-in and returns here.
  ok("signed out: the header offers Sign in and comes back to the page", await page.evaluate(() => /\/auth\/login\?next=%2Fapps%2Forg\.wolos\.notes/.test(document.querySelector("#who a").getAttribute("href"))));

  // Signed in: the header, the CLA, linking a repository.
  state.in = true; state.cla = false; state.posts.length = 0;
  await page.goto(srv.base + "/publish", { waitUntil: "networkidle" });
  ok("signed in: the header shows the name and Sign out", (await page.textContent("#who")).includes("Alice Doe") && (await page.textContent("#who")).includes("Sign out"));
  ok("signed in: the agreement is shown, the form is not", (await page.isVisible("#cla-form")) && !(await page.isVisible("#listing-form")) && (await page.textContent("#cla-text")).includes("contributor agreement"));
  await page.focus('#cla-form input[name="agree"]'); await page.keyboard.press("Space"); await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  await page.waitForSelector("#listing-form", { state: "visible" });
  ok("accepting the agreement by keyboard shows the link form", state.cla && state.posts.some(([p, b, o]) => p === "/api/cla" && b.version === "0-test" && b.sha256 === CLA.sha256 && o === srv.base));
  ok("the organisation you own can be linked", /Link examplelabs/.test(await page.textContent("#org-list")));
  await page.selectOption("#f-kind", "extension");
  ok("an extension asks for its host app", await page.isVisible("#f-host"));
  await page.selectOption("#f-kind", "app");
  await page.fill("#f-id", "wrong.id"); await page.fill("#f-name", "Notes"); await page.fill("#f-summary", "Quick notes."); await page.fill("#f-license", "MIT"); await page.fill("#f-repo", "alicedoe/notes"); await page.fill("#f-asset", "alicedoe.notes-*.wol");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#listing-form [data-err]").textContent.length > 0);
  ok("a refusal shows the Worker's own sentence", /start with alicedoe/.test(await page.textContent("#listing-form [data-err]")));
  await page.fill("#f-id", "alicedoe.notes");
  await page.focus("#f-asset"); await page.keyboard.press("Enter");
  await page.waitForSelector('[data-when~="linked"]', { state: "visible" });
  ok("linking a repository confirms in words", /Notes is linked to alicedoe\/notes/.test(await page.textContent('[data-when~="linked"]')));
  await page.screenshot({ path: `${OUT}/publish-linked-1280-light.png`, fullPage: true });

  // A report, by keyboard, from a listing's link.
  state.posts.length = 0;
  await page.goto(srv.base + "/plugins/alicedoe.weather", { waitUntil: "networkidle" });
  await page.click('aside a[href^="/report?listing="]');
  await page.waitForSelector("#report-form", { state: "visible" });
  ok("the report form knows the listing", (await page.inputValue("#r-listing")) === "alicedoe.weather");
  await page.focus('input[name="reason"]'); await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
  await page.fill("#r-text", "It does not show the forecast.");
  await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  await page.waitForSelector("#report-done", { state: "visible" });
  const rp = state.posts.find(([p]) => p === "/api/reports");
  ok("a report is sent with the worker's field names", rp && rp[1].listing_id === "alicedoe.weather" && rp[1].reason === "broken" && /forecast/.test(rp[1].text), JSON.stringify(rp?.[1]));
  ok("the thanks names the report number", /number 42/.test(await page.textContent("#report-done")));

  // Sign out.
  await page.goto(srv.base + "/", { waitUntil: "networkidle" });
  await page.focus("#who button");
  await Promise.all([page.waitForNavigation(), page.keyboard.press("Enter")]);
  await page.waitForLoadState("networkidle");
  ok("Sign out returns to the signed-out header", await page.evaluate(() => !!document.querySelector("#who a[href^='/auth/login']")));

  // Sign-in trouble.
  await page.goto(srv.base + "/signin?error=denied", { waitUntil: "networkidle" });
  ok("a cancelled sign-in is explained", /cancelled/.test(await page.textContent("#signin-msg")));
  await ctx.close();
}
await browser.close();
srv.close();
ok("no console errors, page errors or failed requests", problems.length === 0, problems.slice(0, 5).join(" | "));
writeFileSync(`${OUT}/proof.txt`, results.map(([n, p, d]) => `${p ? "ok  " : "FAIL"} ${n}${d ? "  " + d : ""}`).join("\n") + "\n");
const failed = results.filter((r) => !r[1]);
console.log(`proof: ${results.length - failed.length} of ${results.length} checks passed; screenshots in ${OUT}`);
process.exit(failed.length ? 1 : 0);
