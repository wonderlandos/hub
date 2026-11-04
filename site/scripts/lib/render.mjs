// SPDX-License-Identifier: GPL-2.0-or-later
// The store pages of the hub as HTML strings. Every visible word is here, in render-account.mjs or in the
// index; scripts fill in only what the Worker says (names, dates, its `sentence`) and the search results.
import { esc, day, monthYear, bytes, plural } from "./html.mjs";
import { KINDS, TRUST_LABEL, kindOf, latest, ownerPath, versionPath } from "./data.mjs";
import { picHtml } from "./pic.mjs";

const TILES = ["wolos", "system", "dev", "files", "web", "talk"];
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export const tileClass = (e) => (e.trust === "wolos" ? "wolos" : TILES[1 + (hash(e.id) % (TILES.length - 1))]);
/** The package's own icon when it has one, else a letter on one of the system's icon colours. */
export function icon(e, big = false) {
  if (e.iconUrl) { const n = big ? 88 : 52; return `<img class="icon${big ? " icon-lg" : ""}" src="${esc(e.iconUrl)}" width="${n}" height="${n}" alt="" loading="lazy" decoding="async" style="max-width:${Math.min(n, e.icon.width)}px">`; }
  return `<span class="tile t-${tileClass(e)}${big ? " tile-lg" : ""}" aria-hidden="true">${esc([...e.name][0].toUpperCase())}</span>`;
}

const PERMISSIONS = {
  http: "Reach the internet", notifications: "Show notifications", open: "Open links in your browser",
  "files.chosen": "Open files you choose", files: "Read and write your files", clipboard: "Use the clipboard", network: "Reach the internet",
};
const WORKS_IN = { menubar: "the menu bar", tile: "a Control Center tile" };

/* ---------- Trust, in the words the lead set (2026-11-04) ---------- */
export function trustRow(e, r = null) {
  const o = e.ownerInfo, what = e.kind, t = r ? r.trust : e.trust;
  if (t === "wolos") return { label: TRUST_LABEL.wolos, tone: "wolos", line: "Made by WolOS", sentence: "Built and signed by WolOS itself." };
  if (t === "trusted") return { label: TRUST_LABEL.trusted, tone: "trusted", line: `Trusted developer ${o.name}`, sentence: `WolOS Hub verified the identity of ${o.name} (${o.login} on GitHub) by hand. Every release is signed with their certificate.` };
  if (t === "origin") return { label: TRUST_LABEL.origin, tone: "origin", line: `From ${o.name} (${o.login} on GitHub), from ${e.source.repo}`, sentence: `Signed with a certificate that ties this ${what} to that GitHub account and repository.` };
  if (t === "withdrawn") return { label: TRUST_LABEL.withdrawn, tone: "withdrawn", line: "Withdrawn", sentence: `WolOS Hub withdrew ${r ? "this version" : `this ${what}`}. It is not offered to install or as an update.` };
  return { label: TRUST_LABEL.community, tone: "community", line: "Community", sentence: `Nobody vouches for this ${what}. WolOS can't tell who made it or whether someone changed it on the way.` };
}
export const badgeOf = (tone, label) => `<span class="badge badge-${tone}"><span class="dot" aria-hidden="true"></span>${esc(label)}</span>`;
export const badge = (e) => { const t = trustRow(e); return badgeOf(t.tone, t.label); };
const trustBox = (t, label, extra = "") => `<section class="trust trust-${t.tone}" aria-label="${label}"><p class="trust-line">${badgeOf(t.tone, t.label)}<strong>${esc(t.line)}</strong></p>${t.sentence ? `<p class="dim">${esc(t.sentence)}</p>` : ""}${extra}</section>`;

