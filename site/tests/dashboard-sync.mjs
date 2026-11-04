// SPDX-License-Identifier: GPL-2.0-or-later
// Browser test of what the dashboard shows right after things change elsewhere (headless Chromium over tests/lib/mock-hub.mjs,
// which answers the overview with the Worker's own cache policy: private, max-age=15, stale-while-revalidate=120, ETag,
// Vary: Cookie). Needs a built dist/ (`npm run build:review`). It proves:
//   - sign-in: signed out, Sign in, back on /dashboard: the person's login and listings, no reload;
//   - the browser's copy is never drawn without asking: a listing connected elsewhere shows on the next visit at once;
//   - another tab signs out and in as someone else: this tab follows, header and page, without a reload;
//   - the account switch shows the organisation's own, current listings, also when switching back later;
//   - the agreement component: the Trust Terms on the dashboard and the agreements on /publish are drawn with their
//     title, the "In short" box and numbered sections, never as raw Markdown;
//   - Admin is in the header and on the dashboard for a person with a panel role, and nowhere for anyone else.
// Run: node tests/dashboard-sync.mjs   (PLAYWRIGHT_CORE and CHROME as scripts/lib/browser.mjs says; SHOTS=/some/folder for screens)
import { launch, serve } from "../scripts/lib/browser.mjs";
import { at } from "../scripts/lib/paths.mjs";
import { mockHub } from "./lib/mock-hub.mjs";

