// SPDX-License-Identifier: GPL-2.0-or-later
// The pages of the hub as HTML strings. Every visible word is here or in data/index.json; there is no
// script-made text except messages from the Worker (its `sentence`) and the search results.
import { esc, day, monthYear, bytes, plural } from "./html.mjs";
import { KINDS, TRUST_LABEL, kindOf, latest, ownerPath } from "./data.mjs";
import { picHtml } from "./pic.mjs";

const TILES = ["wolos", "system", "dev", "files", "web", "talk"];
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const tile = (e, big = false) => `<span class="tile t-${e.trust === "wolos" ? "wolos" : TILES[1 + (hash(e.id) % (TILES.length - 1))]}${big ? " tile-lg" : ""}" aria-hidden="true">${esc([...e.name][0].toUpperCase())}</span>`;

const PERMISSIONS = {
  http: "Reach the internet", notifications: "Show notifications", open: "Open links in your browser",
  "files.chosen": "Open files you choose", files: "Read and write your files", clipboard: "Use the clipboard", network: "Reach the internet",
};
const WORKS_IN = { menubar: "the menu bar", tile: "a Control Center tile" };

/* ---------- Words for trust, as ADR 0046 words them for the person ---------- */
export function trustRow(e) {
  const o = e.ownerInfo, what = e.kind;
  const who = `${o.name} (${o.login} on GitHub)`;
  if (e.trust === "wolos") return { label: TRUST_LABEL.wolos, tone: "wolos", sentence: "" };
  if (e.trust === "verified") {
    const since = o.since ? ` Verified author since ${monthYear(o.since)}.` : " Verified author.";
    return { label: TRUST_LABEL.verified, tone: "verified", sentence: o.kind === "person" ? `Made by ${who}.${since}` : `Made by ${who}. Verified organisation.` };
  }
  if (e.trust === "withdrawn") return { label: TRUST_LABEL.withdrawn, tone: "withdrawn", sentence: `WolOS no longer trusts the certificate this ${what} was signed with, because its key was exposed. It won't be installed.` };
  return { label: TRUST_LABEL.community, tone: "community", sentence: `Nobody vouches for this ${what}. WolOS can't tell who made it or whether someone changed it on the way.` };
}
export const badge = (e) => { const t = trustRow(e); return `<span class="badge badge-${t.tone}"><span class="dot" aria-hidden="true"></span>${esc(t.label)}</span>`; };

export function checkSentence(r) {
  const f = r.findings || [];
  if (r.verdict === "pass") return { head: "WolOS Hub lists this file. Its automatic check found nothing to report.", list: [] };
  if (r.verdict === "flag") return { head: `WolOS Hub lists this file. Its automatic check found ${plural(f.length, "thing")} to look at:`, list: f.map((x) => x.sentence) };
  if (r.verdict === "not-checked") return { head: "This file was too large to check automatically, so WolOS Hub lists it without a check.", list: [] };
  return { head: "This file has not been checked.", list: [] };
}

/* ---------- The shell ---------- */
const NAV = [["/apps", "Apps"], ["/plugins", "Plugins"], ["/extensions", "Extensions"], ["/publish", "Publish"]];

