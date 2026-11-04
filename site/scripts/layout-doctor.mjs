// SPDX-License-Identifier: GPL-2.0-or-later
// Layout doctor (lead 2026-11-04: "make code that checks padding and these things"): opens every page of a build in every
// state, at each width and in light and dark, measures every card, row, table cell, button group, form field and text block
// in the browser and fails on any of the rules below. The numbers and selectors are data (scripts/layout-doctor.tokens.json),
// so the same doctor can be pointed at another build (--dist, --tokens).
//
// Rules (one id each; a violation line names it):
//   card-padding    a card (the card selector, or anything drawn like one: a border all round, its own background, radius 8+)
//                   is padded 16 on every side; a list card (rows inside) 0
//   row-padding     a list row 12 x 16            cell-padding   a table cell 8 x 12
//   text-inset      a text line is 8 px or more inside the box that holds it (card, row, cell, field, anything with its own
//                   background or border; pills and buttons on the left and right only; the viewport edge when no box);
//                   a field's text (padding plus border) too
//   text-in-card    a text block (p, li, dd, .lead, td, th, headings) inside a card or row stays inside its content box
//   stacked-buttons two or more sibling buttons on separate lines while the next one fits beside the one before, in a
//                   container 480 px wide or more (a group is one row that wraps only when the width runs out)
//   pill-alone      a pill (.pill, .btn-quiet) alone on its line in such a stacked group
//   group-gap       the space between buttons of one group, across and between wrapped lines, and the group's flex gap, is 8
//   primary-first   the primary (solid) button comes before the quiet ones in its group
//   rhythm          vertical margins of cards and sections and the padding-block of sections on the 8 px grid; any other
//                   block's vertical margins on the 4 px grid; the row-gap of a column of cards or sections on the 8 px grid
//   text-gap        heading to its first paragraph, and paragraph to paragraph, on the 8 px grid
//   radius          every corner radius in {0, 8, 12, 16, 24, 9999}, fully round (half the shorter side), or a radius token
//   shadow          a box-shadow's outer layers are one of the three elevations (inset layers are highlights, not elevation)
//   row-heights     the rows of one list differ in height by 4 px or less
//   overflow        nothing sticks out of its parent (unless the parent clips or scrolls) or out of the viewport
//   font-size       every text is one of the type steps (read from the page's tokens, so fluid steps are exact per width)
//   type-pair       its line-height is that step's line (a fluid step: on the 4 px line grid, within the step's ratio)
//   measure         at 1440, body text (base size or smaller) runs 80 characters a line or fewer
// Output: one line per violation (page, state, width, theme, selector path, rule, measured vs expected) and a PNG of the
// element at 2x in --out (default .claude/tmp/layout-doctor/). Exit 1 on any violation not in the allowlist
// (scripts/layout-doctor.allow.json: [{ "rule", "selector" (a part of the path), "page"?, "reason" }], one reason each).
//
// Run: node scripts/layout-doctor.mjs [--dist DIR] [--tokens FILE] [--allow FILE] [--out DIR] [--only RULE,..]
//        [--pages /a,/b] [--widths 390,1440] [--no-shots] [--if-browser]
//   Needs a built dist/ (`npm run build:review`) and PLAYWRIGHT_CORE and CHROME as scripts/lib/browser.mjs says. With
//   --if-browser (npm run check) it says SKIPPED and exits 0 when there is no browser on the machine (the Pages deploy runner);
//   npm run test:browser always runs it.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { launch, serve } from "./lib/browser.mjs";
import { at } from "./lib/paths.mjs";
import { builtPages } from "./lib/visible.mjs";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(k);
const T = JSON.parse(readFileSync(resolve(opt("--tokens", at("scripts/layout-doctor.tokens.json"))), "utf8"));
const allowFile = resolve(opt("--allow", at("scripts/layout-doctor.allow.json")));
const ALLOW = existsSync(allowFile) ? JSON.parse(readFileSync(allowFile, "utf8")) : [];
const DIST = resolve(opt("--dist", process.env.DIST || at("dist")));
const OUT = resolve(opt("--out", process.env.LAYOUT_DOCTOR_OUT || ".claude/tmp/layout-doctor"));
const ONLY = opt("--only", "") ? new Set(opt("--only").split(",")) : null;
const WIDTHS = opt("--widths", "") ? opt("--widths").split(",").map(Number) : T.widths;
const PAGES = opt("--pages", "") ? new Set(opt("--pages").split(",")) : null;
const SHOTS = !flag("--no-shots");
const MAX_SHOTS = 400;