/** What the check of one version says, in plain words. */
export function checked(r) {
  const f = r.findings || [];
  const when = day(r.checked_at || r.first_seen);
  if (r.withdrawn) return { head: "Withdrawn by WolOS Hub", text: "This version was withdrawn. It is not offered to install or as an update.", list: [], tone: "withdrawn", short: "Withdrawn" };
  if (r.yanked) return { head: "Withdrawn by its author", text: "Copies already installed keep working but are not offered as updates.", list: [], tone: "community", short: "Withdrawn by its author" };
  if (r.verdict === "flag") return { head: `Checked by WolOS Hub on ${when}`, text: `The check found ${plural(f.length, "thing")} to look at:`, list: f.map((x) => x.sentence), tone: "community", short: `Checked, ${plural(f.length, "note")}` };
  return { head: `Checked by WolOS Hub on ${when}`, text: "The check found nothing to report.", list: [], tone: "trusted", short: "Checked" };
}
const checkedHtml = (c) => `<p class="dim">${esc(c.text)}</p>${c.list.length ? `<ul class="plain">${c.list.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}`;

/* ---------- The shell ---------- */
const NAV = [["/apps", "Apps"], ["/plugins", "Plugins"], ["/extensions", "Extensions"], ["/publish", "Publish"]];

export function page({ title, desc, path, body, assets, search = "header", noindex = false, scripts = [] }) {
  const here = (p) => path === p || path.startsWith(p + "/");
  const next = encodeURIComponent(path);
  return `${head(title, desc, path, assets, noindex)}
<body>
<a class="skip" href="#main">Skip to the content</a>
<header class="wrap bar">
<a class="brand" href="/" aria-label="WolOS Hub, home"><img src="/wolos-mark.svg" alt="" width="24" height="24"><span>WolOS Hub</span></a>
<nav aria-label="Main"><ul>${NAV.map(([p, t]) => `<li><a href="${p}"${here(p) ? ' aria-current="page"' : ""}>${t}</a></li>`).join("")}</ul></nav>
${search === "header" ? `<form class="find" role="search" action="/search" method="get"><label class="sr" for="q">Search the hub</label><input id="q" name="q" type="search" placeholder="Search the hub" autocomplete="off" enterkeyhint="search"><kbd aria-hidden="true">/</kbd></form>` : ""}
<div class="who" id="who" data-next="${esc(next)}"><a class="btn btn-quiet" href="/auth/login?next=${esc(next)}">Sign in</a></div>
<template id="t-who"><a class="btn btn-quiet who-admin" data-slot="admin" hidden>Admin</a><a class="who-me" href="/dashboard"><img alt="" width="28" height="28" hidden><span class="login" data-slot="name"></span></a><button type="button" class="btn btn-quiet" data-act="signout">Sign out</button></template>
</header>
<main id="main" tabindex="-1">
${body}
</main>
<footer class="foot">
<div class="wrap foot-grid">
<div><a class="brand" href="/"><img src="/wolos-mark.svg" alt="" width="22" height="22"><span>WolOS Hub</span></a><p class="dim">Apps, plugins and extensions for WolOS, from the people who make them. Every file stays with its maker on GitHub, and every version is checked before it is listed.</p></div>
<nav aria-label="Hub"><h2 class="eyebrow">Hub</h2><ul><li><a href="/apps">Apps</a></li><li><a href="/plugins">Plugins</a></li><li><a href="/extensions">Extensions</a></li><li><a href="/report">Report a problem</a></li><li><a href="/terms/usage">Terms of Use</a></li><li><a href="/terms/privacy">Privacy</a></li><li><a href="/terms">All terms</a></li></ul></nav>
<nav aria-label="Publish"><h2 class="eyebrow">Publish</h2><ul><li><a href="/publish">Publish your app</a></li><li><a href="/dashboard">Your dashboard</a></li><li><a href="https://wolos.org">wolos.org</a></li><li><a href="https://github.com/wonderlandos">GitHub</a></li></ul></nav>
<div><h2 class="eyebrow" id="theme-l">Look</h2><div class="seg" role="group" aria-labelledby="theme-l" id="theme"><button type="button" data-theme="auto" aria-pressed="true">Auto</button><button type="button" data-theme="light" aria-pressed="false">Light</button><button type="button" data-theme="dark" aria-pressed="false">Dark</button></div></div>
</div>
<div class="wrap legal">WolOS Hub is part of the WolOS project.</div>
</footer>
<script src="${assets.js}" defer></script>
${scripts.map((s) => `<script src="${s}" defer></script>`).join("\n")}
</body>
</html>
`;
}
export function head(title, desc, path, assets, noindex, closed = false) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
${desc ? `<meta name="description" content="${esc(desc)}">` : ""}
${noindex ? `<meta name="robots" content="${closed ? "noindex, nofollow" : "noindex"}">` : `<link rel="canonical" href="${esc(assets.origin + path)}">`}
<meta name="color-scheme" content="light dark">
${assets.apiOff ? '<meta name="hub-api" content="off">\n' : ""}${noindex ? "" : `<meta property="og:site_name" content="WolOS Hub"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website">`}
<script src="${assets.theme}"></script>
<script src="${assets.debug}"></script>
<link rel="icon" type="image/svg+xml" href="/wolos-mark.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="${assets.css}">
</head>`;
}

/* ---------- Cards: one card for apps, plugins and extensions ---------- */
export function card(e) {
  const k = kindOf(e.kind);
  return `<li class="card item"><a class="stretch" href="${esc(e.url_path)}"><span class="sr">${esc(e.name)}, </span></a>