export function page({ title, desc, path, body, assets, search = "header", noindex = false, wide = false }) {
  const here = (p) => path === p || path.startsWith(p + "/");
  const next = encodeURIComponent(path);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${esc(assets.origin + path)}">`}
<meta name="color-scheme" content="light dark">
<meta property="og:site_name" content="WolOS Hub"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website">
<script src="${assets.theme}"></script>
<link rel="icon" type="image/svg+xml" href="/wolos-mark.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="${assets.css}">
</head>
<body>
<a class="skip" href="#main">Skip to the content</a>
<header class="wrap bar">
<a class="brand" href="/" aria-label="WolOS Hub, home"><img src="/wolos-mark.svg" alt="" width="24" height="24"><span>WolOS Hub</span></a>
<nav aria-label="Main"><ul>${NAV.map(([p, t]) => `<li><a href="${p}"${here(p) ? ' aria-current="page"' : ""}>${t}</a></li>`).join("")}</ul></nav>
${search === "header" ? `<form class="find" role="search" action="/search" method="get"><label class="sr" for="q">Search the hub</label><input id="q" name="q" type="search" placeholder="Search the hub" autocomplete="off" enterkeyhint="search"><kbd aria-hidden="true">/</kbd></form>` : ""}
<div class="who" id="who" data-next="${esc(next)}"><a class="btn btn-quiet" href="/auth/login?next=${esc(next)}">Sign in</a></div>
</header>
<main id="main" tabindex="-1">
${body}
</main>
<footer class="foot">
<div class="wrap foot-grid">
<div><a class="brand" href="/"><img src="/wolos-mark.svg" alt="" width="22" height="22"><span>WolOS Hub</span></a><p class="dim">Apps, plugins and extensions for WolOS, from the people who make them. Every file stays with its maker on GitHub.</p></div>
<nav aria-label="Hub"><h2 class="eyebrow">Hub</h2><ul><li><a href="/apps">Apps</a></li><li><a href="/plugins">Plugins</a></li><li><a href="/extensions">Extensions</a></li><li><a href="/publish">Publish your app</a></li><li><a href="/report">Report a problem</a></li></ul></nav>
<nav aria-label="WolOS"><h2 class="eyebrow">WolOS</h2><ul><li><a href="https://wolos.org">wolos.org</a></li><li><a href="https://github.com/wonderlandos">GitHub</a></li></ul></nav>
<div><h2 class="eyebrow" id="theme-l">Look</h2><div class="seg" role="group" aria-labelledby="theme-l" id="theme"><button type="button" data-theme="auto" aria-pressed="true">Auto</button><button type="button" data-theme="light" aria-pressed="false">Light</button><button type="button" data-theme="dark" aria-pressed="false">Dark</button></div></div>
</div>
<div class="wrap legal">WolOS Hub is part of the WolOS project.</div>
</footer>
<script src="${assets.js}" defer></script>
</body>
</html>
`;
}

/* ---------- Cards ---------- */
export function card(e) {
  const t = trustRow(e), k = kindOf(e.kind);
  return `<li class="card item"><a class="stretch" href="${esc(e.url_path)}"><span class="sr">${esc(e.name)}, </span></a>
${tile(e)}<div class="item-body"><h3>${esc(e.name)}</h3><p class="dim">${esc(e.summary)}</p>
<p class="meta">${badge(e)}<span class="dim">${esc(e.ownerInfo.name)} · ${esc(k.one)}</span></p></div></li>`;
}
const grid = (list) => `<ul class="grid cards">${list.map(card).join("")}</ul>`;

/* ---------- Home ---------- */
export function home(idx, assets) {
  const n = (k) => idx.entries.filter((e) => e.kind === k).length;
  const doors = KINDS.map((k) => `<li class="card door"><a class="stretch" href="/${k.dir}"><span class="sr">${k.many}</span></a><h3>${k.many}</h3><p class="dim">${esc(k.blurb)}</p><p class="eyebrow">${plural(n(k.kind), k.one)}</p></li>`).join("");
  const featured = idx.featured.length ? idx.featured : idx.entries.slice(0, 6);
  return page({
    title: "WolOS Hub - apps, plugins and extensions for WolOS", path: "/", assets, search: "hero",
    desc: "Find apps, plugins and extensions for WolOS, or publish your own. Every listing shows who made it and what its automatic check found.",
    body: `<section class="hero wrap"><p class="eyebrow">WolOS Hub</p><h1>Apps, plugins and extensions for your desktop</h1>
<p class="lead">From WolOS and from people like you. See who made each one before you install it.</p>
<form class="find find-lg" role="search" action="/search" method="get"><label class="sr" for="q">Search the hub</label><input id="q" name="q" type="search" placeholder="Search apps, plugins and extensions" autocomplete="off" enterkeyhint="search"><button class="btn btn-solid" type="submit">Search</button></form></section>
<section class="wrap block" aria-labelledby="browse"><h2 id="browse" class="sr">Browse</h2><ul class="grid doors">${doors}</ul></section>
<section class="wrap block" aria-labelledby="feat"><h2 id="feat">Featured</h2>${grid(featured)}</section>
<section class="wrap block" aria-labelledby="pub"><div class="card publish-door"><div><h2 id="pub">Publish your app</h2><p class="dim">Sign in with GitHub, accept the agreement, link your repository and tag a release. Your files stay on GitHub; the hub shows them to everyone on WolOS.</p></div><a class="btn btn-solid" href="/publish">Publish your app</a></div></section>`,
  });
}

/* ---------- A kind: /apps /plugins /extensions ---------- */
export function kindPage(k, idx, assets) {
  const list = idx.entries.filter((e) => e.kind === k.kind);
  return page({
    title: `${k.many} - WolOS Hub`, path: `/${k.dir}`, assets,
    desc: `${k.blurb} ${plural(list.length, k.one)} on WolOS Hub.`,
    body: `<section class="wrap block"><nav class="crumbs" aria-label="You are here"><a href="/">Hub</a></nav><h1 class="h-xl">${k.many}</h1><p class="lead">${esc(k.blurb)}</p>
${list.length ? grid(list) : `<p class="dim">No ${k.many.toLowerCase()} are listed right now. <a href="/publish">Publish the first one.</a></p>`}</section>`,
  });
}

/* ---------- A listing ---------- */
function release(e, r) {
  const rel = r.tag ? `https://github.com/${e.source.repo}/releases/tag/${r.tag}` : `https://github.com/${e.source.repo}/releases`;
  const c = checkSentence(r);
  return `<li class="card rel${r.yanked ? " rel-out" : ""}"><div class="rel-head"><h3>${esc(r.version)}</h3>${r.yanked ? '<span class="badge badge-withdrawn"><span class="dot" aria-hidden="true"></span>Withdrawn</span>' : ""}<span class="dim">${day(r.first_seen)} · ${bytes(r.size)}</span></div>
${r.yanked ? '<p class="dim">The author withdrew this version. Copies already installed keep working but are not offered as updates.</p>' : ""}
${r.yanked ? "" : `<p class="dim">${esc(c.head)}</p>${c.list.length ? `<ul class="plain">${c.list.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}`}
<div class="hash"><span class="eyebrow">sha256</span><code>${esc(r.sha256)}</code><button type="button" class="copy" data-copy="${esc(r.sha256)}" aria-label="Copy the sha256 of ${esc(r.version)}">Copy</button></div>
<p class="links"><a href="${esc(rel)}">This release on GitHub</a><a href="${esc(r.url)}">The file</a>${r.yanked ? "" : `<a href="/report?listing=${encodeURIComponent(e.id)}&amp;version=${encodeURIComponent(r.version)}">Report this version</a>`}</p></li>`;
}

export function listing(e, assets, images) {
  const k = kindOf(e.kind), t = trustRow(e), r = latest(e), c = checkSentence(r);
  const asks = [...(e.permissions || []), ...(e.capabilities || [])].map((p) => PERMISSIONS[p] || p);
  const where = (e.kinds || []).map((x) => WORKS_IN[x] || x);
  const shots = (e.screenshots || []).map((s) => picHtml(images, s.src, s.alt)).join("");
  const wi = e.host ? `<p class="dim">Extends <a href="/apps/${esc(e.host)}">${esc(idxName(e.host))}</a>.</p>` : "";
  return page({
    title: `${e.name} - ${k.many} - WolOS Hub`, path: e.url_path, assets,
    desc: `${e.summary} ${t.label}.`.slice(0, 200),
    body: `<article class="wrap block listing">
<nav class="crumbs" aria-label="You are here"><a href="/">Hub</a><span aria-hidden="true"> / </span><a href="/${k.dir}">${k.many}</a></nav>
<header class="l-head">${tile(e, true)}<div><h1 class="h-xl">${esc(e.name)}</h1><p class="lead">${esc(e.summary)}</p>
<p class="meta"><a href="${ownerPath(e.owner)}">${esc(e.ownerInfo.name)}</a><span class="dim">${esc(k.one)}</span><span class="dim">Version ${esc(r.version)}</span><span class="dim">${esc(e.license)}</span></p></div></header>
<section class="trust trust-${t.tone}" aria-label="Who made it">${badge(e)}${t.sentence ? `<p>${esc(t.sentence)}</p>` : ""}</section>
<section class="get card" aria-label="Download"><div><h2 class="h-md">${esc(e.name)} ${esc(r.version)}</h2><p class="dim">Needs WolOS ${esc(e.min_wolos)} or newer. The file comes straight from GitHub, and WolOS checks it again on your PC before anything installs.</p></div>
<p class="get-btns"><a class="btn btn-solid" href="${esc(r.url)}">Download</a><a class="btn btn-quiet" href="https://github.com/${esc(e.source.repo)}">Source on GitHub</a></p></section>
${wi}
${shots ? `<section aria-labelledby="shots"><h2 id="shots" class="sr">Pictures</h2><div class="shots">${shots}</div></section>` : ""}
<div class="l-cols"><section class="prose" aria-labelledby="about"><h2 id="about">About</h2>${(e.description || [e.summary]).map((p) => `<p>${esc(p)}</p>`).join("")}</section>
<aside class="side" aria-label="Details">
${asks.length ? `<section><h2 class="h-sm">What it can do</h2><ul class="plain">${asks.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></section>` : `<section><h2 class="h-sm">What it can do</h2><p class="dim">It asks for no extra access.</p></section>`}
${where.length ? `<section><h2 class="h-sm">Where it lives</h2><p class="dim">${esc(where.join(", ").replace(/^./, (m) => m.toUpperCase()))}</p></section>` : ""}
<section><h2 class="h-sm">Automatic check</h2><p class="dim">${esc(c.head)}</p>${c.list.length ? `<ul class="plain">${c.list.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}<p class="dim small">A clean check means no rule was broken. It is not a promise about the ${esc(k.one)}.</p></section>
<section><h2 class="h-sm">Problem?</h2><p><a href="/report?listing=${encodeURIComponent(e.id)}">Report this ${esc(k.one)}</a></p></section>
</aside></div>
<section aria-labelledby="rels"><h2 id="rels">Releases</h2><ul class="rels">${e.releases.map((x) => release(e, x)).join("")}</ul>
<div class="card verify"><h3 class="h-sm">Check the download yourself</h3><p class="dim">The sha256 above is the file's fingerprint. Run this in a terminal and compare.</p><div class="code"><pre><code>sha256sum ${esc(fileName(r.url))}</code></pre><button type="button" class="copy" data-copy="sha256sum ${esc(fileName(r.url))}">Copy</button></div></div></section>
</article>`,
  });
}
let NAMES = new Map();
export const setNames = (idx) => { NAMES = new Map(idx.entries.map((e) => [e.id, e.name])); };
const idxName = (id) => NAMES.get(id) || id;
const fileName = (u) => u.split("/").pop();

