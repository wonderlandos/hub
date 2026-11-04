// SPDX-License-Identifier: GPL-2.0-or-later
// Spacing sweep over every signed-in hub page (lead 2026-11-04: "a lot of components without padding, like Where you are
// signed in"): the dashboard, publish (with the repository picker), a version's status and the admin tabs, at 390, 768 and
// 1440 px, light and dark, over tests/lib/mock-hub.mjs. Needs a built dist/ (`npm run build:review`). It fails when
//   - the text of any card, list row or table cell comes closer than 8 px to that box's border (each text line's rectangle
//     against the box's border edge, on all four sides; a box that scrolls inside is measured at its visible edges only);
//   - something is drawn like a card (a border all round, a radius, its own background) without one of the shared classes;
//   - the page scrolls sideways.
// Run: node tests/layout-sweep.mjs   (PLAYWRIGHT_CORE and CHROME as scripts/lib/browser.mjs says)
import { launch, serve } from "../scripts/lib/browser.mjs";
import { at } from "../scripts/lib/paths.mjs";
import { mockHub } from "./lib/mock-hub.mjs";

const hub = mockHub({ latency: 0 });
const S = hub.S;
const L = (id, name) => ({ id, name, summary: "", kind: "app", host: null, repo: id.replace(".", "/"), asset: `${id}-*.wol`, license: "MIT", status: "draft", created_at: hub.T });
S.in = true; S.accepted = { cla: true, publisher: true }; S.orgs = ["wonderlandos"];
S.listings = [L("alicedoe.notes", "Notes")]; S.versions = { "1.0.0": "published", "1.1.0": "blocked" };
S.repos = Array.from({ length: 40 }, (_, i) => ({ id: 100000 + i, full_name: `alicedoe/project-${i}`, private: false, owner: { login: "alicedoe", type: "User", id: 5310001 }, description: "A project", connected: null, note: null, owner_role: null, app: i % 2 === 0, pushed_at: 1790000000 + i,
  fill: { id: `alicedoe.project-${i}`, asset: `alicedoe.project-${i}-*.wol`, name: `Project ${i}`, summary: "", license: "MIT" } }));
S.admin.attention = [{ listing: { id: "alicedoe.notes", name: "Notes", owner: "alicedoe" }, version: "1.1.0", verdict: "block", first_seen: hub.T, checked_at: hub.T, findings: ["The package asks to read all your files."] }];

const srv = await serve(process.env.DIST || at("dist"), hub.handler);
const browser = await launch();
const failures = [];
const ok = (name, cond, extra = "") => { console.log(`${cond ? "ok  " : "FAIL"} ${name}${!cond && extra ? ` (${extra})` : ""}`); if (!cond) failures.push(name); };

/* The pages and what to wait for (and, for publish, a step to open so the picker is on screen). */
const PAGES = [
  ["/dashboard", "#d-sessions li"],
  ["/publish?more=1", "#repo-list .vrow", async (p) => { await p.click("[data-act=more]").catch(() => {}); await p.waitForSelector('#s-connect[data-state="current"] #repo-list .vrow'); }],
  ["/status?l=alicedoe.notes&v=1.1.0", "#st-find:not([hidden])"],
  ["/admin#queue", ".adm-row"],
  ["/admin#users", "#us-q"],
  ["/admin#listings", "[data-view=listings]:not([data-pending])"],
  ["/admin#audit", "[data-view=audit] .adm-audit li"],
  ["/admin#health", "[data-view=health]:not([data-pending])"],
];
/* What counts as a box with text to keep away from its border, and the shared classes a card-looking thing may have. */
const BOXES = ".card:not(.dash-rows):not(.hist):not(.adm-audit):not(.picker), .vrow, .dash-rows > li, .hist > li, .adm-audit > li, .hub-table td, .hub-table th";
const SHARED = ["card", "btn", "badge", "seg", "seg-lg", "find", "find-lg", "code", "term", "tile", "short", "vlist", "vrow", "agreement-short", "copy", "pick", "repo", "skel", "who-me", "theme"];