for (const a of ALLOW) if (!a.rule || !a.selector || !String(a.reason || "").trim()) { console.error(`layout-doctor: allowlist entry without rule, selector or reason: ${JSON.stringify(a)}`); process.exit(2); }
if (flag("--if-browser")) {
  const pw = process.env.PLAYWRIGHT_CORE || "/tmp/cw-tools/node_modules/playwright-core", ch = process.env.CHROME || "/tmp/cw-tools/chrome";
  if (!existsSync(pw) || !existsSync(ch)) { console.log(`layout-doctor: SKIPPED, no browser here (PLAYWRIGHT_CORE ${pw}, CHROME ${ch}); npm run test:browser runs it`); process.exit(0); }
}
if (!existsSync(resolve(DIST, "index.html"))) { console.error(`layout-doctor: no build at ${DIST} (npm run build:review)`); process.exit(2); }

/* ---------- the states: which pages to open, with what the Worker says ---------- */
const signedOut = builtPages(DIST);
async function scenario(name) {
  if (name !== "hub") return { make: () => ({ handler: null, S: null }), states: [{ state: "page", pages: signedOut, set: () => {} }] };
  const { mockHub } = await import("../tests/lib/mock-hub.mjs");
  const notes = (T0) => ({ id: "alicedoe.notes", name: "Notes", summary: "Notes for WolOS", kind: "app", host: null, repo: "alicedoe/notes", asset: "alicedoe.notes-*.wol", license: "MIT", status: "listed", created_at: T0 });
  const repos = () => Array.from({ length: 40 }, (_, i) => ({ id: 100000 + i, full_name: `alicedoe/project-${i}`, private: i === 3, owner: { login: "alicedoe", type: "User", id: 5310001 }, description: "A project", connected: null, note: i === 3 ? "private" : null, owner_role: null, app: i % 2 === 0, pushed_at: 1790000000 + i,
    fill: { id: `alicedoe.project-${i}`, asset: `alicedoe.project-${i}-*.wol`, name: `Project ${i}`, summary: "", license: "MIT" } }));
  const base = (S, T0, o = {}) => Object.assign(S, { in: true, panel: null, accepted: { cla: true, publisher: true }, installed: true, orgs: ["wonderlandos"], repos: repos(), listings: [notes(T0)], versions: { "1.0.0": "published", "1.1.0": "blocked" } }, o);
  const ATT = (T0) => [{ listing: { id: "alicedoe.notes", name: "Notes", owner: "alicedoe" }, version: "1.1.0", verdict: "block", first_seen: T0, checked_at: T0, findings: ["The package asks to read all your files."] }];
  const statusOf = (code) => ({ state: `status-${code}`, who: "member", pages: ["/status?l=alicedoe.notes&v=1.0.0"], set: (S, T0) => base(S, T0, { versions: { "1.0.0": code } }) });
  return {
    make: () => mockHub({ latency: 0 }),
    states: [
      { state: "signed-out", pages: signedOut, set: (S) => { S.in = false; } },
      { state: "signed-in", who: "member", pages: ["/", "/dashboard", "/publish", "/report"], set: (S, T0) => base(S, T0) },
      { state: "admin", who: "admin", pages: ["/dashboard", "/admin#queue", "/admin#users", "/admin#listings", "/admin#audit", "/admin#health"], set: (S, T0) => { base(S, T0, { panel: "owner" }); S.admin.attention = ATT(T0); } },
      { state: "admin-person", who: "admin", pages: ["/admin#users"], set: (S, T0) => base(S, T0, { panel: "owner" }),
        prep: async (p) => { await p.fill("#us-q", "mal"); await p.press("#us-q", "Enter"); await p.waitForSelector('.adm-row:has-text("Mal Lory")', { timeout: 4000 }).catch(() => {}); } },
      { state: "publish-terms", who: "member", pages: ["/publish"], set: (S, T0) => base(S, T0, { accepted: { cla: false, publisher: false }, installed: false, repos: [], listings: [], versions: {} }) },
      { state: "publish-install", who: "member", pages: ["/publish"], set: (S, T0) => base(S, T0, { installed: false, repos: [], listings: [], versions: {} }) },
      { state: "publish-connect", who: "member", pages: ["/publish"], set: (S, T0) => base(S, T0, { listings: [], versions: {} }) },
      { state: "publish-tag", who: "member", pages: ["/publish"], set: (S, T0) => base(S, T0, { versions: {} }) },
      ...["waiting-release", "no-asset", "checking", "signing", "published", "blocked"].map(statusOf),
    ],
  };
}

