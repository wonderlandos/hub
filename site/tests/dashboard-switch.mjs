// SPDX-License-Identifier: GPL-2.0-or-later
// Browser test of the dashboard's account switch (headless Chromium, like scripts/proof.mjs; needs a built dist/:
// `npm run build:review` first). A mocked Worker answers /api/me slowly. It proves:
//   - with a signed-in session the header never shows "Sign in" (not even before the session answers), and neither does
//     the dashboard's "Sign in to see" block;
//   - switching the account to the organisation does not load a page (a marker survives), does not rebuild the header
//     (same elements), does not ask /api/me again, and changes the certificate command to the organisation's;
//   - Back returns to the person; a 401 shows "Sign in" at once and forgets the kept sign-in.
// Run: node tests/dashboard-switch.mjs   (PLAYWRIGHT_CORE and CHROME as scripts/lib/browser.mjs says)
import { launch, serve } from "../scripts/lib/browser.mjs";
import { at } from "../scripts/lib/paths.mjs";

const ME = { github_id: 5310001, login: "alicedoe", name: "Alice Doe", avatar: null, role: "member", admin: false, two_factor: true,
  cla: { ok: true, accepted: "1" }, terms: { publisher: { ok: true, accepted: "1" }, trust: { ok: false } }, certs: { origin: "none", trusted: "none" },
  orgs: [{ github_org_id: 348106055, login: "wonderlandos", role: "owner", linked: true, cla: { ok: true, accepted: "1" } }] };
const calls = [];
const live = { in: true, debug: true, posted: [] };
const AGREEMENTS = (login) => ({ subject: { kind: login === "alicedoe" ? "person" : "org", login }, agreements: [
  { doc: "cla", name: "Contributor Licence Agreement", url: "/terms/cla", current: "1", ok: true, per_request: false, accepted: [{ version: "1", sha256: "ab".repeat(32), accepted_at: 1793577600, by: "alicedoe" }] },
  { doc: "publisher", name: "Publisher Agreement", url: "/terms/publisher", current: "2", ok: false, per_request: false, accepted: [{ version: "1", sha256: "cd".repeat(32), accepted_at: 1790985600, by: "alicedoe" }] },
  { doc: "trust", name: "Trust Terms", url: "/terms/trust", current: "1", ok: false, per_request: true, accepted: [] },
  { doc: "certificates", name: "Certificate Terms", url: "/terms/certificates", current: "1", ok: true, per_request: true, accepted: [{ version: "1", sha256: "ef".repeat(32), accepted_at: 1793577600, by: "alicedoe" }] },
].filter((a) => login === "alicedoe" || a.doc !== "publisher") });
const api = (req, res, url) => {
  const send = (code, body, delay = 0) => setTimeout(() => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); }, delay);
  const p = url.pathname;
  calls.push(p);
  if (p === "/api/me") return live.in ? send(200, ME, 500) : send(401, { error: "signed-out", sentence: "Sign in first." }, 300);
  if (p === "/api/my/overview") {
    if (!live.in) return send(401, { error: "signed-out", sentence: "Sign in first." }, 300);
    const as = url.searchParams.get("as") || "";
    return send(200, { me: ME, account: { kind: as ? "org" : "person", login: as || "alicedoe" }, accounts: [], listings: [], attention: [], reports: [], certs: { states: { origin: "none", trusted: "none" }, refused: {}, list: [] },
      agreements: AGREEMENTS(as || "alicedoe").agreements, members: as ? [{ login: "alicedoe", role: "owner" }, { login: "carol", role: "member" }] : ME.orgs.map((o) => ({ login: o.login, role: o.role })), generated: 0 }, as ? 150 : 500);
  }
  if (p === "/api/my/agreements") return send(200, AGREEMENTS(url.searchParams.get("as") || "alicedoe"), 60);
  if (p === "/api/debug/errors") {
    let data = ""; req.on("data", (c) => (data += c));
    req.on("end", () => { if (!live.debug) return send(404, { error: "not-found", sentence: "x" }); live.posted.push(JSON.parse(data)); send(201, { stored: true }); });
    return;
  }
  if (p === "/api/cert/requests") return send(200, { requests: [] }, 120);
  if (p.startsWith("/api/certs/")) return send(200, { certs: [] }, 120);
  if (p === "/api/my/listings") return send(200, { listings: [], reports: [] }, 80);
  if (p === "/api/orgs/wonderlandos/members") return send(200, { members: [{ login: "alicedoe", role: "owner" }, { login: "carol", role: "member" }] }, 150);
  if (p === "/auth/logout") { live.in = false; return send(200, { signed_in: false }); }
  if (/^\/api\/terms\//.test(p)) return send(200, { doc: "x", version: "1", text: "text", sha256: "ab".repeat(32) });
  send(404, { error: "not-found", sentence: "There is nothing at this address." });
};

