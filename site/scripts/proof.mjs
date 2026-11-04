// SPDX-License-Identifier: GPL-2.0-or-later
// Headless Chromium proof of the built hub (run `npm run build` first): serves dist/ with a stand-in for the
// Worker (the routes and shapes HUB-worker-3 posted, chat 7352), then, at 1280 and 480 pixels wide, light and dark:
//   - screenshots of the store (home, kinds, a category, listings of all three kinds, version pages with the
//     statement), makers, search, the publishing steps, the dashboard of a person and an organisation, a
//     report and the closed admin panel (queue, a confirmation sheet, look up, roles, audit trail);
//   - the trust row in the lead's exact words for each level; the offline check downloads the statement;
//   - no horizontal scroll, no console errors, no failed requests;
//   - the keyboard alone: every control is reachable by Tab, "/" finds search, a picture opens in the viewer with
//     Enter, moves with the arrow keys, closes with Esc and gives the focus back;
//   - signed out and signed in (GET /api/me), the agreements, linking a repository, asking for a certificate,
//     per-version status on the dashboard, sending a report, by keyboard;
//   - the admin page renders nothing and loads no panel without a role; with one, every action needs a reason
//     and a confirmation and sends the Worker's field names.
// Output: PROOF_OUT (default /home/ubuntu/wolos/.claude/tmp/hub-site3).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { at } from "./lib/paths.mjs";
import { launch, serve } from "./lib/browser.mjs";

const OUT = resolve(process.env.PROOF_OUT || "/home/ubuntu/wolos/.claude/tmp/hub-site3");
mkdirSync(OUT, { recursive: true });

/* The Worker, as HUB-worker-2/-3 froze it (chat 7303, 7352). */
const state = { in: false, cla: false, pub: false, role: null, posts: [], reqs: [] };
const TEXT = (doc) => ({ doc, version: "0-test", text: `The ${doc} text, version 0-test.\n\nYou keep your work. You let the hub list it.`, sha256: (doc === "cla" ? "ab" : doc === "publisher" ? "cd" : "ef").repeat(32) });
const st = (ok) => ({ current: "0-test", accepted: ok ? "0-test" : null, accepted_at: ok ? 1 : null, ok });
const me = () => ({ github_id: 5310001, login: "alicedoe", name: "Alice Doe", avatar: null, role: "member", admin: !!state.role, ...(state.role ? { admin_role: state.role } : {}), two_factor: true,
  cla: st(state.cla), terms: { publisher: st(state.pub), trust: st(false) }, certs: { origin: "issued", trusted: state.reqs.length ? "pending" : "none" },
  orgs: [{ github_org_id: 9910002, login: "examplelabs", role: "owner", linked: false, cla: null }] });
const LISTING = { id: "alicedoe.weather", kind: "plugin", name: "Weather", summary: "x", status: "listed", owner: { kind: "person", github_id: 5310001, login: "alicedoe" }, source: { repo: "alicedoe/weather-tile" },
  releases: [{ version: "2.2.0", verdict: "pending", first_seen: 1793900000 }, { version: "2.1.1", verdict: "block", findings: [{ rule: "net", sentence: "It reaches an address its manifest does not name." }], first_seen: 1793800000 },
    { version: "2.1.0", verdict: "pass", first_seen: 1793577600 }, { version: "2.0.3", verdict: "pass", yanked: true, first_seen: 1790985600 }] };
const QUEUE = () => ({ role: state.role,
  ...(state.role !== "support" ? { requests: [{ id: "r1", kind: "person", tier: "trusted", subject: { github_id: 1, login: "bobdev", name: "Bob Dev" }, namespaces: ["bobdev."], key_id: "k1", encryption: true, status: "pending", created_at: 1793800000 }] } : {}),
  ...(state.role !== "reviewer" ? { reports: [{ id: 7, listing: { id: "examplelabs.markdown-preview", name: "Markdown Preview", status: "listed" }, version: "0.9.1", reporter: 3, reason: "broken", text: "It shows nothing.", created_at: 1793800000 }] } : {}),
  ...(/owner|admin/.test(state.role) ? { revocations: [{ id: "v1", group: "g1", serial: "a1000000000000c7", action: "revoke", reason: "abuse", note: "spam", status: "pending", approved_by: ["kleeedolinux"], created_at: 1793800000 }] } : {}) });