/* ---------- Author and organisation ---------- */
export function ownerPage(o, assets) {
  const org = o.kind !== "person";
  const sample = o.entries[0];
  const t = sample ? trustRow({ ...sample, trust: o.trust, kind: "app" }) : { label: TRUST_LABEL[o.trust], tone: o.trust, sentence: "" };
  const gh = o.kind === "wolos" ? "https://github.com/wonderlandos" : `https://github.com/${o.login}`;
  const sentence = o.trust === "verified" ? (org ? `${o.name} (${o.login} on GitHub). Verified organisation${o.since ? ` since ${monthYear(o.since)}` : ""}.` : `${o.name} (${o.login} on GitHub). Verified author${o.since ? ` since ${monthYear(o.since)}` : ""}.`)
    : o.trust === "wolos" ? "Everything WolOS lists is built and signed by WolOS itself." : `${o.name} (${o.login} on GitHub). Nobody vouches for who ${org ? "they are" : "this is"} beyond their GitHub account.`;
  return page({
    title: `${o.name} - WolOS Hub`, path: ownerPath(o), assets,
    desc: `${o.about || `${o.name} on WolOS Hub.`}`.slice(0, 200),
    body: `<section class="wrap block"><nav class="crumbs" aria-label="You are here"><a href="/">Hub</a></nav>
<header class="l-head"><span class="tile tile-lg t-${o.trust === "wolos" ? "wolos" : "system"}" aria-hidden="true">${esc([...o.name][0].toUpperCase())}</span><div><p class="eyebrow">${org ? "Organisation" : "Author"}</p><h1 class="h-xl">${esc(o.name)}</h1>${o.about ? `<p class="lead">${esc(o.about)}</p>` : ""}</div></header>
<section class="trust trust-${t.tone}" aria-label="Who this is"><span class="badge badge-${t.tone}"><span class="dot" aria-hidden="true"></span>${esc(t.label)}</span><p>${esc(sentence)}</p></section>
<p><a href="${esc(gh)}">${esc(o.login)} on GitHub</a></p>
<h2>${o.entries.length ? `Listed by ${esc(o.name)}` : "Listings"}</h2>${o.entries.length ? grid(o.entries) : '<p class="dim">Nothing is listed here right now.</p>'}</section>`,
  });
}