${icon(e)}<div class="item-body"><h3>${esc(e.name)}</h3><p class="dim">${esc(e.summary)}</p>
<p class="meta">${badge(e)}<span class="dim">${esc(e.ownerInfo.name)} · ${esc(k.one)}</span></p></div></li>`;
}
const grid = (list) => `<ul class="grid cards">${list.map(card).join("")}</ul>`;
const chips = (cats, label = "Categories") => (cats.length ? `<nav class="chips" aria-label="${label}"><ul>${cats.map((c) => `<li><a class="chip" href="/categories/${esc(c.slug)}">${esc(c.name)}</a></li>`).join("")}</ul></nav>` : "");
const crumbs = (...links) => `<nav class="crumbs" aria-label="You are here">${[["/", "Hub"], ...links].map(([h, t]) => `<a href="${esc(h)}">${esc(t)}</a>`).join('<span aria-hidden="true"> / </span>')}</nav>`;

/* ---------- Home: search, categories, the three kinds, featured, new ---------- */
export function home(idx, assets) {
  const n = (k) => idx.entries.filter((e) => e.kind === k).length;
  const tabs = KINDS.map((k) => `<li><a href="/${k.dir}">${k.many}<span class="eyebrow">${n(k.kind)}</span><span class="sr"> - ${esc(k.blurb)}</span></a></li>`).join("");
  const featured = idx.featured.length ? idx.featured : idx.entries.slice(0, 6);
  const fresh = idx.newest.filter((e) => !featured.includes(e)).slice(0, 6);
  return page({
    title: "WolOS Hub - apps, plugins and extensions for WolOS", path: "/", assets, search: "hero",
    desc: "Find apps, plugins and extensions for WolOS, or publish your own. Every listing shows who made it and what its check found.",
    body: `<section class="hero wrap"><p class="eyebrow">WolOS Hub</p><h1>Apps, plugins and extensions for your desktop</h1>
<p class="lead">From WolOS and from people like you. See who made each one, and what its check found, before you install it.</p>
<form class="find find-lg" role="search" action="/search" method="get"><label class="sr" for="q">Search the hub</label><input id="q" name="q" type="search" placeholder="Search apps, plugins and extensions" autocomplete="off" enterkeyhint="search"><button class="btn btn-solid" type="submit">Search</button></form>
${chips(idx.categories)}</section>
<section class="wrap kinds" aria-labelledby="browse"><h2 id="browse" class="sr">Browse</h2><nav class="tabs" aria-label="Kinds"><ul>${tabs}</ul></nav></section>
<section class="wrap block" aria-labelledby="feat"><h2 id="feat">Featured</h2>${grid(featured)}</section>
${fresh.length ? `<section class="wrap block" aria-labelledby="new"><h2 id="new">New and updated</h2>${grid(fresh)}</section>` : ""}
<section class="wrap block" aria-labelledby="pub"><div class="card publish-door"><div><h2 id="pub">Publish your app</h2><p class="dim">Sign in with GitHub, accept the agreements, link your repository and push a tag. Your files stay on GitHub; the hub checks each version and shows it to everyone on WolOS.</p></div><a class="btn btn-solid" href="/publish">Publish your app</a></div></section>`,
  });
}

/* ---------- A kind: /apps /plugins /extensions ---------- */
export function kindPage(k, idx, assets) {
  const list = idx.entries.filter((e) => e.kind === k.kind);
  const cats = idx.categories.filter((c) => c.entries.some((e) => e.kind === k.kind));
  return page({
    title: `${k.many} - WolOS Hub`, path: `/${k.dir}`, assets,
    desc: `${k.blurb} ${plural(list.length, k.one)} on WolOS Hub.`,
    body: `<section class="wrap block">${crumbs()}<h1 class="h-xl">${k.many}</h1><p class="lead">${esc(k.blurb)}</p>