/* ---------- the measuring, in the page ---------- */
function doctor(T) {
  const tol = T.tolerance, SEL = T.select, V = [];
  const px = (v) => parseFloat(v) || 0;
  const add = (el, rule, measured, expected) => V.push({ el, rule, measured, expected });
  const scope = document.querySelector(SEL.scope) || document.body;
  const vis = (e) => {
    if (!(e instanceof Element) || e.closest(SEL.ignore) || e.closest("[hidden]")) return false;
    if (e.checkVisibility && !e.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) return false;
    for (let a = e; a.parentElement; a = a.parentElement) if (a.parentElement.tagName === "DETAILS" && !a.parentElement.open && a.tagName !== "SUMMARY") return false;
    const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(e); return cs.visibility !== "hidden" && px(cs.opacity) > 0;
  };
  const off = (v, g) => Math.abs(v - Math.round(v / g) * g) > tol;
  const near = (a, b) => Math.abs(a - b) <= tol;
  const r1 = (n) => Math.round(n * 10) / 10;
  /* probes: the tokens as this page computes them at this width and in this theme */
  const probe = (css) => { const d = document.createElement("div"); d.style.cssText = "position:absolute;visibility:hidden;left:0;top:0;width:60px;height:60px;" + css; document.body.appendChild(d); const cs = getComputedStyle(d); const o = { fs: px(cs.fontSize), lh: px(cs.lineHeight), sh: cs.boxShadow, rad: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius] }; d.remove(); return o; };
  const steps = T.type.steps.map((s) => { const p = probe(`font-size:var(${s.size});` + (s.line !== "fen" ? `line-height:var(${s.line});` : "")); return { name: s.size, size: p.fs, line: s.line === "fen" ? null : p.lh, ratio: s.ratio }; });
  const bodyMax = probe(`font-size:var(${T.type.bodyMax})`).fs;
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const elev = T.elevations.map((v) => norm(probe(`box-shadow:var(${v})`).sh));
  const radTok = T.radiusTokens.flatMap((v) => probe(`border-radius:var(${v})`).rad);
  const layers = (s) => { const out = []; let d = 0, cur = ""; for (const ch of s) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && d === 0) { out.push(cur); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur); return out.map(norm); };

  const all = [...scope.querySelectorAll("*")].filter(vis);
  const CS = new Map(all.map((e) => [e, getComputedStyle(e)]));
  const cs = (e) => CS.get(e) || getComputedStyle(e);
  const R = new Map(all.map((e) => [e, e.getBoundingClientRect()]));
  const rect = (e) => R.get(e) || e.getBoundingClientRect();
  const isInline = (e) => /^inline(?!-)/.test(cs(e).display) || cs(e).display === "inline";
  const transparent = (c) => c === "rgba(0, 0, 0, 0)" || c === "transparent";
  const borderAll = (e) => ["Top", "Right", "Bottom", "Left"].every((s) => px(cs(e)[`border${s}Width`]) >= 1 && cs(e)[`border${s}Style`] !== "none");
  const pillish = (e) => { const r = rect(e); return px(cs(e).borderTopLeftRadius) >= Math.min(r.width, r.height) / 2 - tol; };
  const control = (e) => e.matches(SEL.control);
  const cardLike = (e) => { const r = rect(e); return !control(e) && !/^(INPUT|TEXTAREA|SELECT|BUTTON|IMG|PRE|CODE|TABLE|TD|TH|TR)$/.test(e.tagName) && r.width >= 120 && r.height >= 40 && borderAll(e) && !transparent(cs(e).backgroundColor) && px(cs(e).borderTopLeftRadius) >= 8 - tol && !pillish(e); };
  const isCard = (e) => e.matches(SEL.card) || cardLike(e);
  const isRow = (e) => e.matches(SEL.row), isCell = (e) => e.matches(SEL.cell);
  const isBox = (e) => !isInline(e) && (isCard(e) || isRow(e) || isCell(e) || control(e) || borderAll(e) || (!transparent(cs(e).backgroundColor) && e !== document.body && e !== document.documentElement));
  const pad = (e) => { const c = cs(e); return [px(c.paddingTop), px(c.paddingRight), px(c.paddingBottom), px(c.paddingLeft)]; };
  const brd = (e) => { const c = cs(e); return [px(c.borderTopWidth), px(c.borderRightWidth), px(c.borderBottomWidth), px(c.borderLeftWidth)]; };
  const inner = (e, withPad) => { const r = rect(e), b = brd(e), p = withPad ? pad(e) : [0, 0, 0, 0]; return { t: r.top + b[0] + p[0], r: r.right - b[1] - p[1], b: r.bottom - b[2] - p[2], l: r.left + b[3] + p[3] }; };
  const ownText = (e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const clips = (e) => { const c = cs(e); return c.overflowX !== "visible" || c.overflowY !== "visible"; };

  /* padding of cards, list cards, rows, cells */
  const padRule = (e, rule, want) => { const p = pad(e); if (p.some((v, i) => !near(v, want[i]))) add(e, rule, p.map(r1).join(" "), want.join(" ")); };
  for (const e of all) {
    /* a frame round one picture is padded 0, like a list card */
    const kids = [...e.children].filter(vis), media = !ownText(e) && kids.length === 1 && /^(IMG|PICTURE|VIDEO|CANVAS)$/.test(kids[0].tagName);
    if (e.matches(SEL.listCard) || (media && cardLike(e))) padRule(e, "card-padding", T.padding.listCard);
    else if (isCard(e)) padRule(e, "card-padding", T.padding.card);
    if (isRow(e)) padRule(e, "row-padding", T.padding.row);
    if (isCell(e)) padRule(e, "cell-padding", T.padding.cell);
  }

  /* text lines against the box that holds them */
  const tight = new Map();
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? 1 : 3) });
  for (let n; (n = walker.nextNode());) {
    const host = n.parentElement; if (!host || !vis(host)) continue;
    let box = host; while (box && box !== scope && !isBox(box)) box = box.parentElement;
    if (box === scope || !box || box === document.body) box = null;
    const sides = box ? (control(box) || pillish(box) ? ["l", "r"] : ["t", "r", "b", "l"]) : ["l", "r"];
    const edge = box ? inner(box, false) : { t: 0, l: 0, r: innerWidth, b: 1e9 };
    const scrolls = box && box.scrollHeight > box.clientHeight + 1 && /auto|scroll/.test(cs(box).overflowY);
    /* what the clipping boxes between the text and its box let through */
    let clip = { t: -1e9, l: -1e9, r: 1e9, b: 1e9 };
    for (let a = host; a && a !== box && a !== scope; a = a.parentElement) if (clips(a)) { const q = inner(a, false); clip = { t: Math.max(clip.t, q.t), l: Math.max(clip.l, q.l), r: Math.min(clip.r, q.r), b: Math.min(clip.b, q.b) }; }
    const rg = document.createRange(); rg.selectNodeContents(n);
    for (const q0 of rg.getClientRects()) {
      const q = { t: Math.max(q0.top, clip.t), l: Math.max(q0.left, clip.l), r: Math.min(q0.right, clip.r), b: Math.min(q0.bottom, clip.b) };
      if (q.r - q.l < 1 || q.b - q.t < 1 || q.b <= edge.t || q.t >= edge.b) continue;
      if (scrolls && (q.t < edge.t || q.b > edge.b)) continue;
      const d = { t: q.t - edge.t, r: edge.r - q.r, b: edge.b - q.b, l: q.l - edge.l };
      for (const k of sides) {
        if (scrolls && (k === "t" || k === "b")) continue;
        if (d[k] < T.textInset - tol) { const key = box || host; const cur = tight.get(key) || {}; if (!(k in cur) || d[k] < cur[k][0]) cur[k] = [d[k], n.textContent.trim().slice(0, 24)]; tight.set(key, cur); }
      }
    }
  }
  for (const [e, m] of tight) add(e, "text-inset", Object.entries(m).map(([k, [v, t]]) => `${k}=${r1(v)} "${t}"`).join(" "), `>= ${T.textInset} on ${control(e) || pillish(e) ? "left and right" : "every side"}`);
  for (const e of all) if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) && !/^(checkbox|radio|hidden)$/.test(e.type) && px(cs(e).opacity) > 0.01) {
    const p = pad(e), b = brd(e), l = p[3] + b[3], r = p[1] + b[1];
    if (l < T.textInset - tol || r < T.textInset - tol) add(e, "text-inset", `field text left=${r1(l)} right=${r1(r)}`, `>= ${T.textInset}`);
  }
  /* text blocks inside the content box of their card or row */
  for (const e of all) {
    if (!e.matches(`${SEL.textBlock}, ${SEL.heading}`) || e.matches(SEL.cell)) continue;
    let c = e.parentElement; while (c && c !== scope && !(isCard(c) || isRow(c))) c = c.parentElement;
    if (!c || c === scope || clips(c)) continue;
    const q = inner(c, true), r = rect(e);
    const over = Math.max(q.l - r.left, r.right - q.r);
    if (over > tol) add(e, "text-in-card", `${r1(over)} px past the content box of ${c.tagName.toLowerCase()}.${[...c.classList].join(".")}`, "inside");
  }

  /* button groups */
  const btnOf = (c) => (c.matches(SEL.button) ? c : c.children.length === 1 && c.children[0].matches(SEL.button) && !ownText(c) ? c.children[0] : null);
  for (const P of all.concat(scope)) {
    const kids = [...P.children].filter(vis); let run = [];
    const runs = [];
    for (const k of kids) { const b = btnOf(k); if (b && vis(b)) run.push(b); else { if (run.length > 1) runs.push(run); run = []; } }
    if (run.length > 1) runs.push(run);
    for (const g of runs) {
      const rs = g.map((b) => b.getBoundingClientRect());
      const pc = inner(P, true), par = P.parentElement && P !== scope ? inner(P.parentElement, true) : pc;
      const availR = Math.max(pc.r, Math.min(par.r, innerWidth)), availW = availR - pc.l;
      const lines = []; rs.forEach((r, i) => { const L = lines.find((l) => r.top < l.b - 1 && r.bottom > l.t + 1); if (L) { L.items.push(i); L.t = Math.min(L.t, r.top); L.b = Math.max(L.b, r.bottom); } else lines.push({ t: r.top, b: r.bottom, items: [i] }); });
      let stacked = false;
      for (let i = 1; i < rs.length; i++) { const a = rs[i - 1], b = rs[i]; if (b.top >= a.bottom - 1 && a.right + T.buttonGap + b.width <= availR + tol) stacked = true; }
      if (stacked && availW >= T.groupMinWidth) {
        add(P, "stacked-buttons", `${g.length} buttons on ${lines.length} lines in ${r1(availW)} px`, "one row, wrapping only when the width runs out");
        for (const L of lines) if (L.items.length === 1 && g[L.items[0]].matches(SEL.pill)) add(g[L.items[0]], "pill-alone", "alone on its line", "in a row with its group");
      }
      const gaps = [];
      for (const L of lines) { const s = L.items.map((i) => rs[i]).sort((a, b) => a.left - b.left); for (let i = 1; i < s.length; i++) gaps.push(s[i].left - s[i - 1].right); }
      for (let i = 1; i < lines.length; i++) gaps.push(lines[i].t - lines[i - 1].b);
      const c = cs(P), flexy = /flex|grid/.test(c.display);
      const cg = c.columnGap === "normal" ? 0 : px(c.columnGap), rg2 = c.rowGap === "normal" ? 0 : px(c.rowGap);
      const badGaps = gaps.filter((d) => !near(d, T.buttonGap));
      if (badGaps.length || (flexy && (!near(cg, T.buttonGap) || (c.flexWrap === "wrap" && !near(rg2, T.buttonGap))))) add(P, "group-gap", `between buttons ${gaps.map(r1).join(", ")}${flexy ? `; gap ${r1(rg2)} ${r1(cg)}` : ""}`, String(T.buttonGap));
      const firstQuiet = g.findIndex((b) => b.matches(SEL.quiet)), lastPrimary = g.map((b) => b.matches(SEL.primary)).lastIndexOf(true);
      if (firstQuiet >= 0 && lastPrimary > firstQuiet) add(g[lastPrimary], "primary-first", `primary is button ${lastPrimary + 1} of ${g.length}, after a quiet one`, "primary first");
    }
  }

  /* vertical rhythm */
  for (const e of all) {
    const c = cs(e); if (isInline(e) || /table-cell|table-row/.test(c.display) || /absolute|fixed/.test(c.position)) continue;
    const big = isCard(e) || e.matches(SEL.section), g = big ? T.grid : T.inlineGrid;
    const m = [px(c.marginTop), px(c.marginBottom)];
    /* an item pushed to the end of its flex column (margin-top: auto) is aligned, not spaced */
    const par = e.parentElement; if (par && /flex/.test(cs(par).display) && /column/.test(cs(par).flexDirection) && Math.abs(rect(e).bottom - inner(par, true).b) <= 1 && off(m[0], g)) m[0] = 0;
    if (m.some((v) => off(v, g))) add(e, "rhythm", `margin-block ${m.map(r1).join(" ")}`, `a multiple of ${g}`);
    if (e.matches(SEL.section)) { const p = [px(c.paddingTop), px(c.paddingBottom)]; if (p.some((v) => off(v, T.grid))) add(e, "rhythm", `padding-block ${p.map(r1).join(" ")}`, `a multiple of ${T.grid}`); }
    if (/flex|grid/.test(c.display) && (c.flexDirection === "column" || /grid/.test(c.display)) && [...e.children].some((k) => vis(k) && (isCard(k) || k.matches(SEL.section)))) {
      const rg3 = c.rowGap === "normal" ? 0 : px(c.rowGap); if (off(rg3, T.grid)) add(e, "rhythm", `row-gap ${r1(rg3)} between cards`, `a multiple of ${T.grid}`);
    }
  }
  /* heading to paragraph, paragraph to paragraph */
  for (const e of all) {
    if (!e.matches(`${SEL.heading}, ${SEL.paragraph}`)) continue;
    let n = e.nextElementSibling; while (n && !vis(n)) n = n.nextElementSibling;
    if (!n || !n.matches(SEL.paragraph)) continue;
    const a = rect(e), b = rect(n), d = b.top - a.bottom;
    if (d < -tol || isInline(e) || isInline(n)) continue;
    if (off(d, T.grid)) add(n, "text-gap", `${r1(d)} px after ${e.tagName.toLowerCase()}`, `a multiple of ${T.grid}`);
  }

  /* radius and shadow */
  for (const e of all) {
    const c = cs(e), r = rect(e), half = Math.min(r.width, r.height) / 2, bad = [];
    for (const k of ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"]) {
      const v = c[k]; if (radTok.includes(v)) continue;
      if (/%$/.test(v.trim()) && px(v) >= 50) continue; /* a circle */
      if (/%| /.test(v.trim())) { bad.push(v); continue; }
      const n = px(v); if (n <= tol || T.radii.some((x) => near(x, n)) || n >= half - tol) continue; bad.push(v);
    }
    if (bad.length) add(e, "radius", [...new Set(bad)].join(" "), `one of ${T.radii.join(", ")} or fully round`);
    if (c.boxShadow && c.boxShadow !== "none") {
      const outer = layers(c.boxShadow).filter((l) => !/\binset\b/.test(l)).join(", ");
      if (outer && !elev.includes(outer)) add(e, "shadow", outer.slice(0, 90), "one of the elevations 1, 2, 3");
    }
  }

  /* row heights in one list */
  for (const L of all.filter((e) => e.matches(SEL.list))) {
    const hs = [...L.children].filter(vis).map((k) => rect(k).height); if (hs.length < 2) continue;
    const spread = Math.max(...hs) - Math.min(...hs);
    if (spread > T.rowHeightSpread + tol) add(L, "row-heights", `rows ${r1(Math.min(...hs))}..${r1(Math.max(...hs))} px`, `within ${T.rowHeightSpread} px`);
  }

  /* overflow: the parent, then the viewport (the outermost element only) */
  const vpOver = (e) => { const r = rect(e); return r.right > innerWidth + tol || r.left < -tol; };
  for (const e of all) {
    const c = cs(e); if (/fixed/.test(c.position)) continue;
    let p = e.parentElement; while (p && cs(p).display === "contents") p = p.parentElement;
    const r = rect(e);
    if (p && p !== document.body && !/absolute/.test(c.position) && !clips(p) && !isInline(p)) {
      /* an inline box's glyphs may stand above and below its line: only the sides count for it */
      const q = rect(p), o = Math.max(q.left - r.left, r.right - q.right, isInline(e) ? 0 : r.bottom - q.bottom);
      if (o > tol + 0.5) add(e, "overflow", `${r1(o)} px out of ${p.tagName.toLowerCase()}${p.className && typeof p.className === "string" ? "." + p.className.trim().split(/\s+/).join(".") : ""}`, "inside its parent");
    }
    if (vpOver(e) && !(p && vpOver(p))) {
      let clipped = false; for (let a = p; a && a !== document.body; a = a.parentElement) if (clips(a) && !vpOver(a)) clipped = true;
      if (!clipped) add(e, "overflow", `${r1(Math.max(r.right - innerWidth, -r.left))} px out of the ${innerWidth} px viewport`, "inside the viewport");
    }
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) add(document.documentElement, "overflow", `the page is ${document.documentElement.scrollWidth} px wide`, `${innerWidth}`);

  /* type */
  const canvas = document.createElement("canvas").getContext("2d");
  for (const e of all) {
    const field = /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName);
    if (!ownText(e) && !field) continue;
    const c = cs(e), fs = px(c.fontSize), lh = c.lineHeight === "normal" ? null : px(c.lineHeight);
    const st = steps.find((s) => near(s.size, fs));
    if (!st) { add(e, "font-size", `${r1(fs)} px`, `a step: ${steps.map((s) => r1(s.size)).join(", ")}`); continue; }
    if (!field) {
      if (lh === null) add(e, "type-pair", `${r1(fs)}/normal`, st.line ? `${r1(st.size)}/${r1(st.line)}` : "a line on the 4 px grid");
      else if (st.line !== null ? !near(st.line, lh) : off(lh, T.type.lineGrid) || lh < st.size * st.ratio[0] - tol || lh > st.size * st.ratio[1] + tol)
        add(e, "type-pair", `${r1(fs)}/${r1(lh)}`, st.line !== null ? `${r1(st.size)}/${r1(st.line)}` : `${r1(st.size)}/a multiple of ${T.type.lineGrid} in ${st.ratio.map((x) => r1(x * st.size)).join("..")}`);
    }
    if (innerWidth >= T.measure.atWidth && e.matches(SEL.textBlock) && !e.matches(SEL.cell) && fs <= bodyMax + tol && e.textContent.trim().length > T.measure.maxChars) {
      canvas.font = `${c.fontStyle} ${c.fontWeight} ${c.fontSize} ${c.fontFamily}`;
      const avg = canvas.measureText(T.measure.sample).width / T.measure.sample.length;
      const q = inner(e, true), chars = (q.r - q.l) / avg;
      if (chars > T.measure.maxChars) add(e, "measure", `${Math.round(chars)} characters a line (${r1(q.r - q.l)} px)`, `<= ${T.measure.maxChars}`);
    }
  }

  /* paths and marks for the pictures */
  const seg = (e) => `${e.tagName.toLowerCase()}${e.getAttribute("id") ? "#" + e.getAttribute("id") : ""}${[...e.classList].slice(0, 3).map((c) => "." + c).join("")}`;
  const path = (e) => { const s = []; for (let a = e; a && a !== document.documentElement && s.length < 5; a = a.parentElement) { s.unshift(seg(a)); if (a.getAttribute("id") || a.tagName === "MAIN" || a.tagName === "HEADER" || a.tagName === "FOOTER") break; } return s.join(" > "); };
  const seen = new Set();
  return V.map((v, i) => { v.el.setAttribute("data-ld", String(i)); return { id: i, path: path(v.el), rule: v.rule, measured: v.measured, expected: v.expected }; })
    .filter((v) => { const k = v.rule + "|" + v.path + "|" + v.measured; if (seen.has(k)) return false; seen.add(k); return true; });
}

