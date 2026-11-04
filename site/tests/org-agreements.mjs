// SPDX-License-Identifier: GPL-2.0-or-later
// Browser test of an organisation's own agreements (lead 2026-11-04: "who accepts the agreements for an organisation? does the
// owner's account count?" No: an owner accepts the CLA as the organisation, recorded on its own; the Publisher Agreement is
// the person's). Headless Chromium over tests/lib/mock-hub.mjs; needs a built dist/ (`npm run build:review`). It proves:
//   - the dashboard's account switcher says, beside each account, "agreements accepted" or "CLA pending";
//   - an organisation whose CLA is not accepted gets a card at the top of the dashboard: an owner of it gets "Accept as an
//     owner of <org>" (POST /api/orgs as the organisation, then the card goes), a member gets "Ask an owner of <org>" with the
//     owners the hub knows, and no button;
//   - the organisation's agreements list says who accepted it as an owner; the person's own says "accepted by you";
//   - /publish?as=<org> step 2: the card, then the organisation's CLA and the person's Publisher Agreement as two rows, each
//     with its state and its accept action, one "Accept and continue"; a member cannot get past step 2;
//   - the repository picker under the person's tab never lists an organisation's repository (lead's screenshot).
// Run: node tests/org-agreements.mjs   (PLAYWRIGHT_CORE and CHROME as scripts/lib/browser.mjs says; SHOTS=/some/folder for
// screens; DIST=/other/dist to run it against another build)
import { launch, serve } from "../scripts/lib/browser.mjs";
import { at } from "../scripts/lib/paths.mjs";
import { mockHub } from "./lib/mock-hub.mjs";