${chips(cats)}
${list.length ? grid(list) : `<p class="dim">No ${k.many.toLowerCase()} are listed right now. <a href="/publish">Publish the first one.</a></p>`}</section>`,
  });
}

/* ---------- A category, across the three kinds ---------- */
export function categoryPage(c, idx, assets) {
  const others = idx.categories.filter((x) => x !== c);
  return page({
    title: `${c.name} - WolOS Hub`, path: `/categories/${c.slug}`, assets,
    desc: `${c.name}: ${plural(c.entries.length, "listing")} on WolOS Hub.`,
    body: `<section class="wrap block">${crumbs()}<p class="eyebrow">Category</p><h1 class="h-xl">${esc(c.name)}</h1>
${grid(c.entries)}${others.length ? `<h2 class="h-md gap">More categories</h2>${chips(others, "More categories")}` : ""}</section>`,
  });
}

/* ---------- A listing ---------- */
function shotsHtml(e, images) {
  const html = (e.shotRefs || []).map((s) => (s.legacy ? picHtml(images, s.src, s.alt)
    : `<a class="pic" href="${esc(s.url)}" data-lightbox="" data-webp="" data-w="${s.w}" data-fw="${s.w}" data-fh="${s.h}"><img src="${esc(s.url)}" width="${s.w}" height="${s.h}" alt="${esc(s.alt)}" loading="lazy" decoding="async" style="max-width:${s.w}px"></a>`)).join("");
  return html ? `<section aria-labelledby="shots"><h2 id="shots" class="sr">Pictures</h2><div class="shots">${html}</div></section>` : "";
}
const history = (e) => `<section aria-labelledby="rels" class="gap"><h2 id="rels">Release history</h2><ul class="card hist">${e.releases.map((r) => {
  const c = checked(r);
  return `<li><a class="hist-v" href="${esc(versionPath(e, r))}">${esc(r.version)}</a><span class="dim">${day(r.first_seen)}</span>${badgeOf(c.tone, c.short)}<span class="dim hist-size">${bytes(r.size)}</span></li>`;
}).join("")}</ul></section>`;

export function listing(e, assets, images, NAMES) {
  const k = kindOf(e.kind), t = trustRow(e), r = latest(e), c = checked(r);
  const out = r.withdrawn || r.yanked;
  const asks = [...(e.permissions || []), ...(e.capabilities || [])].map((p) => PERMISSIONS[p] || p);
  const where = (e.kinds || []).map((x) => WORKS_IN[x] || x);
  const wi = e.host ? `<p class="dim">Extends <a href="/apps/${esc(e.host)}">${esc(NAMES.get(e.host) || e.host)}</a>.</p>` : "";
  const shots = shotsHtml(e, images);
  return page({
    title: `${e.name} - ${k.many} - WolOS Hub`, path: e.url_path, assets, scripts: shots ? [assets.pictures] : [],
    desc: `${e.summary} ${t.label}.`.slice(0, 200),
    body: `<article class="wrap block listing">