/* ---------- the self-test: a page that breaks every rule once, so the doctor can never go blind quietly ---------- */
const RULES = ["card-padding", "row-padding", "cell-padding", "text-inset", "text-in-card", "stacked-buttons", "pill-alone", "group-gap", "primary-first", "rhythm", "text-gap", "radius", "shadow", "row-heights", "overflow", "font-size", "type-pair", "measure"];
const LONG = "This sentence is long on purpose so that one line of it runs far past eighty characters when the box is wide. ".repeat(3);
const BAD = `<main id="main" style="padding:24px">
<div class="card" style="padding:10px">card padded 10</div>
<ul class="card dash-rows" style="display:block"><li style="padding:4px">row padded 4</li><li style="height:90px">a taller row</li></ul>
<table class="hub-table"><tbody><tr><td style="padding:2px">cell padded 2</td></tr></tbody></table>
<div class="card" style="width:300px"><p style="width:900px;max-width:none">wider than its card</p></div>
<ul class="plain" style="width:800px"><li><a class="btn btn-solid">Primary</a></li><li><a class="btn btn-quiet">Quiet one</a></li><li><a class="btn btn-quiet">Quiet two</a></li></ul>
<p class="btn-row" style="gap:20px"><a class="btn btn-quiet">Quiet first</a><a class="btn btn-solid">Primary after</a></p>
<section style="margin-top:13px"><h2 style="margin:0 0 5px">Heading</h2><p>five after the heading</p></section>
<div style="border-radius:5px;width:100px;height:100px;box-shadow:0 0 3px currentColor"></div>
<p style="font-size:14px">fourteen pixels</p><p style="line-height:1.3">a line of 1.3</p>
<p style="max-width:none;width:1200px">${LONG}</p>
</main>`;
async function selftest(browser) {
  const srv = await serve(DIST, null);
  try {
    const ctx = await browser.newContext({ viewport: { width: Math.max(...T.widths, T.measure.atWidth), height: 900 } });
    const page = await ctx.newPage();
    await page.goto(srv.base + "/", { waitUntil: "load" });
    const css = await page.$$eval('link[rel="stylesheet"]', (ls) => ls.map((l) => l.outerHTML).join(""));
    await page.setContent(`<!doctype html><html lang="en"><head>${css}</head><body>${BAD}</body></html>`, { waitUntil: "load" });
    const got = new Set((await page.evaluate(doctor, T)).map((v) => v.rule));
    await ctx.close();
    const blind = RULES.filter((r) => !got.has(r));
    if (blind.length) { console.error(`layout-doctor: self-test FAILED, these rules did not fire on the page built to break them: ${blind.join(", ")}`); process.exit(2); }
    console.log(`layout-doctor: self-test ok, all ${RULES.length} rules fire on the page built to break them`);
  } finally { srv.close(); }
}