const api = (req, res, url) => {
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    const body = data ? JSON.parse(data) : null;
    if (req.method === "POST") { state.posts.push([url.pathname, body, req.headers.origin]); }
    const p = url.pathname, get = req.method === "GET";
    const nope = () => send(404, { error: "not-found", sentence: "There is nothing at this address." });
    if (p === "/api/me") return state.in ? send(200, me()) : send(401, { error: "signed-out", sentence: "Sign in first." });
    let m = /^\/api\/terms\/(cla|publisher|trust)$/.exec(p);
    if (m && get) return send(200, TEXT(m[1]));
    if (m) { if (body.sha256 !== TEXT(m[1]).sha256) return send(409, { error: "terms-changed", sentence: "The text changed. Read the current version and accept it again." }); if (m[1] === "cla") state.cla = true; if (m[1] === "publisher") state.pub = true; return send(200, {}); }
    if (p === "/api/cert/requests") return send(200, { requests: state.reqs });
    if (p === "/api/certs/alicedoe" || p === "/api/certs/bobdev") return send(200, { login: p.split("/").pop(), certs: [{ serial: "a1000000000000c7", tier: "origin", kind: "person", login: "alicedoe", issued_at: 1793000000, revoked_at: null }] });
    if (p.startsWith("/api/certs/")) return send(200, { login: p.split("/").pop(), certs: [] });
    if (p === "/api/cert/request") { state.reqs.push({ id: "q2", tier: body.tier, status: "pending", subject: { login: "alicedoe" } }); return send(201, { request: {}, auto: body.tier === "origin", sentence: "Sent." }); }
    if (p === "/api/orgs") return send(201, { org: {} });
    if (p === "/api/listings/alicedoe.weather" && get) return send(200, LISTING);
    if (p === "/api/listings") { if (body.id !== "alicedoe.notes") return send(403, { error: "wrong-namespace", sentence: "Ids you publish as alicedoe start with alicedoe." }); return send(201, { id: body.id, name: body.name, source: { repo: body.repo } }); }
    if (p === "/api/orgs/examplelabs/members") return send(200, { members: [{ login: "alicedoe", role: "owner" }, { login: "carol", role: "member" }] });
    if (p === "/api/reports") return send(201, { report: { id: 42 } });
    if (p.startsWith("/api/admin/")) {
      if (!state.in || !state.role) return nope(); // closed: the same 404 as an unknown address
      if (p === "/api/admin/queue") return send(200, QUEUE());
      if (p === "/api/admin/roles" && get) return send(200, { roles: [{ github_id: 1, login: "kleeedolinux", role: "owner", granted_by: "ADMINS", seeded: true, two_factor: true }, { github_id: 2, login: "dana", role: "support", granted_by: "kleeedolinux", granted_at: 1793000000, two_factor: true }] });
      if (p === "/api/admin/audit") return send(200, { entries: [{ id: 9, at: 1793800000, actor_login: "kleeedolinux", action: "cert.approve", target: "request:r0", detail: { note: "Known studio" } }] });
      return send(200, { sentence: "Done." });
    }
    if (p === "/auth/logout") { state.in = false; return send(200, { signed_in: false }); }
    nope();
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

/* 1. Screenshots of every kind of page, at both widths and in both schemes. [name, path, signed in, role] */
const SHOTS = [["home", "/"], ["apps", "/apps"], ["plugins", "/plugins"], ["extensions", "/extensions"], ["category", "/categories/utilities"],
  ["listing-app", "/apps/org.wolos.notes"], ["listing-plugin", "/plugins/alicedoe.weather"], ["listing-extension", "/extensions/examplelabs.markdown-preview"], ["listing-origin", "/apps/rivertools.clock"],
  ["version", "/plugins/alicedoe.weather/2.1.0"], ["version-flagged", "/extensions/examplelabs.markdown-preview/0.9.1"], ["version-withdrawn", "/apps/rivertools.clock/1.0.0"],
  ["author", "/authors/alicedoe"], ["org", "/orgs/rivertools"], ["search", "/search?q=notes"],
  ["publish-out", "/publish"], ["publish", "/publish", "in"], ["dashboard", "/dashboard", "done"], ["dashboard-org", "/dashboard?as=examplelabs", "done"],
  ["report", "/report?listing=alicedoe.weather&version=2.1.0", "done"], ["admin", "/admin", "done", "owner"], ["admin-none", "/admin", "done"]];
for (const scheme of ["light", "dark"]) for (const w of [1280, 480]) {
  const { ctx, page } = await open(scheme, w);
  for (const [name, path, who, role] of SHOTS) {
    state.in = !!who; state.cla = state.pub = who === "done"; state.role = role || null; state.reqs = [];
    await page.goto(srv.base + path, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "*{animation:none!important;transition:none!important}" });
    await page.waitForTimeout(150);
    await noScroll(page, `${name} ${w} ${scheme}`);
    const bg = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    if (name === "home") ok(`${scheme}: page background follows the scheme`, scheme === "dark" ? bg === "rgb(25, 23, 32)" : bg === "rgb(243, 241, 248)", bg);
    await page.screenshot({ path: `${OUT}/${name}-${w}-${scheme}.png`, fullPage: true });
  }
  await ctx.close();
}