${crumbs([`/${k.dir}`, k.many])}
<header class="l-head">${icon(e, true)}<div><h1 class="h-xl">${esc(e.name)}</h1><p class="lead">${esc(e.summary)}</p>
<p class="meta"><a href="${ownerPath(e.owner)}">${esc(e.ownerInfo.name)}</a><span class="dim">${esc(k.one)}</span><span class="dim">Version ${esc(r.version)}</span><span class="dim">${esc(e.license)}</span>${(e.categories || []).map((x) => `<span class="dim">${esc(x)}</span>`).join("")}</p></div></header>
${trustBox(t, "Who made it", sigHtml(authorLine(e), "Signature line", "The maker's certificate in one line. WolOS reads the same line when it checks a file from them."))}
<section class="get card" aria-label="Download"><div><h2 class="h-md">${esc(e.name)} ${esc(r.version)}</h2><p class="dim">${out ? esc(c.text) : `Needs WolOS ${esc(e.min_wolos)} or newer. The file comes straight from GitHub, and WolOS checks it again on your PC before anything installs.`}</p></div>
<p class="get-btns">${out ? "" : `<a class="btn btn-solid" href="${esc(r.url)}">Download</a>`}<a class="btn btn-quiet" href="https://github.com/${esc(e.source.repo)}">Source on GitHub</a></p></section>
${wi}
${shots}
<div class="l-cols"><section class="prose" aria-labelledby="about"><h2 id="about">About</h2>${[].concat(e.description || e.summary).map((p) => `<p>${esc(p)}</p>`).join("")}</section>
<aside class="side" aria-label="Details">
<section><h2 class="h-sm">What it can do</h2>${asks.length ? `<ul class="plain">${asks.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : `<p class="dim">It asks for no extra access.</p>`}</section>
${where.length ? `<section><h2 class="h-sm">Where it lives</h2><p class="dim">${esc(where.join(", ").replace(/^./, (m) => m.toUpperCase()))}</p></section>` : ""}
<section><h2 class="h-sm">${esc(c.head)}</h2>${checkedHtml(c)}<p><a href="${esc(versionPath(e, r))}">Details and offline check</a></p><p class="dim small">A clean check means no rule was broken. It is not a promise about the ${esc(k.one)}.</p></section>
<section><h2 class="h-sm">Problem?</h2><p><a href="/report?listing=${encodeURIComponent(e.id)}">Report this ${esc(k.one)}</a></p></section>
</aside></div>
${history(e)}
</article>`,
  });
}

/* ---------- One version: its signed statement and the offline check ---------- */
export const VERIFY_CMD = (file, st) => `wol trust verify ${file} --file-cert ${st}`;
/* Signature lines: a certificate in one line of angle-bracket fields, the form WolOS shows and checks
   (TRUST-core-5). The index may carry the line itself (`line`); otherwise it is put together from the fields.
   A line is shown only when every field is known. */
const ymd = (s) => new Date(s * 1000).toISOString().slice(0, 10);
const sigLine = (parts) => (parts.every((p) => p != null && p !== "") ? parts.map((p) => `<${p}>`).join(" ") : "");
/** The file certificate of one version: <WolOS Index> <wolos.org/hub/APP/VERSION> <author: ID> <sha512:HASH> <checked YYYY-MM-DD> <pass|flag> <rkdb:SERIAL> */
export function fileCertLine(e, r) {
  const fc = r.file_certificate;
  if (!fc) return "";
  if (fc.line) return fc.line;
  const at = fc.checked_at || r.checked_at, verdict = fc.verdict || r.verdict;
  return sigLine(["WolOS Index", `wolos.org/hub/${e.id}/${r.version}`, (fc.author || r.cert || e.cert) && `author: ${fc.author || r.cert || e.cert}`,
    (fc.sha512 || r.sha512) && `sha512:${fc.sha512 || r.sha512}`, at && `checked ${ymd(at)}`, /^(pass|flag)$/.test(verdict) ? verdict : "", fc.serial && `rkdb:${fc.serial}`]);
}
/** The author's certificate on a listing: <WolOS Hub> <author: ID> <github: LOGIN> <origin|trusted|wolos> */
export function authorLine(e) {
  if (e.author_line) return e.author_line;
  const id = e.cert || e.ownerInfo.cert;
  if (!id || !["wolos", "trusted", "origin"].includes(e.trust)) return "";
  return sigLine(["WolOS Hub", `author: ${id}`, `github: ${e.owner.login}`, e.trust]);
}
const sigHtml = (line, label, why) => (line ? `<div class="sig"><p class="eyebrow">${label}</p><pre><code>${esc(line)}</code></pre><p class="dim small">${why}</p></div>` : "");
const fileName = (u) => u.split("/").pop();