/* ---------- Search shell ---------- */
export const search = (assets) => page({
  title: "Search - WolOS Hub", path: "/search", assets, noindex: true, desc: "Search apps, plugins and extensions on WolOS Hub.",
  body: `<section class="wrap block"><h1 class="h-xl">Search</h1><p id="count" class="dim" role="status" aria-live="polite">Type a name, a maker or a few words.</p><ul class="grid cards" id="results"></ul>
<noscript><p>Searching needs JavaScript. You can also <a href="/apps">browse the apps</a>, <a href="/plugins">plugins</a> or <a href="/extensions">extensions</a>.</p></noscript></section>`,
});

/* ---------- Publish ---------- */
export const publish = (assets) => page({
  title: "Publish your app - WolOS Hub", path: "/publish", assets,
  desc: "Publish an app, plugin or extension on WolOS Hub: sign in with GitHub, accept the agreement, link your repository and tag a release.",
  body: `<section class="wrap narrow-col block"><nav class="crumbs" aria-label="You are here"><a href="/">Hub</a></nav><h1 class="h-xl">Publish your app</h1>
<p class="lead">Four steps. Your files stay on GitHub; the hub lists them and checks them for you.</p>
<ol class="steps">
<li class="step" id="s-signin"><h2><span class="n" aria-hidden="true">1</span>Sign in</h2>
<p class="dim">Sign in with your GitHub account. The hub asks only for your public profile and the organisations you belong to.</p>
<div data-when="out"><a class="btn btn-solid" href="/auth/login?next=%2Fpublish">Sign in with GitHub</a></div>
<p data-when="in" hidden role="status">You are signed in as <strong data-me="login"></strong>.</p></li>
<li class="step" id="s-cla"><h2><span class="n" aria-hidden="true">2</span>Accept the agreement</h2>
<p class="dim">Read the contributor agreement and accept it once. When it changes you accept the new version before your next release.</p>
<div data-when="cla" hidden><div class="card cla" tabindex="0" role="region" aria-label="The contributor agreement" id="cla-text"></div>
<form id="cla-form"><label class="check"><input type="checkbox" name="agree" required> I have read the agreement and accept it.</label><p class="err" role="alert" data-err></p><button class="btn btn-solid" type="submit">Accept the agreement</button></form></div>
<p data-when="cla-ok" hidden role="status">You accepted version <span data-me="cla"></span>.</p></li>
<li class="step" id="s-link"><h2><span class="n" aria-hidden="true">3</span>Link your repository</h2>
<p class="dim">Pick who publishes: you, or an organisation you own on GitHub. The id of your listing starts with that name and a dot, like <code>alice.notes</code>. The repository must be public and belong to the same person or organisation.</p>
<div data-when="orgs" hidden><h3 class="h-sm">Organisations</h3><ul class="plain" id="org-list"></ul><p class="err" role="alert" data-err="org"></p></div>
<form id="listing-form" data-when="link" hidden>
<div class="field"><label for="f-owner">Publish as</label><select id="f-owner" name="owner"></select></div>
<div class="field"><label for="f-kind">What is it</label><select id="f-kind" name="kind"><option value="app">An app</option><option value="plugin">A plugin</option><option value="extension">An extension</option></select></div>
<div class="field" id="host-field" hidden><label for="f-host">Extends the app with this id</label><input id="f-host" name="host" type="text" autocomplete="off" spellcheck="false" placeholder="org.wolos.notes"></div>
<div class="field"><label for="f-id">Id</label><input id="f-id" name="id" type="text" required autocomplete="off" spellcheck="false" placeholder="alice.notes" pattern="[a-z0-9][a-z0-9\\-]*(\\.[a-z0-9][a-z0-9\\-]*)+"></div>
<div class="field"><label for="f-name">Name</label><input id="f-name" name="name" type="text" required maxlength="64" autocomplete="off"></div>
<div class="field"><label for="f-summary">One sentence about it</label><input id="f-summary" name="summary" type="text" required maxlength="200" autocomplete="off"></div>
<div class="field"><label for="f-license">Licence (like GPL-2.0-or-later or MIT)</label><input id="f-license" name="license" type="text" required maxlength="64" autocomplete="off" spellcheck="false"></div>
<div class="field"><label for="f-repo">Repository on GitHub</label><input id="f-repo" name="repo" type="text" required autocomplete="off" spellcheck="false" placeholder="alice/notes"></div>
<div class="field"><label for="f-asset">File name in your releases</label><input id="f-asset" name="asset" type="text" required maxlength="128" autocomplete="off" spellcheck="false" placeholder="alice.notes-*.wol"><p class="hint dim">An app ends in .wol, a plugin in .wolplug. One star stands for the version.</p></div>
<p class="err" role="alert" data-err></p><button class="btn btn-solid" type="submit">Link the repository</button></form>
<p data-when="linked" hidden role="status"><strong>Linked.</strong> <span data-me="linked"></span></p></li>
<li class="step" id="s-tag"><h2><span class="n" aria-hidden="true">4</span>Tag a release</h2>
<p class="dim">Push a tag and publish a release on GitHub with your file attached. The hub notices it, checks the file, and lists it within about fifteen minutes.</p>
<div class="term"><div class="term-bar" aria-hidden="true"><span class="term-dot"></span><span class="term-dot"></span><span class="term-dot"></span></div><div class="code"><pre><code>git tag v1.0.0
git push origin v1.0.0
gh release create v1.0.0 alice.notes-1.0.0.wol</code></pre><button type="button" class="copy" data-copy="git tag v1.0.0&#10;git push origin v1.0.0&#10;gh release create v1.0.0 alice.notes-1.0.0.wol">Copy</button></div></div>
<p class="dim">Each release is checked on its own. If a check finds something, it is shown on your listing in plain words, and you can release again.</p></li>
</ol></section>`,
});