/* ---------- the run ---------- */
const sc = await scenario(T.scenario);
const browser = await launch();
await selftest(browser);
const found = [], allowed = [];
const shotKeys = new Set(); let shots = 0;
if (SHOTS) { rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true }); }
const slug = (s) => s.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "root";
const rules = ONLY;

async function combo(w, theme) {
  const hub = sc.make();
  const srv = await serve(DIST, hub.handler);
  try {
    for (const st of sc.states) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2, colorScheme: theme });
      if (st.who) await ctx.addInitScript((admin) => { try { localStorage.setItem("hub-who", JSON.stringify({ login: "alicedoe", name: "Alice Doe", avatar: null, admin })); } catch (e) {} }, st.who === "admin");
      const page = await ctx.newPage();
      try {
        for (const path of st.pages) {
          if (PAGES && !PAGES.has(path)) continue;
          if (hub.S) st.set(hub.S, hub.T);
          await page.goto(srv.base + path, { waitUntil: "load" });
          if (path.includes("#")) await page.reload({ waitUntil: "load" });
          await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
          await page.waitForFunction(() => !document.querySelector("main [data-pending], main [data-loading]"), null, { timeout: 4000 }).catch(() => {});
          if (st.prep) await st.prep(page);
          await page.evaluate(() => document.fonts && document.fonts.ready);
          await page.waitForTimeout(120);
          const vs = (await page.evaluate(doctor, T)).filter((v) => !rules || rules.has(v.rule));
          for (const v of vs) {
            const line = { page: path, state: st.state, width: w, theme, ...v };
            const al = ALLOW.find((a) => a.rule === v.rule && v.path.includes(a.selector) && (!a.page || a.page === path));
            if (al) { allowed.push([line, al]); continue; }
            const key = `${v.rule}|${v.path}`;
            if (SHOTS && shots < MAX_SHOTS && !shotKeys.has(key)) {
              shotKeys.add(key); shots++;
              const file = resolve(OUT, `${String(shots).padStart(3, "0")}-${v.rule}-${slug(path)}-${st.state}-${w}-${theme}.png`);
              try {
                const el = page.locator(`[data-ld="${v.id}"]`).first();
                await el.scrollIntoViewIfNeeded({ timeout: 1000 });
                const b = await el.boundingBox();
                if (b) {
                  const vp = page.viewportSize(), x = Math.max(0, b.x - 16), y = Math.max(0, b.y - 16);
                  await page.screenshot({ path: file, clip: { x, y, width: Math.max(1, Math.min(vp.width - x, b.width + 32)), height: Math.max(1, Math.min(vp.height - y, b.height + 32)) } });
                  line.png = file;
                }
              } catch (e) { /* an element that left the page: the line still stands */ }
            }
            found.push(line);
          }
        }
      } finally { await ctx.close(); }
    }
  } finally { srv.close(); }
}