/* 1b. The store in words: trust rows, the statement, the offline check, icons from the package. */
{
  const { ctx, page } = await open("light", 1280);
  state.in = false; state.role = null;
  const row = async (path) => { await page.goto(srv.base + path, { waitUntil: "networkidle" }); return (await page.textContent(".trust .trust-line")).replace(/\s+/g, " ").trim(); };
  ok("trust row: Made by WolOS", /Made by WolOS$/.test(await row("/apps/org.wolos.notes")));
  ok("trust row: Trusted developer <name>", /Trusted developer Alice Doe$/.test(await row("/plugins/alicedoe.weather")));
  ok("trust row: From <name> (<login> on GitHub), from <repo>", /From River Tools \(rivertools on GitHub\), from rivertools\/clock$/.test(await row("/apps/rivertools.clock")));
  ok("trust row: Withdrawn, and no Download", /Withdrawn$/.test(await row("/apps/rivertools.clock/1.0.0")) && !(await page.$("a.btn-solid[href$='.wol']")));
  ok("trust row: Community for a file nobody vouches for", /Community$/.test(await row("/extensions/examplelabs.markdown-preview")));
  ok("the listing shows the package's own icon", await page.evaluate(() => { const i = document.querySelector(".l-head img.icon"); return !!i && i.complete && i.naturalWidth === 128; }));
  ok("the store uses the same card for apps, plugins and extensions", await page.evaluate(async () => { const t = await (await fetch("/")).text(); return ["/apps/", "/plugins/", "/extensions/"].every((k) => new RegExp(`<li class="card item"><a class="stretch" href="${k}`).test(t)); }));
  await page.goto(srv.base + "/plugins/alicedoe.weather", { waitUntil: "networkidle" });
  ok("the listing has its release history with a page per version", (await page.locator("#rels ~ .hist li").count()) === 2 && /Withdrawn by its author/.test(await page.textContent(".hist")));
  await page.click('.hist a[href="/plugins/alicedoe.weather/2.1.0"]');
  await page.waitForURL(/2\.1\.0$/);
  ok("the version page says who checked it and when", /^Checked by WolOS Hub on \d+ \w+ 2026$/.test((await page.textContent("#st")).trim()));
  ok("the version page has its Report link", !!(await page.$('a[href="/report?listing=alicedoe.weather&version=2.1.0"]')));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#offline summary")]);
  ok("one click on Verify offline downloads the statement", dl.suggestedFilename() === "alicedoe.weather-2.1.0.wsig", dl.suggestedFilename());
  ok("and shows the command", await page.isVisible("#offline pre") && /wol verify alicedoe\.weather-2\.1\.0\.wolplug alicedoe\.weather-2\.1\.0\.wsig/.test(await page.textContent("#offline pre")));
  await page.screenshot({ path: `${OUT}/version-offline-1280-light.png`, fullPage: true });
  await page.goto(srv.base + "/extensions/examplelabs.markdown-preview/0.9.1", { waitUntil: "networkidle" });
  ok("a flagged version names its finding in plain words", /opens? links in your browser/i.test(await page.textContent(".statement")));
  await page.goto(srv.base + "/", { waitUntil: "networkidle" });
  ok("home: categories lead to a page per category", (await page.locator(".hero .chips a").count()) === 2);
  await ctx.close();
}

