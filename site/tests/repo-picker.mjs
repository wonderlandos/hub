// SPDX-License-Identifier: GPL-2.0-or-later
// Browser test of the repository picker on /publish (steps 3 and 4) with a person who has 300 repositories and an
// organisation with 200 (lead 2026-11-04: "what happens in the component if the person has 200-300 repositories").
// Headless Chromium over tests/lib/mock-hub.mjs; needs a built dist/ (`npm run build:review`). It proves: a skeleton while
// GitHub's list is read; the list drawn in under 100 ms once it is here; at most about 30 rows in the page whatever the
// length; installed and connected first; the search filters as one types; Connect is one click; Install and connect goes to
// GitHub's address for exactly that repository with `state`, and coming back connects it; the organisation tab; the empty
// and the error sentences; one overview question per page; no sideways scrolling at 390 px.
// Run: node tests/repo-picker.mjs   (PLAYWRIGHT_CORE and CHROME as scripts/lib/browser.mjs says; SHOTS=/some/folder for screens)
import { launch, serve } from "../scripts/lib/browser.mjs";
import { at } from "../scripts/lib/paths.mjs";
import { mockHub } from "./lib/mock-hub.mjs";

const hub = mockHub({ latency: 40 });
const S = hub.S;
const srv = await serve(process.env.DIST || at("dist"), hub.handler);
const browser = await launch();
const failures = [];
const ok = (name, cond, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${name}${!cond && extra ? ` (${extra})` : ""}`); if (!cond) failures.push(name); };
const SHOTS = process.env.SHOTS;
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };
const count = (re) => S.calls.filter((c) => re.test(c)).length;
const R = (owner, type, i, app) => ({ id: (type === "User" ? 1 : 2) * 100000 + i, full_name: `${owner}/project-${String(i).padStart(3, "0")}`, private: false, owner: { login: owner, type, id: type === "User" ? 5310001 : 348106055 },
  description: `Project number ${i}, a longer description that would not fit on a phone in one line`, connected: null, note: type === "User" ? null : "org-not-linked", owner_role: type === "User" ? null : "owner", app, pushed_at: 1790000000 + i * 3600,
  fill: { id: `${owner}.project-${i}`, asset: `${owner}.project-${i}-*.wol`, name: `Project ${i}`, summary: `Project number ${i}`, license: "MIT" } });

S.in = true; S.accepted = { cla: true, publisher: true }; S.orgs = ["wonderlandos"]; S.installed = false;
S.repos = Array.from({ length: 300 }, (_, i) => R("alicedoe", "User", i, i % 2 === 0));
S.orgRepos = { wonderlandos: Array.from({ length: 200 }, (_, i) => R("wonderlandos", "Organization", i, false)) };
const rows = (page) => page.$$eval("#repo-list .vrow", (n) => n.length);

try {
  for (const [w, scheme] of [[1280, "light"], [390, "dark"]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme });
    await ctx.addInitScript(() => { try { localStorage.setItem("hub-who", JSON.stringify({ login: "alicedoe", name: "Alice Doe", avatar: null })); } catch (e) {} });
    const page = await ctx.newPage();
    const problems = []; page.on("pageerror", (e) => problems.push(e.message));
    S.calls.length = 0; S.reposDelay = 900;
    await page.goto(srv.base + "/publish", { waitUntil: "load" });
    await page.waitForSelector("#repo-skel:not([hidden])", { timeout: 3000 }).catch(() => {});
    ok(`${w}: a skeleton while the list is read`, await page.isVisible("#repo-skel"));
    S.reposDelay = 0;
    await page.waitForSelector('#s-connect[data-state="current"] #repo-list .vrow', { timeout: 8000 });
    const ms = await page.evaluate(() => performance.getEntriesByName("hub-repos", "measure").map((m) => m.duration));
    ok(`${w}: 300 repositories drawn in under 100 ms (${ms.map((x) => x.toFixed(1)).join(", ")} ms)`, ms.length > 0 && Math.max(...ms) < 100);
    ok(`${w}: at most 30 rows in the page for 300`, (await rows(page)) <= 30, String(await rows(page)));
    ok(`${w}: the count says how many and how many have WolOS Hub`, /300 repositories, 150 with WolOS Hub/.test(await page.innerText("#repo-count")));
    const firstRows = await page.$$eval("#repo-list .vrow", (n) => n.slice(0, 3).map((x) => x.innerText));
    ok(`${w}: installed first, the newest push first`, /project-298/.test(firstRows[0]) && /WolOS Hub installed/.test(firstRows[0]), firstRows[0]);
    ok(`${w}: one overview question for the page`, count(/^GET \/api\/my\/overview/) === 1, S.calls.join(" | "));
    ok(`${w}: no sideways scrolling`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.$eval("#s-connect", (n) => n.scrollIntoView());
    await shot(page, `picker-${w}-${scheme}`);

    /* Scroll to the end: the last rows, still few in the page. */
    await page.$eval("#repo-list", (b) => { b.scrollTop = b.scrollHeight; });
    await page.waitForFunction(() => /project-299/.test(document.getElementById("repo-list").innerText) || /project-001/.test(document.getElementById("repo-list").innerText));
    ok(`${w}: scrolled to the end, the last ones are drawn and still at most 30 rows`, (await rows(page)) <= 30 && /project-001/.test(await page.innerText("#repo-list")));

    /* Search as one types. */
    await page.fill("#repo-q", "project-12");
    const found = await page.$$eval("#repo-list .vrow", (n) => n.map((x) => x.dataset.repo));
    ok(`${w}: the search keeps only matching names`, found.length === 10 && found.every((x) => x.includes("project-12")), found.join());
    ok(`${w}: the count says how many are shown`, /^10 shown/.test(await page.innerText("#repo-count")));
    await page.fill("#repo-q", "zzz");
    ok(`${w}: no match is a plain sentence`, await page.isVisible("#repo-empty") && /No repository has that in its name\./.test(await page.innerText("#repo-empty")));
    await page.fill("#repo-q", "project-299");

    /* Not installed: GitHub's address for exactly that repository, with the step and the repository in `state`. */
    const href = await page.getAttribute('#repo-list .vrow[data-repo="alicedoe/project-299"] a[data-act=install-connect]', "href");
    ok(`${w}: Install and connect goes to GitHub for exactly that repository and comes back to this step`, href === "https://github.com/apps/wolos-hub/installations/new/permissions?target_id=5310001&repository_ids[]=100299&state=connect.100299.app", href);
    await page.fill("#repo-q", "");

    /* The organisation tab. */
    await page.click('#repo-tabs a:has-text("wonderlandos")');
    await page.waitForFunction(() => /wonderlandos\/project-199/.test(document.getElementById("repo-list").innerText));
    ok(`${w}: the organisation tab lists its repositories and the address names it`, /as=wonderlandos/.test(page.url()) && (await rows(page)) <= 30 && /200 repositories/.test(await page.innerText("#repo-count")));
    ok(`${w}: an organisation not linked yet offers Link on each row`, /Link wonderlandos/.test(await page.innerText("#repo-list")));
    await page.click('#repo-tabs a:has-text("alicedoe")');
    await page.waitForFunction(() => /alicedoe\/project-298/.test(document.getElementById("repo-list").innerText));
    ok(`${w}: no script errors`, problems.length === 0, problems.join("; "));
    await ctx.close();
  }

  /* Connect is one click on an installed row. */
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(srv.base + "/publish", { waitUntil: "load" });
    await page.waitForSelector('#repo-list .vrow[data-repo="alicedoe/project-296"] [data-act=connect-row]');
    await page.click('#repo-list .vrow[data-repo="alicedoe/project-296"] [data-act=connect-row]');
    await page.waitForSelector('#s-connect[data-state="done"]');
    ok("Connect on a row connects that repository in one click", S.posted && S.posted.repo === "alicedoe/project-296" && S.posted.license === "MIT", JSON.stringify(S.posted));

    /* Back from GitHub after Install and connect: the repository is installed now and is connected without another click. */
    S.repos.find((r) => r.id === 100299).app = true;
    await page.goto(srv.base + "/publish?installation_id=77&setup_action=install&state=connect.100299.plugin", { waitUntil: "load" });
    await page.waitForFunction(() => document.getElementById("s-connect").dataset.state === "done" && /alicedoe\.project-299/.test(document.getElementById("s-connect").innerText), null, { timeout: 8000 }).catch(() => {});
    ok("back from GitHub: the repository is connected as what was chosen, without another click", S.posted.repo === "alicedoe/project-299" && S.posted.kind === "plugin" && S.posted.asset === "alicedoe.project-299-*.wolplug", JSON.stringify(S.posted));
    ok("back from GitHub: the address is clean again", !/state=|installation_id/.test(page.url()), page.url());
    await ctx.close();
  }

  /* Empty and error. */
  {
    S.listings = []; S.repos = []; S.installed = false;
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(srv.base + "/publish", { waitUntil: "load" });
    await page.waitForSelector('#s-install[data-state="current"] [data-inst=empty]:not([hidden])', { timeout: 6000 }).catch(() => {});
    ok("no public repository: step 3 says so in plain words", await page.isVisible("[data-inst=empty]") && /no public repository on GitHub yet/.test(await page.innerText("#s-install")));
    S.reposFail = true;
    await page.click('#repo-tabs a:has-text("wonderlandos")').catch(() => {});
    await page.goto(srv.base + "/publish?as=wonderlandos", { waitUntil: "load" });
    await page.waitForSelector("#repo-error:not([hidden])", { timeout: 6000 }).catch(() => {});
    ok("GitHub not answering: the picker says so and offers Try again", await page.isVisible("#repo-error") && /GitHub is not answering/.test(await page.innerText("#repo-error")));
    await shot(page, "picker-error-390");
    S.reposFail = false;
    await page.click("[data-act=repos-again]");
    await page.waitForFunction(() => /wonderlandos\/project-199/.test(document.getElementById("repo-list").innerText), null, { timeout: 6000 }).catch(() => {});
    ok("Try again draws the list", /wonderlandos\/project-199/.test(await page.innerText("#repo-list")));
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.close();
}
if (failures.length) { console.error(`repo-picker: ${failures.length} failed`); process.exit(1); }
console.log("repo-picker: all passed");