/* ---------- Report ---------- */
export const report = (assets) => page({
  title: "Report a problem - WolOS Hub", path: "/report", assets, noindex: true,
  desc: "Tell the moderators about an app, plugin or extension on WolOS Hub that is harmful, copied or broken.",
  body: `<section class="wrap narrow-col block"><nav class="crumbs" aria-label="You are here"><a href="/">Hub</a></nav><h1 class="h-xl">Report a problem</h1>
<p class="lead">Tell the moderators about a listing that is harmful, copied, broken or against the rules. They read every report.</p>
<div data-when="out"><p>Reports come from signed-in people, so a moderator can ask you a question. Your name is never shown to the author.</p><p><a class="btn btn-solid" id="report-signin" href="/auth/login?next=%2Freport">Sign in with GitHub</a></p></div>
<form id="report-form" data-when="in" hidden novalidate>
<div class="field"><label for="r-listing">Listing id</label><input id="r-listing" name="listing_id" type="text" required autocomplete="off" spellcheck="false" placeholder="alice.notes"></div>
<div class="field"><label for="r-version">Version (if it is about one)</label><input id="r-version" name="version" type="text" autocomplete="off" spellcheck="false" placeholder="1.0.0"></div>
<fieldset class="field"><legend>What is wrong</legend>
<label class="check"><input type="radio" name="reason" value="malware" required> It harms the computer or steals things</label>
<label class="check"><input type="radio" name="reason" value="impersonation"> It pretends to be someone else or another app</label>
<label class="check"><input type="radio" name="reason" value="broken"> It does not work or does not match its description</label>
<label class="check"><input type="radio" name="reason" value="license"> It breaks a licence or copies someone's work</label>
<label class="check"><input type="radio" name="reason" value="conduct"> It is abusive or against the code of conduct</label></fieldset>
<div class="field"><label for="r-text">Tell us what happened</label><textarea id="r-text" name="text" rows="6" maxlength="2000" required></textarea><p class="hint dim"><span id="r-left">2000</span> characters left.</p></div>
<p class="err" role="alert" data-err></p><button class="btn btn-solid" type="submit">Send the report</button></form>
<p id="report-done" hidden role="status"><strong>Thank you.</strong> The moderators have your report, number <span data-me="report"></span>.</p>
<noscript><p>Reporting needs JavaScript in your browser.</p></noscript></section>`,
});

/* ---------- Sign-in trouble and 404 ---------- */
export const signin = (assets) => page({
  title: "Sign in - WolOS Hub", path: "/signin", assets, noindex: true, desc: "Sign in to WolOS Hub with GitHub.",
  body: `<section class="wrap narrow-col block"><h1 class="h-xl">Sign in</h1><p class="lead" id="signin-msg">Sign in with your GitHub account to publish and to send reports.</p><p><a class="btn btn-solid" href="/auth/login?next=%2Fpublish">Sign in with GitHub</a></p></section>`,
});
export const notFound = (assets) => page({
  title: "Not found - WolOS Hub", path: "/404", assets, noindex: true, desc: "This page is not on WolOS Hub.",
  body: `<section class="wrap narrow-col block"><h1 class="h-xl">There is nothing here</h1><p class="lead">The page you wanted is not on the hub. It may have been renamed or withdrawn.</p><p><a class="btn btn-solid" href="/">Back to the hub</a></p></section>`,
});