const srv = await serve(at("dist"), api);
const browser = await launch();
const failures = [];
const ok = (name, cond, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${name}${!cond && extra ? ` (${extra})` : ""}`); if (!cond) failures.push(name); };

/* Every frame: what a person can see of the header and of the sign-in block of the page. */
const WATCH = () => {
  window.__seen = new Set();
  const visible = (e) => e && getComputedStyle(e).visibility !== "hidden" && !e.hidden && !e.closest("[hidden]");
  const tick = () => {
    const who = document.getElementById("who");
    if (who) window.__seen.add("header:" + (visible(who) ? who.innerText.replace(/\s+/g, " ").trim() : "(hidden)"));
    document.querySelectorAll('main [data-when~="out"]').forEach((e) => { if (visible(e)) window.__seen.add("page-out:" + e.innerText.slice(0, 20)); });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

try {
  /* 1. Signed in, and this browser kept the sign-in from the last page. */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const problems = [];
    page.on("pageerror", (e) => problems.push(e.message));
    await page.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("hub-who", JSON.stringify({ login: "alicedoe", name: "Alice Doe", avatar: null })); } });
    await page.addInitScript(WATCH);
    await page.goto(srv.base + "/dashboard", { waitUntil: "commit" });
    await page.waitForSelector("#d-accounts a", { timeout: 5000 });
    await page.waitForFunction(() => /Alice Doe/.test(document.getElementById("who").innerText));
    await page.waitForSelector("#certs [data-slot=cmd]");
    ok("person: the command is the person's", (await page.textContent("#certs [data-slot=cmd]")) === "wol cert request 5310001 alicedoe alicedoe. Alice Doe", await page.textContent("#certs [data-slot=cmd]"));
    const before = await page.evaluate(() => { window.__marker = "same page"; const w = document.getElementById("who"); w.firstElementChild.__mine = 1; return [...window.__seen]; });
    ok("signed in: the header never shows Sign in while the session is asked for", !before.some((s) => /Sign in/.test(s)), before.join(" | "));
    ok("signed in: the dashboard never shows its Sign in block", !before.some((s) => s.startsWith("page-out")), before.join(" | "));
    const meCalls = calls.filter((c) => c === "/api/me").length;

    await page.evaluate(() => window.__seen.clear());
    await page.click('#d-accounts a:has-text("wonderlandos")');
    await page.waitForFunction(() => /--org/.test(document.querySelector("#certs [data-slot=cmd]")?.textContent || ""));
    ok("switch: the address changes to the organisation", page.url().endsWith("/dashboard?as=wonderlandos"), page.url());
    ok("switch: no page load (the marker is still there)", (await page.evaluate(() => window.__marker)) === "same page");
    ok("switch: the header is the same element, not rebuilt", await page.evaluate(() => !!document.getElementById("who").firstElementChild.__mine));
    ok("switch: the session is not asked for again", calls.filter((c) => c === "/api/me").length === meCalls);
    ok("switch: the organisation's command is exact", (await page.textContent("#certs [data-slot=cmd]")) === "wol cert request 348106055 wonderlandos wonderlandos. wonderlandos --org", await page.textContent("#certs [data-slot=cmd]"));
    ok("switch: the Copy button copies the same words", (await page.getAttribute('#certs [data-copy-slot="cmd"]', "data-copy")) === "wol cert request 348106055 wonderlandos wonderlandos. wonderlandos --org");
    await page.waitForFunction(() => /carol/.test(document.getElementById("d-members").textContent));
    ok("switch: the organisation's members are shown", /Owner/.test(await page.textContent("#d-members")));
    ok("switch: the organisation link is the current one", (await page.getAttribute('#d-accounts a:has-text("wonderlandos")', "aria-current")) === "page" && (await page.getAttribute('#d-accounts a:has-text("alicedoe")', "aria-current")) === null);
    const during = await page.evaluate(() => [...window.__seen]);
    ok("switch: the header never changes and never shows Sign in", during.length === 1 && during[0] === "header:Alice Doe Sign out", during.join(" | "));

    const agr = async () => (await page.innerText("#d-agreements")).replace(/\s+/g, " ");
    await page.waitForFunction(() => document.querySelectorAll("#d-agreements .agr").length === 3);
    ok("agreements (organisation): the organisation has no Publisher Agreement, three texts are listed", /Contributor Licence Agreement/.test(await agr()));
    ok("agreements: the exact hash, the day and who accepted are shown", /Version 1 accepted by alicedoe as an owner, 2 November 2026/.test(await agr()) && (await agr()).includes("ab".repeat(32)));
    ok("agreements: per-request texts say so, and every title links to its text", /Accepted with each certificate request\./.test(await agr()) && (await page.getAttribute("#d-agreements .agr a", "href")) === "/terms/cla");
    await page.goBack();
    await page.waitForFunction(() => document.querySelectorAll("#d-agreements .agr").length === 4);
    ok("agreements (person): a newer version of a text is said so", /A newer version is out\. Version 2 is the current one/.test(await agr()) && /Not accepted yet\./.test(await agr()) === false);
    await page.waitForFunction(() => !/--org/.test(document.querySelector("#certs [data-slot=cmd]")?.textContent || "x--org"));
    ok("Back: the person's dashboard again, still no page load", (await page.textContent("#certs [data-slot=cmd]")) === "wol cert request 5310001 alicedoe alicedoe. Alice Doe" && (await page.evaluate(() => window.__marker)) === "same page");
    ok("no script errors", problems.length === 0, problems.join("; "));
    await ctx.close();
  }

  /* 1b. Many pages in a row, a reload, a click on a nav link: the header is never "Sign in" in any frame (and polled every 50 ms). */
  {
    live.in = true;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("hub-who", JSON.stringify({ login: "alicedoe", name: "Alice Doe", avatar: null })); } });
    await page.addInitScript(WATCH);
    const seenSignIn = [];
    const poll = setInterval(() => page.evaluate(() => { const w = document.getElementById("who"); return w && getComputedStyle(w).visibility !== "hidden" && /Sign in/.test(w.innerText) ? location.pathname : ""; }).then((x) => x && seenSignIn.push(x), () => {}), 50);
    const paths = ["/", "/apps", "/publish", "/report", "/dashboard", "/terms/usage", "/search?q=notes"];
    for (const path of paths) {
      await page.goto(srv.base + path, { waitUntil: "load" });
      await page.waitForFunction(() => /Alice Doe/.test(document.getElementById("who").innerText));
      await page.waitForTimeout(150);
      const seen = await page.evaluate(() => [...window.__seen]);
      ok(`${path}: header shows the name and never Sign in`, seen.includes("header:Alice Doe Sign out") && !seen.some((x) => /Sign in/.test(x)), seen.join(" | "));
    }
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => /Alice Doe/.test(document.getElementById("who").innerText));
    ok("reload: the header never shows Sign in", !(await page.evaluate(() => [...window.__seen])).some((x) => /Sign in/.test(x)));
    await page.click('header nav a:has-text("Apps")');
    await page.waitForURL("**/apps");
    await page.waitForFunction(() => /Alice Doe/.test(document.getElementById("who").innerText));
    ok("a click on the main menu: the header never shows Sign in", !(await page.evaluate(() => [...window.__seen])).some((x) => /Sign in/.test(x)));
    clearInterval(poll);
    ok("polled every 50 ms across all pages: never Sign in", seenSignIn.length === 0, seenSignIn.join(", "));
    /* Sign out clears the kept sign-in with the session, and the next page is signed out at once. */
    await page.click('#who button:has-text("Sign out")');
    await page.waitForFunction(() => /Sign in/.test(document.getElementById("who").innerText), null, { timeout: 5000 });
    ok("sign out: the kept sign-in is gone", (await page.evaluate(() => localStorage.getItem("hub-who"))) === null);
    ok("sign out: the next page opens signed out", await (async () => { await page.goto(srv.base + "/publish", { waitUntil: "load" }); return page.isVisible('#who a[href^="/auth/login"]'); })());
    ok("sign out: no signed-in hint on the page", (await page.evaluate(() => document.documentElement.dataset.who)) === undefined);
    /* Just back from GitHub: the header waits for the answer instead of saying Sign in. */
    live.in = true;
    await page.evaluate(() => localStorage.setItem("hub-signing", String(Date.now())));
    await page.goto(srv.base + "/dashboard", { waitUntil: "commit" });
    await page.waitForFunction(() => /Alice Doe/.test(document.getElementById("who").innerText));
    ok("back from GitHub: the header never showed Sign in", !(await page.evaluate(() => [...window.__seen])).some((x) => /Sign in/.test(x)), (await page.evaluate(() => [...window.__seen])).join(" | "));
    ok("back from GitHub: the answer is kept for the next page", (await page.evaluate(() => localStorage.getItem("hub-who"))) !== null && (await page.evaluate(() => localStorage.getItem("hub-signing"))) === null);
    await ctx.close();
  }

  /* 2. The session is gone (401): Sign in at once, and the kept sign-in is forgotten. */
  {
    live.in = false;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => { localStorage.setItem("hub-who", JSON.stringify({ login: "alicedoe", name: "Alice Doe", avatar: null })); });
    await page.goto(srv.base + "/dashboard", { waitUntil: "commit" });
    await page.waitForFunction(() => /Sign in/.test(document.getElementById("who").innerText) && getComputedStyle(document.getElementById("who")).visibility === "visible", null, { timeout: 5000 });
    ok("401: the header says Sign in", true);
    ok("401: the kept sign-in is forgotten", (await page.evaluate(() => localStorage.getItem("hub-who"))) === null);
    ok("401: the dashboard says why and offers Sign in", await page.isVisible('main [data-when~="out"] a'));
    await ctx.close();
  }

  /* 3. Never signed in: the page is signed out from the first frame. */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(srv.base + "/dashboard", { waitUntil: "networkidle" });
    ok("never signed in: Sign in is shown", await page.isVisible('#who a[href^="/auth/login"]'));
    await ctx.close();
  }
  /* 4. TEMPORARY error tracker (src/debug.js): reports to the Worker, the minimum, no cookie; stops after the first 404. */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", () => {});
    live.in = false;
    await page.goto(srv.base + "/publish?code=secret#frag", { waitUntil: "load" });
    await page.evaluate(() => { setTimeout(() => { throw new Error("boom one"); }); Promise.reject(new Error("boom two")); setTimeout(() => { throw new Error("boom one"); }); });
    await page.waitForTimeout(400);
    ok("tracker: an error and a rejection are reported once each", live.posted.length === 2 && /boom one/.test(live.posted[0].message) && live.posted[1].kind === "rejection", JSON.stringify(live.posted));
    ok("tracker: the page address has no query or fragment, and the build is the script hash", live.posted.every((x) => x.url === srv.base + "/publish" && /^[0-9a-f]{10}$/.test(x.build)), JSON.stringify(live.posted[0]));
    ok("tracker: the stack travels, and only the five fields", !!live.posted[0].stack && Object.keys(live.posted[0]).sort().join() === "build,kind,message,stack,url");
    ok("tracker: no cookie was set by the page", (await ctx.cookies()).length === 0);
    live.posted.length = 0; live.debug = false;
    const calls0 = calls.filter((c) => c === "/api/debug/errors").length;
    const page2 = await ctx.newPage(); page2.on("pageerror", () => {});
    await page2.goto(srv.base + "/publish", { waitUntil: "load" });
    await page2.evaluate(() => { setTimeout(() => { throw new Error("a"); }); });
    await page2.waitForTimeout(300);
    await page2.evaluate(() => { setTimeout(() => { throw new Error("b"); }); });
    await page2.goto(srv.base + "/apps", { waitUntil: "load" });
    await page2.evaluate(() => { setTimeout(() => { throw new Error("c"); }); });
    await page2.waitForTimeout(300);
    ok("tracker: switched off at the Worker (404) the tab stops asking", calls.filter((c) => c === "/api/debug/errors").length - calls0 <= 2 && live.posted.length === 0, String(calls.filter((c) => c === "/api/debug/errors").length - calls0));
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.close();
}
if (failures.length) { console.error(`dashboard-switch: ${failures.length} failed`); process.exit(1); }
console.log("dashboard-switch: all passed");