export function version(e, r, assets, statementUrl) {
  const k = kindOf(e.kind), t = trustRow(e, r), c = checked(r);
  const file = fileName(r.url), st = `${e.id}-${r.version}.wsig`;
  const gh = r.tag ? `https://github.com/${e.source.repo}/releases/tag/${r.tag}` : `https://github.com/${e.source.repo}/releases`;
  const cmd = statementUrl ? VERIFY_CMD(file, st) : `sha256sum ${file}`;
  const fcl = fileCertLine(e, r);
  return page({
    title: `${e.name} ${r.version} - WolOS Hub`, path: versionPath(e, r), assets,
    desc: `${e.name} ${r.version}: ${c.head}.`,
    body: `<article class="wrap narrow-col block">
${crumbs([`/${k.dir}`, k.many], [e.url_path, e.name])}
<header class="l-head">${icon(e)}<div><h1 class="h-xl">${esc(e.name)} ${esc(r.version)}</h1><p class="meta"><span class="dim">Released ${day(r.first_seen)}</span><span class="dim">${bytes(r.size)}</span>${r.tag ? `<a href="${esc(gh)}">Tag ${esc(r.tag)} on GitHub</a>` : ""}</p></div></header>
${trustBox(t, "Who made it")}
<section class="card statement statement-${c.tone}" aria-labelledby="st"><h2 id="st" class="h-md">${esc(c.head)}</h2>${checkedHtml(c)}
${r.tag ? `<p class="dim">Taken from the release ${esc(r.tag)} of ${esc(e.source.repo)} on GitHub.</p>` : ""}
<div class="hash"><span class="eyebrow">sha256</span><code>${esc(r.sha256)}</code><button type="button" class="copy" data-copy="${esc(r.sha256)}" aria-label="Copy the sha256 of ${esc(r.version)}">Copy</button></div>
${sigHtml(fcl, "Signature line", "The file certificate of this version in one line: who checked it, which file, whose it is, what the check found and its number.")}
<p class="get-btns">${r.withdrawn || r.yanked ? "" : `<a class="btn btn-solid" href="${esc(r.url)}">Download ${esc(r.version)}</a>`}<a class="btn btn-quiet" href="/report?listing=${encodeURIComponent(e.id)}&amp;version=${encodeURIComponent(r.version)}">Report this version</a></p></section>
<details class="card offline" id="offline"${statementUrl ? ` data-statement="${esc(statementUrl)}" data-name="${esc(st)}"` : ""}><summary class="btn btn-quiet">Verify offline</summary>
<div class="offline-body"><p class="dim">${statementUrl ? "The file certificate is the hub's signed record of this check. With it, WolOS confirms the file without asking the hub, even with no connection." : "Compare the file's fingerprint with the sha256 above."}</p>
<ol class="steps-sm"><li>Download <a href="${esc(r.url)}">the file</a>.</li>${statementUrl ? `<li>Download <a href="${esc(statementUrl)}" download="${esc(st)}">the file certificate</a>. Opening this panel starts that download.</li>` : ""}<li>In the folder with ${statementUrl ? "both" : "the file"}, run:</li></ol>
<div class="code"><pre><code>${esc(cmd)}</code></pre><button type="button" class="copy" data-copy="${esc(cmd)}">Copy</button></div></div></details>
<p class="gap"><a href="${esc(e.url_path)}#rels">Every version of ${esc(e.name)}</a></p>
</article>`,
  });
}