const hub = mockHub({ latency: 30 });
const S = hub.S;
const srv = await serve(process.env.DIST || at("dist"), hub.handler);
const browser = await launch();
const failures = [];
const ok = (name, cond, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${name}${!cond && extra ? ` (${extra})` : ""}`); if (!cond) failures.push(name); };
const SHOTS = process.env.SHOTS;
const shot = async (page, name, sel) => { if (!SHOTS) return; if (sel) await (await page.$(sel))?.screenshot({ path: `${SHOTS}/${name}.png` }); else await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const wait = (page, f, arg) => page.waitForFunction(f, arg, { timeout: 5000 }).catch(() => {});
const text = (page, sel) => page.$eval(sel, (n) => n.innerText).catch(() => "");
const visible = (page, sel) => page.isVisible(sel).catch(() => false);
const reset = () => {
  S.in = true; S.accepted = { cla: true, publisher: true }; S.orgs = ["wonderlandos", "acme", "readyorg"]; S.orgAccepted = [];
  S.orgInfo = { wonderlandos: { cla: false, owners: ["alicedoe"] }, acme: { role: "member", cla: false, owners: ["bob", "carol"] }, readyorg: { by: "bob" } };
};

try {
  reset();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("hub-who", JSON.stringify({ login: "alicedoe", name: "Alice Doe", avatar: null })); } catch (e) {} });
  const page = await ctx.newPage();
  const problems = []; page.on("pageerror", (e) => problems.push(e.message));

  /* 1. The switcher: each account with its agreement state. */
  await page.goto(srv.base + "/dashboard", { waitUntil: "load" });
  await page.waitForSelector("#d-accounts a", { timeout: 5000 }).catch(() => {});
  await wait(page, () => document.querySelectorAll("#d-agreements .agr").length > 0);
  const tabs = await page.$$eval("#d-accounts a", (a) => a.map((x) => x.innerText.replace(/\s+/g, " ").trim())).catch(() => []);
  ok("switcher: the person with their own state", tabs[0] === "alicedoe agreements accepted", tabs.join(" | "));
  ok("switcher: an organisation without its own CLA says CLA pending", tabs[1] === "wonderlandos CLA pending" && tabs[2] === "acme CLA pending", tabs.join(" | "));
  ok("switcher: an organisation with its CLA says agreements accepted", tabs[3] === "readyorg agreements accepted", tabs.join(" | "));
  ok("person: no organisation card on the person's own dashboard", !(await visible(page, "#d-orgcla")));
  ok("person: the agreements are the person's own (accepted by you)", /accepted by you/.test(await text(page, "#d-agreements")) && /count only for you/.test(await text(page, "#d-aintro")), await text(page, "#d-agreements"));
  await shot(page, "switcher", "#d-accounts");

  /* 2. An organisation the person owns: the card at the top, Accept as an owner accepts as the organisation. */
  await page.click('#d-accounts a:has-text("wonderlandos")');
  await wait(page, () => !document.getElementById("d-orgcla")?.hidden);
  const card = await text(page, "#d-orgcla");
  ok("owner: the card names the organisation and the version", /wonderlandos still needs to accept the Contributor Licence Agreement \(version 1\)/.test(card), card);
  ok("owner: the card is the first thing on the dashboard", await page.$eval("#d-orgcla", (n) => n === n.parentNode.firstElementChild).catch(() => false));
  ok("owner: the button says it accepts as an owner of the organisation", await visible(page, '#d-orgcla button:has-text("Accept as an owner of wonderlandos")'));
  ok("owner: no Ask an owner sentence for an owner", !(await visible(page, "#d-orgcla [data-org=member]")));
  await shot(page, "org-card-owner", "#d-orgcla");
  await page.click('#d-orgcla button:has-text("Accept as an owner of wonderlandos")').catch(() => {});
  await wait(page, () => document.getElementById("d-orgcla").hidden);
  ok("owner: accepting posts the organisation's acceptance (POST /api/orgs as wonderlandos, by alicedoe)", S.orgAccepted.length === 1 && S.orgAccepted[0].org === "wonderlandos" && S.orgAccepted[0].by === "alicedoe", JSON.stringify(S.orgAccepted));
  ok("owner: the card goes once it is accepted", !(await visible(page, "#d-orgcla")));
  await wait(page, () => /wonderlandos agreements accepted/.test(document.getElementById("d-accounts").innerText.replace(/\s+/g, " ")));
  ok("owner: the switcher follows (agreements accepted)", /wonderlandos agreements accepted/.test((await text(page, "#d-accounts")).replace(/\s+/g, " ")));
  await wait(page, () => /as an owner/.test(document.getElementById("d-agreements").innerText));
  const agr = await text(page, "#d-agreements");
  ok("organisation: its list says who accepted it as an owner", /accepted by alicedoe as an owner,/.test(agr), agr);
  ok("organisation: its list never says 'accepted by you'", !/accepted by you/.test(agr));
  ok("organisation: the intro says members' acceptances do not count for it", /do not count for it/.test(await text(page, "#d-aintro")));

  /* 3. An organisation the person is only a member of: who to ask, no button. */
  await page.click('#d-accounts a:has-text("acme")');
  await wait(page, () => !document.getElementById("d-orgcla")?.hidden);
  const m = await text(page, "#d-orgcla");
  ok("member: the card names the organisation", /acme still needs to accept the Contributor Licence Agreement \(version 1\)/.test(m), m);
  ok("member: Ask an owner, with the owners' logins", /Ask an owner of acme to accept it: owners on the hub are bob, carol\./.test(m), m);
  ok("member: no accept button", !(await visible(page, "#d-orgcla [data-act=org-accept]")));
  await shot(page, "org-card-member", "#d-orgcla");
  ok("dashboard: no script errors", problems.length === 0, problems.join("; "));

  /* 4. /publish as the organisation: step 2 holds the card and two rows, one button. */
  reset();
  S.repos = [{ id: 1, full_name: "alicedoe/notes", private: false, owner: { login: "alicedoe", type: "User", id: 5310001 }, connected: null, note: null, app: true, fill: { id: "alicedoe.notes", asset: "alicedoe.notes-*.wol", name: "Notes", summary: "", license: "MIT" } }];
  S.orgRepos = { wonderlandos: [{ id: 2, full_name: "wonderlandos/hub-pipeline", private: false, owner: { login: "wonderlandos", type: "Organization", id: 348106055 }, connected: null, note: null, app: true, fill: { id: "wonderlandos.hub-pipeline", asset: "x-*.wol", name: "Hub pipeline", summary: "", license: "MIT" } }], acme: [] };
  await page.goto(srv.base + "/publish?as=wonderlandos", { waitUntil: "load" });
  await wait(page, () => document.getElementById("s-terms").dataset.state === "current" && !document.getElementById("org-cla")?.hidden);
  ok("publish as an organisation without its CLA: step 2 is open, the next steps wait", (await page.getAttribute("#s-terms", "data-state")) === "current" && (await page.getAttribute("#s-connect", "data-state")) === "todo");
  ok("publish: the card at step 2 names the organisation and the version", /wonderlandos still needs to accept the Contributor Licence Agreement \(version 1\)/.test(await text(page, "#org-cla")));
  const rows = await page.$$eval("#agree-rows > li", (l) => l.filter((x) => !x.closest("[hidden]")).map((x) => x.innerText.replace(/\s+/g, " ").trim())).catch(() => []);
  ok("publish: two rows, the organisation's CLA and the person's Publisher Agreement", rows.length === 2 && /^Contributor Licence Agreement for wonderlandos: not accepted yet, version 1/.test(rows[0]) && /^Publisher Agreement for you, alicedoe: accepted, version 1/.test(rows[1]), rows.join(" | "));
  ok("publish: the organisation's row accepts as an owner", await visible(page, '#agree-rows [data-row=org] label:has-text("Accept as an owner of wonderlandos")'));
  ok("publish: one Accept and continue button", (await page.$$('#agree-form button[type=submit]:visible')).length === 1);
  await shot(page, "publish-org-step2", "#s-terms");
  await page.check("#agree-rows input[name=org]").catch(() => {});
  await page.click("#agree-form button[type=submit]").catch(() => {});
  await wait(page, () => document.getElementById("s-terms").dataset.state === "done");
  ok("publish: Accept and continue accepts as the organisation and opens the next steps", S.orgAccepted.length === 1 && S.orgAccepted[0].org === "wonderlandos" && (await page.getAttribute("#s-terms", "data-state")) === "done", JSON.stringify(S.orgAccepted));

  /* 5. A member: step 2 says whom to ask and does not let them through. */
  await page.goto(srv.base + "/publish?as=acme", { waitUntil: "load" });
  await wait(page, () => document.getElementById("s-terms").dataset.state === "current" && !document.getElementById("org-cla")?.hidden);
  ok("publish as a member: step 2 stays open", (await page.getAttribute("#s-terms", "data-state")) === "current");
  ok("publish as a member: Ask an owner with the owners", /Ask an owner of acme to accept it: owners on the hub are bob, carol\./.test(await text(page, "#agree-rows")), await text(page, "#agree-rows"));
  ok("publish as a member: no accept box and no button to press", !(await visible(page, "#agree-rows input[name=org]")) && !(await visible(page, "#agree-form button[type=submit]")));

  /* 6. The person's tab lists the person's repositories only, whatever the answer holds (lead's screenshot). */
  S.repos.unshift({ id: 3, full_name: "wonderlandos/hub-pipeline", private: false, owner: { login: "wonderlandos", type: "Organization", id: 348106055 }, connected: null, note: null, app: true, description: "WolOS Hub pipeline", fill: { id: "wonderlandos.hub-pipeline", asset: "x-*.wol", name: "Hub pipeline", summary: "", license: "MIT" } });
  await page.goto(srv.base + "/publish", { waitUntil: "load" });
  await wait(page, () => /alicedoe\/notes/.test(document.getElementById("repo-list")?.innerText || ""));
  const list = await text(page, "#repo-list");
  ok("picker: the person's tab shows the person's repository", /alicedoe\/notes/.test(list), list);
  ok("picker: the person's tab never shows an organisation's repository", !/wonderlandos\/hub-pipeline/.test(list), list);
  ok("publish: no script errors", problems.length === 0, problems.join("; "));
  await ctx.close();
} finally {
  await browser.close();
  srv.close();
}
if (failures.length) { console.error(`org-agreements: ${failures.length} failed`); process.exit(1); }
console.log("org-agreements: all passed");