/* 2. The keyboard alone. */
{
  const { ctx, page } = await open("light", 1280);
  state.in = false; state.role = null;
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
  ok("search with no match says so", await page.isVisible("#none"));

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

  // Signed in: the header, the two agreements, linking a repository, asking for a certificate.
  state.in = true; state.cla = false; state.pub = false; state.reqs = []; state.posts.length = 0;
  await page.goto(srv.base + "/publish", { waitUntil: "networkidle" });
  ok("signed in: the header shows the name, a way to the dashboard and Sign out", (await page.textContent("#who")).includes("Alice Doe") && (await page.textContent("#who")).includes("Sign out") && !!(await page.$('#who a[href="/dashboard"]')));
  await page.waitForFunction(() => /contributor|cla/i.test(document.querySelector('.terms[data-doc="cla"] [data-slot="text"]').textContent));
  ok("signed in: both agreements are shown, the form is not", (await page.isVisible('.terms[data-doc="cla"] form')) && (await page.isVisible('.terms[data-doc="publisher"] form')) && !(await page.isVisible("#listing-form")));
  for (const doc of ["cla", "publisher"]) {
    await page.focus(`.terms[data-doc="${doc}"] input[name="agree"]`); await page.keyboard.press("Space"); await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
    await page.waitForSelector(`.terms[data-doc="${doc}"] [data-state="ok"]`, { state: "visible" });
  }
  await page.waitForSelector("#listing-form", { state: "visible" });
  ok("accepting both agreements by keyboard shows the link form", state.cla && state.pub && ["cla", "publisher"].every((d) => state.posts.some(([p, b, o]) => p === `/api/terms/${d}` && b.version === "0-test" && b.sha256 === TEXT(d).sha256 && o === srv.base)));
  ok("the organisation you own can be linked", /Link examplelabs/.test(await page.textContent("#org-list")));
  await page.selectOption("#f-kind", "extension");
  ok("an extension asks for its host app", await page.isVisible("#f-host"));
  await page.selectOption("#f-kind", "app");
  await page.fill("#f-id", "wrong.id"); await page.fill("#f-name", "Notes"); await page.fill("#f-summary", "Quick notes."); await page.fill("#f-license", "MIT"); await page.fill("#f-repo", "alicedoe/notes"); await page.fill("#f-asset", "alicedoe.notes-*.wol");
  await page.focus("#f-asset"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#listing-form [data-err]").textContent.length > 0);
  ok("a refusal shows the Worker's own sentence", /start with alicedoe/.test(await page.textContent("#listing-form [data-err]")));
  await page.fill("#f-id", "alicedoe.notes");
  await page.focus("#f-asset"); await page.keyboard.press("Enter");
  await page.waitForSelector('[data-when~="linked"]', { state: "visible" });
  ok("linking a repository confirms in words", /Notes is linked to alicedoe\/notes/.test(await page.textContent('[data-when~="linked"]')));
  await page.waitForSelector('#certs [data-tier="origin"] [data-state="issued"]', { state: "visible" });
  ok("certificate card: origin issued, with its date and serial", /Issued on \d+ \w+ 2026/.test(await page.textContent('#certs [data-tier="origin"]')) && /a1000000000000c7/.test(await page.textContent('#certs [data-tier="origin"]')));
  ok("certificate card: trusted can be applied for", await page.isVisible('#certs [data-tier="trusted"] [data-state="none"]') && await page.isEnabled('#certs input[value="trusted"]') && !(await page.isEnabled('#certs input[value="origin"]')));
  ok("certificate card: the wol cert request command for this account", (await page.textContent("#certs [data-slot=cmd]")) === "wol cert request 5310001 alicedoe alicedoe. Alice Doe");
  await page.fill('#certs textarea[name="request"]', "not a request");
  await page.click('#certs [data-act="send-cert"]');
  ok("a request that is not one is explained", /Paste the whole request/.test(await page.textContent('#certs [data-err="cert"]')));
  await page.fill('#certs textarea[name="request"]', JSON.stringify({ format: 1, action: "issue", kind: "person", subject: { github_id: 5310001, login: "alicedoe", name: "Alice Doe" } }));
  await page.waitForFunction(() => document.querySelector('#certs .terms[data-doc="trust"] [data-slot="text"]').textContent.length > 0);
  await page.check('#certs input[name="trust_ok"]');
  await page.click('#certs [data-act="send-cert"]');
  await page.waitForSelector('#certs [data-tier="trusted"] [data-state="pending"]', { state: "visible" });
  const cr = state.posts.find(([p]) => p === "/api/cert/request");
  ok("asking for the trusted certificate sends tier and the Trust Terms with the request", cr && cr[1].tier === "trusted" && cr[1].trust_terms.sha256 === TEXT("trust").sha256 && cr[1].subject.login === "alicedoe", JSON.stringify(cr?.[1]).slice(0, 120));
  await page.screenshot({ path: `${OUT}/publish-done-1280-light.png`, fullPage: true });

  // The dashboard: per-version status in words, an organisation's members.
  await page.goto(srv.base + "/dashboard", { waitUntil: "networkidle" });
  await page.waitForSelector("#d-listings .dl");
  const vers = await page.$$eval("#d-listings .dv", (l) => l.map((v) => v.textContent.replace(/\s+/g, " ")));
  ok("dashboard: checking, flagged with the reason, listed, withdrawn", vers.length === 4 && /Checking/.test(vers[0]) && /Flagged.*Not listed.*an address its manifest does not name/.test(vers[1]) && /Listed/.test(vers[2]) && /Withdrawn/.test(vers[3]), vers.join(" | ").slice(0, 200));
  await page.click('#d-accounts a:has-text("examplelabs")');
  await page.waitForURL(/as=examplelabs/);
  await page.waitForFunction(() => document.querySelectorAll("#d-members li").length === 2);
  ok("dashboard of an organisation: members and roles from GitHub", /carol/.test(await page.textContent("#d-members")) && /Owner/.test(await page.textContent("#d-members")));
  ok("dashboard of an organisation: its certificate card has the --org command", /wol cert request 9910002 examplelabs examplelabs\. examplelabs --org/.test(await page.textContent("#certs [data-slot=cmd]")));

  // The closed admin page.
  const admin = async (role) => {
    state.role = role; state.posts.length = 0;
    const scripts = [];
    page.on("request", (r) => { if (/\/assets\/admin\./.test(r.url())) scripts.push(r.url()); });
    await page.goto(srv.base + "/admin", { waitUntil: "networkidle" });
    await page.waitForTimeout(100);
    page.removeAllListeners("request");
    return scripts.length;
  };
  ok("admin without a role: an empty page, the panel's script never loads", (await admin(null)) === 0 && (await page.evaluate(() => document.body.innerText.trim())) === "");
  state.in = false;
  ok("admin signed out: the same empty page", (await admin(null)) === 0 && (await page.evaluate(() => document.body.innerText.trim())) === "");
  state.in = true;
  ok("admin as an owner: the panel loads with the queue", (await admin("owner")) === 1 && (await page.waitForSelector("#a-req")) && /Bob Dev/.test(await page.textContent("main")));
  ok("admin page is noindex and in no sitemap", await page.evaluate(async () => document.querySelector('meta[name=robots]').content.includes("noindex") && !(await (await fetch("/sitemap.xml")).text()).includes("/admin")));
  await page.click('#a-req ~ ul button:has-text("Approve"), section[aria-labelledby="a-req"] button:has-text("Approve")');
  ok("an action opens a confirmation sheet", await page.isVisible("dialog.sheet"));
  await page.screenshot({ path: `${OUT}/admin-sheet-1280-light.png`, fullPage: false });
  await page.click("#sh-go");
  ok("the sheet refuses without a reason", /reason first/.test(await page.textContent("#sh-e")) && !state.posts.length);
  await page.fill("#sh-r", "Known studio, identity checked on a call.");
  await page.click("#sh-go");
  await page.waitForSelector("dialog.sheet", { state: "hidden" });
  ok("approve sends the reason as the Worker's note", state.posts.some(([p, b]) => p === "/api/admin/requests/r1/approve" && /Known studio/.test(b.note)));
  await page.click('section[aria-labelledby="a-rep"] button:has-text("Take down")');
  await page.fill("#sh-r", "Copies another app."); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  await page.waitForSelector("dialog.sheet", { state: "hidden" });
  ok("take down by keyboard sends the note", state.posts.some(([p, b]) => p === "/api/admin/reports/7/takedown" && b.note === "Copies another app."));
  await page.click('a[data-v="lookup"]'); await page.fill("#lk", "alicedoe"); await page.keyboard.press("Enter");
  await page.waitForSelector('main button:has-text("Revoke")');
  await page.click('main button:has-text("Revoke")');
  ok("revoke asks why: a stolen key or abuse", (await page.locator("#sh-c input").count()) === 2);
  await page.check('#sh-c input[value="abuse"]'); await page.fill("#sh-r", "Signed a copy of another app."); await page.click("#sh-go");
  await page.waitForSelector("dialog.sheet", { state: "hidden" });
  ok("revoke sends reason and note", state.posts.some(([p, b]) => p === "/api/admin/certs/a1000000000000c7/revoke" && b.reason === "abuse" && /copy/.test(b.note)));
  await page.click('a[data-v="roles"]'); await page.waitForSelector('main li:has-text("dana")');
  ok("roles: owners see who holds which role", /support/.test(await page.textContent('main li:has-text("dana")')));
  await page.click('a[data-v="audit"]'); await page.waitForSelector(".adm-audit li");
  ok("the audit trail shows who did what", /kleeedolinux.*cert\.approve.*Known studio/.test(await page.textContent(".adm-audit")));
  await page.screenshot({ path: `${OUT}/admin-audit-1280-light.png`, fullPage: true });
  state.role = "support";
  await admin("support");
  await page.waitForSelector("#a-rep");
  ok("admin as support: only reports, only Resolve", !(await page.$("#a-req")) && (await page.locator('main button:has-text("Resolve")').count()) === 1 && !(await page.$('main button:has-text("Take down")')) && !(await page.$('a[data-v="roles"]')));
  state.role = null;

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
/* 3. The static review deploy (HUB_API=off, fixtures only): no Worker, no call to it, not one console error. */
{
  const dir = "/tmp/hub-site3-static";
  execFileSync(process.execPath, [at("scripts/build.mjs")], { env: { ...process.env, HUB_API: "off", DIST: dir }, stdio: "ignore" });
  const st = await serve(dir); // no Worker: /api and /auth get the 404 page, as on Pages alone
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(), noise = [], calls = [];
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) noise.push(m.text()); });
  page.on("pageerror", (e) => noise.push(e.message));
  page.on("request", (r) => { if (/\/(api|auth)\//.test(new URL(r.url()).pathname)) calls.push(r.url()); });
  for (const path of ["/", "/apps", "/plugins/alicedoe.weather", "/plugins/alicedoe.weather/2.1.0", "/apps/org.wolos.notes", "/search?q=clock", "/publish", "/dashboard", "/report", "/signin", "/terms/usage", "/admin"]) {
    await page.goto(st.base + path, { waitUntil: "networkidle" });
  }
  ok("static build: no request to the Worker, no console error or warning", !calls.length && !noise.length, [...calls, ...noise].slice(0, 3).join(" | "));
  await page.goto(st.base + "/publish", { waitUntil: "networkidle" });
  ok("static build: Sign in points at /auth/login, the steps show the signed-out state", /^\/auth\/login\?next=/.test(await page.getAttribute("#who a", "href")) && await page.isVisible('#s-signin [data-when="out"]'));
  await page.goto(st.base + "/terms/privacy", { waitUntil: "networkidle" });
  ok("a term not written yet says so", /being written/.test(await page.textContent("main")));
  await page.screenshot({ path: `${OUT}/terms-placeholder-1280-light.png`, fullPage: true });
  await ctx.close(); st.close();
}
await browser.close();
srv.close();
ok("no console errors, page errors or failed requests", problems.length === 0, problems.slice(0, 5).join(" | "));
writeFileSync(`${OUT}/proof.txt`, results.map(([n, p, d]) => `${p ? "ok  " : "FAIL"} ${n}${d ? "  " + d : ""}`).join("\n") + "\n");
const failed = results.filter((r) => !r[1]);
console.log(`proof: ${results.length - failed.length} of ${results.length} checks passed; screenshots in ${OUT}`);
process.exit(failed.length ? 1 : 0);