function measure({ BOXES, SHARED }) {
  const out = { tight: [], stray: [] };
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && !e.closest("[hidden]"); };
  const name = (e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}.${[...e.classList].join(".")}`;
  for (const box of document.querySelectorAll(BOXES)) {
    if (!vis(box)) continue;
    const b = box.getBoundingClientRect(), cs = getComputedStyle(box);
    const edge = { l: b.left + parseFloat(cs.borderLeftWidth), r: b.right - parseFloat(cs.borderRightWidth), t: b.top + parseFloat(cs.borderTopWidth), btm: b.bottom - parseFloat(cs.borderBottomWidth) };
    const scrolls = box.scrollHeight > box.clientHeight + 1 && /auto|scroll/.test(cs.overflowY);
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    let min = { l: 1e9, r: 1e9, t: 1e9, btm: 1e9 }, any = false, who = {};
    for (let n; (n = walker.nextNode());) {
      const host = n.parentElement;
      if (!vis(host) || host.closest(".sr")) continue;
      /* A nested box measures its own text (a row inside a card, a button's label inside its own padding). */
      const inner = host.closest(BOXES + ", .btn, .badge, .seg, button, input, textarea, select, code, pre, .tile");
      if (inner && inner !== box && box.contains(inner)) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) {
        if (r.width < 1 || r.bottom <= edge.t || r.top >= edge.btm) continue;
        if (scrolls && (r.top < edge.t || r.bottom > edge.btm)) continue;
        any = true;
        const d = { l: r.left - edge.l, r: edge.r - r.right, t: r.top - edge.t, btm: edge.btm - r.bottom };
        for (const k in d) if (d[k] < min[k]) { min[k] = d[k]; who[k] = n.textContent.trim().slice(0, 30); }
      }
    }
    if (!any) continue;
    for (const k in min) if (min[k] < 8 - 0.5 && !(scrolls && (k === "t" || k === "btm"))) out.tight.push(`${name(box)} ${k}=${min[k].toFixed(1)}px "${who[k]}"`);
  }
  /* Card-looking without a shared class: a border all round, a radius of 8 or more, its own background. */
  for (const e of document.querySelectorAll("main *")) {
    if (!vis(e)) continue;
    const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    if (r.width < 120 || r.height < 40 || /^(INPUT|TEXTAREA|SELECT|BUTTON|IMG|PRE|CODE|DETAILS|SUMMARY)$/.test(e.tagName)) continue;
    const border = ["Top", "Right", "Bottom", "Left"].every((s) => parseFloat(cs[`border${s}Width`]) >= 1 && cs[`border${s}Style`] !== "none");
    const bg = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
    if (border && bg && parseFloat(cs.borderTopLeftRadius) >= 8 && !SHARED.some((c) => e.classList.contains(c)) && !e.closest(".card, .btn, .seg"))
      out.stray.push(name(e));
  }
  out.sideways = document.documentElement.scrollWidth > window.innerWidth + 1;
  return out;
}

try {
  for (const w of [390, 768, 1440]) for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme });
    await ctx.addInitScript(() => { try { localStorage.setItem("hub-who", JSON.stringify({ login: "alicedoe", name: "Alice Doe", avatar: null, admin: true })); } catch (e) {} });
    const page = await ctx.newPage();
    for (const [path, ready, prep] of PAGES) {
      await page.goto(srv.base + path, { waitUntil: "load" });
      if (path.startsWith("/admin#")) await page.reload({ waitUntil: "load" });
      if (prep) await prep(page); else await page.waitForSelector(ready, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(150);
      const m = await page.evaluate(measure, { BOXES, SHARED });
      const tag = `${path} ${w} ${scheme}`;
      ok(`${tag}: every card, row and cell keeps its text 8 px or more from its border`, m.tight.length === 0, m.tight.slice(0, 6).join(" | "));
      ok(`${tag}: nothing card-like outside the shared classes`, m.stray.length === 0, m.stray.slice(0, 6).join(" | "));
      ok(`${tag}: no sideways scrolling`, !m.sideways);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.close();
}
if (failures.length) { console.error(`layout-sweep: ${failures.length} failed`); process.exit(1); }
console.log("layout-sweep: all passed");