try {
  const jobs = [];
  for (const w of WIDTHS) for (const theme of T.themes) jobs.push(combo(w, theme));
  await Promise.all(jobs);
} finally { await browser.close(); }

found.sort((a, b) => a.rule.localeCompare(b.rule) || a.path.localeCompare(b.path) || a.page.localeCompare(b.page) || a.width - b.width);
for (const v of found) console.log(`FAIL ${v.page} [${v.state}] ${v.width} ${v.theme} ${v.path} :: ${v.rule}: ${v.measured} (expected ${v.expected})${v.png ? `  ${v.png}` : ""}`);
const by = {}; for (const v of found) by[v.rule] = (by[v.rule] || 0) + 1;
const states = sc.states.reduce((n, s) => n + s.pages.filter((p) => !PAGES || PAGES.has(p)).length, 0);
console.log(`layout-doctor: ${states} page states x ${WIDTHS.length} widths x ${T.themes.length} themes; ${found.length} violation(s)${found.length ? ": " + Object.entries(by).map(([k, n]) => `${k} ${n}`).join(", ") : ""}; ${allowed.length} allowed by ${allowFile.replace(process.cwd() + "/", "")}${SHOTS && shots ? `; ${shots} pictures in ${OUT}` : ""}`);
process.exit(found.length ? 1 : 0);