/* ---------- Author and organisation ---------- */
export function ownerPage(o, assets) {
  const org = o.kind !== "person";
  const gh = o.kind === "wolos" ? "https://github.com/wonderlandos" : `https://github.com/${o.login}`;
  const who = `${o.name} (${o.login} on GitHub)`;
  const since = o.since ? ` since ${monthYear(o.since)}` : "";
  const T = {
    wolos: ["wolos", TRUST_LABEL.wolos, "Made by WolOS", "Everything WolOS lists is built and signed by WolOS itself."],
    trusted: ["trusted", TRUST_LABEL.trusted, `Trusted developer ${o.name}`, `${who}. WolOS Hub verified the identity of this ${org ? "organisation" : "developer"} by hand${since}.`],
    origin: ["origin", TRUST_LABEL.origin, who, `Their releases are signed with a certificate that ties each file to this GitHub account and its repository${since}.`],
    community: ["community", TRUST_LABEL.community, who, `Nobody vouches for who ${org ? "they are" : "this is"} beyond their GitHub account.`],
  }[o.trust] || ["community", TRUST_LABEL.community, who, ""];
  return page({
    title: `${o.name} - WolOS Hub`, path: ownerPath(o), assets,
    desc: `${o.about || `${o.name} on WolOS Hub.`}`.slice(0, 200),
    body: `<section class="wrap block">${crumbs()}
<header class="l-head"><span class="tile tile-lg t-${o.trust === "wolos" ? "wolos" : "system"}" aria-hidden="true">${esc([...o.name][0].toUpperCase())}</span><div><p class="eyebrow">${org ? "Organisation" : "Developer"}</p><h1 class="h-xl">${esc(o.name)}</h1>${o.about ? `<p class="lead">${esc(o.about)}</p>` : ""}</div></header>
${trustBox({ tone: T[0], label: T[1], line: T[2], sentence: T[3] }, "Who this is")}
<p class="gap"><a href="${esc(gh)}">${esc(o.login)} on GitHub</a></p>
<h2 class="gap">${o.entries.length ? `Listed by ${esc(o.name)}` : "Listings"}</h2>${o.entries.length ? grid(o.entries) : '<p class="dim">Nothing is listed here right now.</p>'}</section>`,
  });
}

/* ---------- Search shell ---------- */
export const search = (assets) => page({
  title: "Search - WolOS Hub", path: "/search", assets, noindex: true, desc: "Search apps, plugins and extensions on WolOS Hub.", scripts: [assets.search],
  body: `<section class="wrap block"><h1 class="h-xl">Search</h1><p id="count" class="dim" role="status" aria-live="polite">Type a name, a maker or a few words.</p><ul class="grid cards" id="results"></ul>
<p id="none" class="dim" hidden>Nothing matches. Try a shorter word, or browse the <a href="/apps">apps</a>, <a href="/plugins">plugins</a> or <a href="/extensions">extensions</a>.</p>
<noscript><p>Searching needs JavaScript. You can also <a href="/apps">browse the apps</a>, <a href="/plugins">plugins</a> or <a href="/extensions">extensions</a>.</p></noscript></section>`,
});

/* ---------- Report ---------- */
export const report = (assets) => page({
  title: "Report a problem - WolOS Hub", path: "/report", assets, noindex: true, scripts: [assets.account],
  desc: "Tell the moderators about an app, plugin or extension on WolOS Hub that is harmful, copied or broken.",
  body: `<section class="wrap narrow-col block">${crumbs()}<h1 class="h-xl">Report a problem</h1>
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
<p data-msg="listing" hidden>Give the id of the listing.</p><p data-msg="reason" hidden>Choose what is wrong.</p><p data-msg="text" hidden>Tell us what happened.</p>
<noscript><p>Reporting needs JavaScript in your browser.</p></noscript></section>`,
});

/* ---------- Sign-in trouble and 404 ---------- */
export const signin = (assets) => page({
  title: "Sign in - WolOS Hub", path: "/signin", assets, noindex: true, scripts: [assets.account], desc: "Sign in to WolOS Hub with GitHub.",
  body: `<section class="wrap narrow-col block"><h1 class="h-xl">Sign in</h1><p class="lead" id="signin-msg">Sign in with your GitHub account to publish and to send reports.</p>
<p data-why="denied" hidden>You cancelled the sign-in on GitHub.</p><p data-why="state" hidden>The sign-in took too long or started on another page. Try again.</p><p data-why="banned" hidden>This account can't sign in to the hub.</p><p data-why="other" hidden>The sign-in did not finish. Try again.</p>
<p><a class="btn btn-solid" href="/auth/login?next=%2Fdashboard">Sign in with GitHub</a></p></section>`,
});
/* ---------- The agreements and policies ---------- */
/** The "In short" box: the text's own summary, marked as not binding wherever it is shown. */
const shortBox = (t, small = false) => {
  if (!t.short) return "";
  const note = t.short.note ? t.short.note.replace(/^./, (c) => c.toUpperCase()).replace(/\.?$/, ".") : "Not the binding text.";
  return `<aside class="short${small ? " short-sm" : ""}" aria-label="In short, not binding"><p class="short-head"><strong>In short</strong><span class="tag">Not binding</span></p>
<div class="short-body">${t.short.lines.map((l) => `<p>${l.html}</p>`).join("")}</div><p class="short-note">${esc(note)}</p></aside>`;
};
const termsCrumbs = () => `<nav class="crumbs" aria-label="You are here"><a href="/">Hub</a><span aria-hidden="true"> / </span><a href="/terms">Terms</a></nav>`;

