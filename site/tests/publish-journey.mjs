// SPDX-License-Identifier: GPL-2.0-or-later
// Browser test of the developer's whole path over a mocked Worker (headless Chromium, like dashboard-switch.mjs; needs a built dist/:
// `npm run build:review` first). It walks: the publish page signed out; sign in; the two agreements on one screen; install the hub
// on GitHub; pick a repository and connect it (everything filled in); the three lines to push a tag; the status page of the version
// moving through received, checked, signed, published; a release without its file and "Check again"; a blocked version and what to fix;
// the dashboard with everything in one place; the admin queue with one-click and inline-reason actions. It also counts what each page
// asks the Worker and writes the screens to SHOTS (a folder) when given.
// Run: node tests/publish-journey.mjs   (PLAYWRIGHT_CORE and CHROME as scripts/lib/browser.mjs says; SHOTS=/some/folder for screens)
import { launch, serve } from "../scripts/lib/browser.mjs";
import { at } from "../scripts/lib/paths.mjs";
import { mockHub } from "./lib/mock-hub.mjs";

const LAT = Number(process.env.LATENCY ?? 120);
const hub = mockHub({ latency: LAT });
const S = hub.S;
const srv = await serve(process.env.DIST ? process.env.DIST : at("dist"), hub.handler);
const browser = await launch();
const failures = [];
const ok = (name, cond, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${name}${!cond && extra ? ` (${extra})` : ""}`); if (!cond) failures.push(name); };
const SHOTS = process.env.SHOTS;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const count = (re) => S.calls.filter((c) => re.test(c)).length;
const state = (page, id) => page.getAttribute(id, "data-state");
const speed = (page) => page.addInitScript(() => { window.HubPollScale = 0.04; });

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await speed(page);

  /* 1. Signed out: the whole path is visible, the first step is the one to do. */
  await page.goto(srv.base + "/publish", { waitUntil: "load" });
  await page.waitForSelector('#s-signin[data-state="current"]');
  ok("signed out: five steps in the rail", (await page.$$(".rail-item")).length === 5);
  ok("signed out: step 1 is open, the others wait", (await state(page, "#s-terms")) === "todo" && (await state(page, "#s-tag")) === "todo");
  ok("signed out: Sign in with GitHub is the one button", await page.isVisible('#s-signin a.btn-solid'));
  await shot(page, "1-publish-signed-out");

  /* 2. Sign in, then the agreements on one screen. */
  await page.click('#s-signin a.btn-solid');
  await page.waitForURL("**/publish");
  await page.waitForSelector('#s-terms[data-state="current"]');
  ok("signed in: step 1 folds into a line", (await state(page, "#s-signin")) === "done" && /alicedoe/.test(await page.innerText("#s-signin")));
  await page.waitForFunction(() => /Contributor Licence Agreement/.test(document.getElementById("agree-text").textContent));
  ok("agreements: the text of the first one is shown", true);
  await page.click('#agree-tabs button[data-doc="publisher"]');
  await page.waitForFunction(() => /Publisher Agreement/.test(document.getElementById("agree-text").textContent));
  await page.click('#agree-form button[type=submit]');
  ok("agreements: accepting without ticking says so", /Tick the box for each agreement/.test(await page.innerText("#agree-form")));
  await shot(page, "2-publish-agreements");
  await page.check('#agree-form input[name=cla]'); await page.check('#agree-form input[name=publisher]');
  await page.click('#agree-form button[type=submit]');
  await page.waitForSelector('#s-terms[data-state="done"]');
  ok("agreements: both accepted with one button", S.accepted.cla && S.accepted.publisher);

  /* 3. Install the hub on GitHub (the person leaves and comes back). */
  await page.waitForSelector('#s-install[data-state="current"]');
  ok("install: before it is installed, the page says what to do", await page.isVisible('[data-inst=none]') && (await page.getAttribute("#inst-link", "href")).startsWith("https://github.com/apps/"));
  await shot(page, "3-publish-install");
  S.installed = true;
  S.repos = [
    { id: 1, full_name: "alicedoe/notes", private: false, owner: { login: "alicedoe", type: "User" }, description: "Notes for WolOS", connected: null, note: null, owner_role: null, fill: { id: "alicedoe.notes", asset: "alicedoe.notes-*.wol", name: "Notes", summary: "Notes for WolOS", license: "" } },
    { id: 2, full_name: "alicedoe/dotfiles", private: true, owner: { login: "alicedoe", type: "User" }, description: "", connected: null, note: "private", owner_role: null, fill: { id: "alicedoe.dotfiles", asset: "alicedoe.dotfiles-*.wol", name: "Dotfiles", summary: "", license: "" } },
  ];
  await page.click('[data-act=inst-check]');
  await page.waitForSelector('#s-connect[data-state="current"]');
  ok("install: the step folds into one line saying how many", /Installed on 1 repository/.test(await page.innerText("#s-install")));

  /* 4. Connect: pick, say what it is, everything else filled in. */
  ok("connect: the public repository is chosen already", await page.isChecked('#repo-list input[type=radio]'));
  ok("connect: a private repository says why it cannot be used", /Private\. Make it public on GitHub to publish it\./.test(await page.innerText("#repo-list")));
  ok("connect: the id and file name are filled in", /alicedoe\.notes/.test(await page.innerText("#listed-as")) && /alicedoe\.notes-\*\.wol/.test(await page.innerText("#listed-as")));
  await page.check('#kind-pick input[value=plugin]');
  ok("connect: choosing a plugin changes the file name's ending", (await page.inputValue("#f-asset")) === "alicedoe.notes-*.wolplug");
  await page.check('#kind-pick input[value=app]');
  await page.click("#connect-go");
  await page.waitForFunction(() => /licence/i.test(document.querySelector("[data-err=connect]").textContent));
  ok("connect: a missing licence is asked for and the details open", /Give the licence as an SPDX expression/.test(await page.textContent("[data-err=connect]")) && (await page.$eval("#s-connect details", (d) => d.open)));
  await shot(page, "4-publish-connect");
  await page.fill("#f-license", "GPL-2.0-or-later");
  await page.click("#connect-go");
  await page.waitForSelector('#s-connect[data-state="done"]');
  ok("connect: the Worker got the repository, the kind, the file name and the licence", S.posted.repo === "alicedoe/notes" && S.posted.kind === "app" && S.posted.asset === "alicedoe.notes-*.wol" && S.posted.license === "GPL-2.0-or-later" && !("owner" in S.posted));

  /* 5. The tag: the three lines with the real names, and the page notices it. */
  await page.waitForSelector('#s-tag[data-state="current"]');
  const cmd = await page.textContent("#tag-cmd");
  ok("tag: the lines carry the real file name", cmd === "git tag v1.0.0 && git push origin v1.0.0\ngh release create v1.0.0 alicedoe.notes-1.0.0.wol", cmd);
  ok("tag: Copy copies them", (await page.getAttribute("#tag-copy", "data-copy")) === cmd);
  ok("tag: the page says it is waiting", await page.isVisible("#tag-wait"));
  await shot(page, "5-publish-tag");
  S.versions["1.0.0"] = "waiting-release";
  await page.waitForSelector("#tag-seen:not([hidden])", { timeout: 8000 });
  ok("tag: the page noticed the tag and links to its status", (await page.getAttribute("#tag-link", "href")) === "/status?l=alicedoe.notes&v=1.0.0");
  ok("publish: the page asked for the person and their data once, never /api/me", count(/^GET \/api\/me$/) === 0 && count(/^GET \/api\/my\/overview/) >= 1);

  /* 6. The status page: the stages move by themselves. */
  await page.click("#tag-link");
  await page.waitForSelector("#st-head:not([hidden])");
  ok("status: waiting for the release, with the sentence and what to do", /Waiting for your release/.test(await page.innerText("#st-head")) && /publish a release for v1\.0\.0/.test(await page.innerText("#st-head")));
  ok("status: four stages", (await page.$$("#st-track .tr")).length === 4);
  await shot(page, "6-status-waiting");
  S.versions["1.0.0"] = "checking";
  await page.waitForFunction(() => /Being checked/.test(document.getElementById("st-head").innerText), null, { timeout: 8000 });
  ok("status: checking, stage 2 is current", (await page.getAttribute("#st-track .tr:nth-child(2)", "data-state")) === "current");
  S.versions["1.0.0"] = "signing";
  await page.waitForFunction(() => /waiting to be signed/.test(document.getElementById("st-head").innerText), null, { timeout: 8000 });
  S.versions["1.0.0"] = "published";
  await page.waitForFunction(() => /^Published/.test(document.querySelector("#st-head h2").innerText), null, { timeout: 8000 });
  ok("status: published, four stages done, the signature line and the file", (await page.$$eval("#st-track .tr", (n) => n.map((x) => x.dataset.state))).join() === "done,done,done,done" && /Signed by WolOS Hub \(statement 3f2a91bc\)/.test(await page.innerText("#st-sig")) && /Your own signature: none/.test(await page.innerText("#st-sig")) && /alicedoe\.notes-1\.0\.0\.wol/.test(await page.innerText("#st-file")));
  ok("status: published has a link to the listing and no Check again", (await page.getAttribute('#st-head [data-slot=listing]', "href")) === "/apps/alicedoe.notes/" && !(await page.isVisible("[data-act=recheck]")));
  await shot(page, "7-status-published");

  /* 7. A release without its file: the sentence, and Check again. */
  S.versions["1.1.0"] = "no-asset";
  await page.goto(srv.base + "/status?l=alicedoe.notes&v=1.1.0", { waitUntil: "load" });
  await page.waitForSelector("#st-head:not([hidden])");
  ok("no file: the exact sentence and the fix", /The release v1\.0\.0 has no file named alicedoe\.notes-\*\.wol\./.test(await page.innerText("#st-head")) && /Attach the file to the release on GitHub, then press Check again\./.test(await page.innerText("#st-head")));
  ok("no file: the first stage is red", (await page.getAttribute("#st-track .tr:nth-child(1)", "data-state")) === "failed");
  await shot(page, "8-status-no-file");
  await page.click("[data-act=recheck]");
  await page.waitForFunction(() => /Being checked/.test(document.getElementById("st-head").innerText), null, { timeout: 8000 });
  ok("no file: Check again asked the Worker for that tag", S.rechecked === "v1.1.0", S.rechecked);

  /* 8. A blocked version: what the check found, and the command to publish the fix. */
  S.versions["1.2.0"] = "blocked";
  await page.goto(srv.base + "/status?l=alicedoe.notes&v=1.2.0", { waitUntil: "load" });
  await page.waitForSelector("#st-find:not([hidden])");
  ok("blocked: the findings are listed", /The package asks to read all your files\./.test(await page.innerText("#st-find")));
  ok("blocked: the next version's lines are ready", (await page.textContent("#st-cmd")) === "git tag v1.2.1 && git push origin v1.2.1\ngh release create v1.2.1 alicedoe.notes-1.2.1.wol");
  await shot(page, "9-status-blocked");
  await page.goto(srv.base + "/status?l=alicedoe.notes&v=9.9.9", { waitUntil: "load" });
  await page.waitForFunction(() => /no such version/i.test(document.body.innerText));
  ok("unknown version: a plain sentence", /The hub has no version or tag with that name/.test(await page.innerText("#st")));

  /* 9. The dashboard: everything in one place, one question to the Worker. */
  S.calls.length = 0;
  await page.goto(srv.base + "/dashboard", { waitUntil: "load" });
  await page.waitForSelector("#d-listings .dl");
  await page.waitForFunction(() => document.querySelectorAll("#d-agreements .agr").length > 0);
  ok("dashboard: needs your attention lists the blocked version with a link", /Notes 1\.2\.0 was not listed\./.test(await page.innerText("#d-att")) && (await page.getAttribute("#d-att a", "href")) === "/status?l=alicedoe.notes&v=1.2.0");
  ok("dashboard: the listing, its latest version's track and its versions link to their status", (await page.$$("#d-listings .dl .track-sm .tr")).length === 4 && (await page.getAttribute("#d-listings .dv a", "href")).startsWith("/status?l=alicedoe.notes&v="));
  ok("dashboard: one question to the Worker for the whole page (never /api/me, no list of calls)", count(/^GET \/api\/my\/overview/) === 1 && count(/^GET \/api\/me$/) === 0 && count(/^GET \/api\/(my\/listings|cert|certs|orgs)/) === 0, S.calls.join(" | "));
  await shot(page, "10-dashboard");
  ok("no script errors", problems.length === 0, problems.join("; "));

  /* 10. Time to usable: the outline is on screen before any answer, and the data lands after one round trip. */
  {
    const p2 = await ctx.newPage(); await speed(p2);
    await p2.addInitScript(() => { try { localStorage.setItem("hub-who", JSON.stringify({ login: "alicedoe", name: "Alice Doe", avatar: null })); } catch (e) {} });
    const t0 = Date.now();
    await p2.goto(srv.base + "/publish", { waitUntil: "commit" });
    await p2.waitForSelector(".rail-item");
    const outline = Date.now() - t0;
    await p2.waitForSelector('#s-tag[data-state="current"]');
    const usable = Date.now() - t0;
    console.log(`time: outline ${outline} ms, steps filled in ${usable} ms (each answer from the Worker waits ${LAT} ms)`);
    ok("speed: the outline is there before the first answer could be", outline < LAT + 150, String(outline));
    ok("speed: the page is usable after about one round trip", usable < LAT * 4 + 400, String(usable));
    const reposAsked = count(/^GET \/api\/repos/);
    ok("speed: a signed-in tab asks for the repositories beside the person's answer", reposAsked >= 1);
    await p2.close();
  }

  /* 10b. Another person on the same tab: a kept overview of someone else is never drawn, whatever key it sits under. */
  {
    S.in = true;
    const ov = await (await fetch(srv.base + "/api/my/overview")).json();
    const p3 = await ctx.newPage(); await speed(p3);
    await p3.addInitScript((o) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("hub-who", JSON.stringify({ login: "mallory", name: "Mallory", avatar: null }));
      sessionStorage.setItem("hub-snap:", JSON.stringify(o)); sessionStorage.setItem("hub-snap:repos", JSON.stringify({ installed: true, repos: [] }));   /* the old, person-less keys */
      sessionStorage.setItem("hub-snap:mallory|", JSON.stringify(o));   /* alice's overview under mallory's key */
      sessionStorage.setItem("hub-snap:alicedoe|", JSON.stringify(o));  /* and under her own key, which is not the kept person */
    }, ov);
    S.latency = 700;
    await p3.goto(srv.base + "/publish", { waitUntil: "commit" });
    await p3.waitForSelector(".rail-item");
    await p3.waitForTimeout(350);
    const early = await p3.evaluate(() => document.querySelector("main").innerText + " " + document.getElementById("who").innerText);
    ok("another person's kept overview is not drawn while the answer is awaited", !/alicedoe|Alice Doe/.test(early) && !!(await p3.$("[data-pending]")), early.slice(0, 120));
    await p3.waitForFunction(() => /alicedoe/.test(document.getElementById("s-signin").innerText), null, { timeout: 5000 });
    ok("the answer replaces the page and the other person's kept data is forgotten", await p3.evaluate(() => sessionStorage.getItem("hub-snap:mallory|") === null));
    S.latency = LAT;
    await p3.close();
  }

  /* 11. The admin queue: one click for approve, a reason field on the row for the rest. */
  S.admin.revocations = [{ id: "v-1", group: "g-1", serial: "3f2a91bc", action: "revoke", reason: "abuse", note: "counterfeit", status: "pending", approved_by: ["carol"], created_at: hub.T }];
  S.admin.attention = [{ listing: { id: "alicedoe.notes", name: "Notes", owner: "alicedoe" }, version: "1.2.0", verdict: "block", first_seen: hub.T, checked_at: hub.T, findings: ["The package asks to read all your files."] }];
  await page.goto(srv.base + "/admin", { waitUntil: "load" });
  await page.waitForSelector(".adm-row");
  ok("admin: the versions to look at are in the queue", /Versions to look at \(1\)/.test(await page.innerText("main")) && /blocked by the check/.test(await page.innerText("main")));
  await shot(page, "11-admin-queue");
  await page.click('.adm-row:has-text("Dave Roe") button:has-text("Approve")');
  await page.waitForFunction(() => /Approved\. The certificate/.test(document.body.innerText));
  ok("admin: Approve is one click, no dialog", S.admin.done[0][0] === "approve" && S.admin.done[0][1] === "r-1" && (await page.$$("dialog")).length === 0);
  await page.click('.adm-row:has-text("3f2a91bc") button:has-text("Approve the revocation")');
  ok("admin: the second approval of a revocation is not one click: it asks for a reason on the row first", S.admin.done.length === 1 && await page.isVisible('.adm-row:has-text("3f2a91bc") textarea'));
  await page.fill('.adm-row:has-text("3f2a91bc") textarea', "Confirmed.");
  await page.click('.adm-row:has-text("3f2a91bc") form button[type=submit]');
  await page.waitForFunction(() => document.querySelectorAll(".adm-done").length === 2);
  ok("admin: the second approval travels with its reason", S.admin.done[1][0] === "second" && S.admin.done[1][2].note === "Confirmed.", JSON.stringify(S.admin.done[1]));
  await page.click('.adm-row:has-text("Notes 1.2.0") button:has-text("Withdraw version")');
  ok("admin: Withdraw opens a reason field on the row", await page.isVisible('.adm-row:has-text("Notes 1.2.0") textarea'));
  await page.fill('.adm-row:has-text("Notes 1.2.0") textarea', "It reads every file.");
  await page.click('.adm-row:has-text("Notes 1.2.0") form button[type=submit]');
  await page.waitForFunction(() => document.querySelectorAll(".adm-done").length === 3);
  ok("admin: the reason travels with the action", S.admin.done[2][0] === "withdraw" && S.admin.done[2][3].reason === "It reads every file.", JSON.stringify(S.admin.done[2]));
  /* 12. Session hardening in the panel: the header says how fresh the sign-in is; the People, Audit and Health tabs are a second
     script loaded when one opens, each with its outline first; Ban asks for a reason on the row and sends it. */
  ok("admin: the header says how long the sign-in stays fresh and offers Sign in again", /Sign-in fresh for 12 mins/.test(await page.innerText("#adm-fresh")) && (await page.getAttribute("#adm-fresh a", "href")).startsWith("/auth/login?reauth=1&next="));
  const scriptsBefore = (await page.$$("script")).length;
  await page.click('nav[aria-label="Admin"] a[data-v="users"]');
  ok("admin: the People tab loads its script when it opens", (await page.$$("script")).length === scriptsBefore + 1);
  await page.waitForSelector("#us-q");
  await page.fill("#us-q", "mal");
  await page.click('form.adm-find button[type=submit]:has-text("Search")');
  await page.waitForSelector('.adm-row:has-text("Mal Lory")');
  await page.click('.adm-row:has-text("Mal Lory") button:has-text("Open")');
  await page.waitForSelector('.adm-row:has-text("Mal Lory") button:has-text("Ban")');
  const personText = await page.innerText("main");
  ok("admin: the person's page shows their signed-in browsers, a moved one marked, and their listings", /Chrome on Android/.test(personText) && /Moved to 203\.0\.113\.0\/24/.test(personText) && /mallory\.tool/.test(personText));
  await page.click('.adm-row:has-text("Mal Lory") button:has-text("Ban")');
  ok("admin: Ban opens a reason field on the row", await page.isVisible('.adm-row:has-text("Mal Lory") textarea'));
  await page.fill('.adm-row:has-text("Mal Lory") textarea', "Uploads malware.");
  await page.click('.adm-row:has-text("Mal Lory") form button[type=submit]');
  await page.waitForFunction(() => /mallory is banned/.test(document.body.innerText));
  ok("admin: the ban travels with its reason", S.admin.done[3][0] === "ban" && S.admin.done[3][1] === "5310009" && S.admin.done[3][2].reason === "Uploads malware.", JSON.stringify(S.admin.done[3]));
  await shot(page, "12-admin-people");
  await page.click('nav[aria-label="Admin"] a[data-v="audit"]');
  await page.waitForSelector("[data-view=audit] .adm-audit li");
  ok("admin: the audit trail shows the place and the session of each entry, and flagged results", /198\.51\.100\.0\/24, GRU, session abcdef012345/.test(await page.innerText("[data-view=audit] .adm-audit")) && /flagged/.test(await page.innerText("[data-view=audit] .adm-audit")));
  await page.fill("#au-action", "session.");
  await page.click('form.adm-filters button[type=submit]');
  await page.waitForFunction(() => document.querySelectorAll("[data-view=audit] .adm-audit li").length === 1);
  ok("admin: the filter narrows the trail and the export link carries it", /session\.moved/.test(await page.innerText("[data-view=audit] .adm-audit")) && (await page.getAttribute('a:has-text("Export as a file")', "href")) === "/api/admin/audit/export?action=session.");
  await page.click('nav[aria-label="Admin"] a[data-v="health"]');
  await page.waitForFunction(() => /3 in all, 1 used the panel/.test(document.body.innerText));
  ok("admin: Health shows the sessions and the limits", /sign-in: 12 requests over 4 keys/.test(await page.innerText("main")));
  ok("admin: only one second script was loaded for the three tabs", (await page.$$("script")).length === scriptsBefore + 1);
  ok("no script errors on the admin page", problems.length === 0, problems.join("; "));
  await ctx.close();
} finally {
  await browser.close();
  srv.close();
}
if (failures.length) { console.error(`publish-journey: ${failures.length} failed`); process.exit(1); }
console.log("publish-journey: all passed");