const hub = mockHub({ latency: 60 });
const S = hub.S;
const srv = await serve(process.env.DIST || at("dist"), hub.handler);
const browser = await launch();
const failures = [];
const ok = (name, cond, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${name}${!cond && extra ? ` (${extra})` : ""}`); if (!cond) failures.push(name); };
const SHOTS = process.env.SHOTS;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const L = (id, name) => ({ id, name, summary: "", kind: "app", host: null, repo: id.replace(".", "/"), asset: `${id}-*.wol`, license: "MIT", status: "draft", created_at: hub.T });
const listingNames = (page) => page.$$eval("#d-listings .dl h3", (n) => n.map((x) => x.textContent.trim()));
const until = async (page, fn, arg, ms = 4000) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const RAW = /(^|\n)\s*(#{1,4} |> |---)|\*\*/;

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  S.listings = [L("alicedoe.notes", "Notes")];
  S.accepted = { cla: true, publisher: true };

  /* 1. Signed out, then Sign in: the page that comes back is the person's, without a reload. */
  await page.goto(srv.base + "/dashboard", { waitUntil: "load" });
  await page.waitForSelector('[data-when=out]:not([hidden])');
  ok("signed out: the dashboard offers Sign in", await page.isVisible('[data-when=out] a.btn-solid'));
  let loads = 0; page.on("load", () => loads++);
  await page.click('[data-when=out] a.btn-solid');
  await page.waitForURL("**/dashboard");
  ok("sign-in: the header names the person", await until(page, () => /Alice Doe/.test(document.getElementById("who").innerText)));
  ok("sign-in: the person's listing is there", await until(page, () => /Notes/.test(document.getElementById("d-listings").innerText)));
  ok("sign-in: the signed-out block is gone", !(await page.isVisible('[data-when=out]')));
  ok("sign-in: one page load (the redirect back), nothing after it", loads === 1, String(loads));

  /* 2. Changed elsewhere (another tab, GitHub, the webhook) within the 15 s the Worker lets a browser keep its copy:
        the next visit shows it at once, because the page asks with the ETag instead of drawing the copy. */
  S.listings.push(L("alicedoe.clock", "Clock"));
  await page.goto(srv.base + "/publish", { waitUntil: "load" });
  await page.goto(srv.base + "/dashboard", { waitUntil: "load" });
  ok("the next visit shows what changed elsewhere (never the browser's old copy)", await until(page, () => /Clock/.test(document.getElementById("d-listings").innerText)), (await listingNames(page)).join());
  const before = S.calls.filter((c) => c.startsWith("304 ")).length;
  await page.goto(srv.base + "/dashboard", { waitUntil: "load" });
  await page.waitForSelector("#d-listings .dl");
  ok("an unchanged answer comes back as a 304 without a body", S.calls.filter((c) => c.startsWith("304 ")).length > before);

  /* 3. The agreement component on the dashboard: the Trust Terms beside the certificate request, and a card's text. */
  await page.waitForFunction(() => { const b = document.querySelector("#certs .terms .cla"); return b && b.textContent.length > 40; }, null, { timeout: 4000 }).catch(() => {});
  const trust = await page.evaluate(() => {
    const b = document.querySelector("#certs .terms .cla");
    return b && { title: b.querySelector("h3.agreement-title")?.textContent, secs: b.querySelectorAll(".agreement-sec > h4").length, short: !!b.querySelector(".agreement-short"),
      text: b.textContent, link: b.querySelector("a")?.getAttribute("href"), strong: !!b.querySelector("strong"), accept: !!b.parentElement.querySelector("input[name=trust_ok]") };
  });
  ok("dashboard: the Trust Terms have their title as a heading", trust && trust.title === "Trust Terms", JSON.stringify(trust));
  ok("dashboard: the Trust Terms have their numbered sections as headings and the In short box", trust && trust.secs === 2 && trust.short);
  ok("dashboard: the Trust Terms show no Markdown markers (#, >, ---, **)", trust && !RAW.test(trust.text) && trust.strong && trust.link === "/terms/usage", trust && trust.text.slice(0, 120));
  ok("dashboard: the accept row is under the text", trust && trust.accept);
  if (await page.$("#d-agreements .agr-read summary")) await page.click("#d-agreements .agr-read summary");
  ok("dashboard: an agreement card reads its text with the same component", await until(page, () => { const b = document.querySelector("#d-agreements .agr-read .agreement-text"); return b && b.querySelector("h3.agreement-title") && !/\*\*|(^|\n)## /.test(b.textContent); }));
  await shot(page, "sync-1-dashboard-agreement");

  /* 4. Admin: in the header and on the dashboard for a panel role (the mock's person is an owner). */
  ok("admin: the header has Admin", await page.isVisible('#who a.who-admin[href="/admin"]'));
  ok("admin: the dashboard has the way to the panel and its tabs", await page.isVisible("#d-admin") && /owner/.test(await page.innerText("#d-admin"))
    && (await page.$$eval("#d-admin a", (a) => a.map((x) => x.getAttribute("href")))).join() === "/admin#queue,/admin#users,/admin#listings,/admin#audit");

  /* 5. The account switch: the organisation's own listings, and current when switching back later. */
  S.orgs = ["wonderlandos"]; S.orgListings = { wonderlandos: [L("wonderlandos.maps", "Maps")] };
  await page.goto(srv.base + "/dashboard", { waitUntil: "load" });
  const offered = await until(page, () => !!document.querySelector('#d-accounts a[href="/dashboard?as=wonderlandos"]'));
  ok("switch: a new organisation is offered on the next visit", offered);
  if (offered) {
  await page.click('#d-accounts a[href="/dashboard?as=wonderlandos"]');
  ok("switch: the organisation's listing", await until(page, () => /Maps/.test(document.getElementById("d-listings").innerText) && !/Notes/.test(document.getElementById("d-listings").innerText)));
  await page.click('#d-accounts a[href="/dashboard"]');
  await until(page, () => /Notes/.test(document.getElementById("d-listings").innerText));
  S.orgListings.wonderlandos.push(L("wonderlandos.atlas", "Atlas"));
  await page.waitForTimeout(5500);
  await page.click('#d-accounts a[href="/dashboard?as=wonderlandos"]');
  ok("switch: back to the organisation a while later shows what changed there", await until(page, () => /Atlas/.test(document.getElementById("d-listings").innerText)), (await listingNames(page)).join());
  }

  /* 6. Another tab signs out and in as someone else: this tab follows, header and page, without a reload. */
  await page.click('#d-accounts a[href="/dashboard"]');
  await until(page, () => /Notes/.test(document.getElementById("d-listings").innerText));
  const other = await ctx.newPage();
  await other.goto(srv.base + "/dashboard", { waitUntil: "load" });
  await other.waitForSelector("#who [data-act=signout]");
  loads = 0;
  await other.click("#who [data-act=signout]");
  await other.waitForSelector('[data-when=out]:not([hidden])');
  ok("other tab signed out: this tab says Sign in, header and page", await until(page, () => !document.querySelector("[data-when=out]").hidden && /Sign in/.test(document.getElementById("who").innerText)));
  S.login = "bobsmith"; S.orgs = []; S.listings = [L("bobsmith.radio", "Radio")]; S.panel = null;
  await other.click('[data-when=out] a.btn-solid');
  await other.waitForURL("**/dashboard");
  ok("other tab signed in as someone else: this tab shows that person's listings", await until(page, () => /Radio/.test(document.getElementById("d-listings").innerText) && /bobsmith/.test(document.getElementById("who").innerText)), (await listingNames(page)).join());
  ok("other tab: this tab did not reload", loads === 0, String(loads));
  await shot(page, "sync-2-other-tab");

  /* 7. A plain person (no panel role): no Admin anywhere. */
  await page.goto(srv.base + "/dashboard", { waitUntil: "load" });
  await page.waitForSelector("#d-listings .dl");
  ok("admin: a plain person has no Admin in the header, and no address for it", !(await page.isVisible("#who a.who-admin")) && !(await page.$("#who a.who-admin[href]")));
  ok("admin: a plain person's page has no admin address at all", !(await page.$('a[href^="/admin"]')));
  ok("admin: a plain person has no admin card on the dashboard", !(await page.isVisible("#d-admin")));

  /* 8. The agreement component on /publish (step 2), the same as on the dashboard. */
  S.accepted = { cla: false, publisher: false };
  await page.goto(srv.base + "/publish", { waitUntil: "load" });
  ok("publish: the agreements step opens (the overview is the current one)", await until(page, () => document.getElementById("s-terms").dataset.state === "current"));
  ok("publish: the agreement has its title, sections and no Markdown markers", await until(page, () => {
    const b = document.getElementById("agree-text"); return b.querySelector("h3.agreement-title") && b.querySelectorAll(".agreement-sec > h4").length === 2 && !/\*\*|(^|\n)\s*(## |> |---)/.test(b.textContent);
  }));
  ok("no script errors", problems.length === 0, problems.join("; "));
  await ctx.close();
} finally {
  await browser.close();
  srv.close();
}
if (failures.length) { console.error(`dashboard-sync: ${failures.length} failed`); process.exit(1); }
console.log("dashboard-sync: all passed");