export function termsIndex(all, assets) {
  const item = (t) => `<li class="card terms-card"><h2 class="h-md"><a href="/terms/${t.doc}">${esc(t.title)}</a></h2>
<p class="meta">${t.found && t.versionLine ? `<span class="dim">${esc(t.versionLine)}</span>` : ""}${t.binds ? `<span class="dim">${esc(t.binds.replace(/^./, (c) => c.toUpperCase()))}</span>` : ""}</p>
${t.found ? shortBox(t, true) : `<p class="dim">This text is being written.</p>`}
<p><a href="/terms/${t.doc}">Read the ${esc(t.title)}</a></p></li>`;
  return page({
    title: "Terms - WolOS Hub", path: "/terms", assets,
    desc: "The agreements and policies of WolOS Hub, each with a short summary in plain words.",
    body: `<section class="wrap block">${crumbs()}<h1 class="h-xl">Terms</h1>
<p class="lead">The agreements and policies of WolOS Hub. Each one starts with a short summary in plain words. The summary helps you read; the numbered sections are what counts.</p>
<ul class="terms-grid">${all.map(item).join("")}</ul></section>`,
  });
}

export function terms(t, all, assets) {
  const others = all.filter((x) => x !== t).map((x) => `<li><a href="/terms/${x.doc}">${esc(x.title)}</a></li>`).join("");
  const toc = t.found && t.toc.length ? `<nav class="toc" aria-labelledby="toc-h"><h2 id="toc-h" class="eyebrow">On this page</h2><ol>${t.toc.map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join("")}</ol></nav>` : "";
  return page({
    title: `${t.title} - WolOS Hub`, path: `/terms/${t.doc}`, assets, desc: t.short ? t.short.lines.map((l) => l.text).join(" ").slice(0, 200) : `The ${t.title} of WolOS Hub.`,
    body: `<article class="wrap block legal-doc">${termsCrumbs()}<h1 class="h-xl">${esc(t.title)}</h1>
${t.found ? `<p class="legal-meta dim">${esc(t.versionLine || [t.version && `Version ${t.version}`, t.effective && `effective ${t.effective}`].filter(Boolean).join(", "))}</p>
<div class="legal-cols">${shortBox(t)}${toc}
<div class="prose legal-text">${t.html}</div>
<footer class="legal-foot card"><p><a class="btn btn-quiet" href="/terms/${t.doc}.txt" download="wolos-hub-${t.doc}.txt">Download as text</a></p>
<div class="hash"><span class="eyebrow">sha256</span><code>${esc(t.listed || t.sha256)}</code><button type="button" class="copy" data-copy="${esc(t.listed || t.sha256)}" aria-label="Copy the sha256 of the ${esc(t.title)}">Copy</button></div>
<p class="dim small">The fingerprint of this exact text. When you accept it, the hub records this fingerprint with the version and the time.</p></footer></div>`
  : `<p class="lead">This text is being written. It appears here as soon as it is ready.</p>`}
<nav class="gap" aria-label="Other terms"><h2 class="h-sm">Other terms</h2><ul class="plain other-terms">${others}</ul><p><a href="/terms">All terms, with their summaries</a></p></nav></article>`,
  });
}

export const notFound = (assets) => page({
  title: "Not found - WolOS Hub", path: "/404", assets, noindex: true, desc: "This page is not on WolOS Hub.",
  body: `<section class="wrap narrow-col block"><h1 class="h-xl">There is nothing here</h1><p class="lead">The page you wanted is not on the hub. It may have been renamed or withdrawn.</p><p><a class="btn btn-solid" href="/">Back to the hub</a></p></section>`,
});
