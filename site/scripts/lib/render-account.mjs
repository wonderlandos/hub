// SPDX-License-Identifier: GPL-2.0-or-later
// The pages for people who publish: the publishing steps, the dashboard of a developer or an organisation,
// and the shell of the closed admin page. Their live parts come from the Worker; the words are here, in
// <template> elements that src/account.js fills in. The admin page carries no words at all.
import { esc } from "./html.mjs";
import { page, head } from "./render.mjs";

const crumbs = `<nav class="crumbs" aria-label="You are here"><a href="/">Hub</a></nav>`;
const copyCode = (text, slot = "") => `<div class="code"><pre><code${slot ? ` data-slot="${slot}"` : ""}>${esc(text)}</code></pre><button type="button" class="copy" data-copy="${esc(text)}"${slot ? ` data-copy-slot="${slot}"` : ""}>Copy</button></div>`;

/* One agreement: its text, a box to tick, and what you accepted. */
const terms = (doc, name, why) => `<div class="terms" data-doc="${doc}"><h3 class="h-sm">${name}</h3><p class="dim">${why} <a href="/terms/${doc}">Read it on its own page</a>.</p>
<div data-state="need" hidden><div class="card cla" tabindex="0" role="region" aria-label="${name}" data-slot="text"></div>
<form data-form="terms"><label class="check"><input type="checkbox" name="agree" required> I have read the ${name} and accept it.</label><p class="err" role="alert" data-err></p><button class="btn btn-solid" type="submit">Accept the ${name}</button></form></div>
<p data-state="ok" hidden role="status">You accepted version <span data-slot="version"></span>.</p></div>`;

/* The certificate card: origin (automatic) and trusted (applied for), and how to ask. */
export const CERT_TEMPLATE = `<template id="t-certs"><div class="certs">
<section class="card cert" data-tier="origin"><h3 class="h-md">Origin certificate</h3>
<p class="dim">Shows who made each file and from which repository. The hub issues it by itself once you accept the agreements.</p>
<p class="cert-state" data-state="none">You have none yet. Ask for it below.</p>
<p class="cert-state" hidden data-state="pending">The hub has your request and is issuing the certificate. It shows here when it is ready.</p>
<p class="cert-state" hidden data-state="issued"><strong>Issued</strong> on <span data-slot="date"></span>. Your releases say "From" your name, account and repository.</p>
<p class="cert-state" hidden data-state="revoked"><strong>Revoked</strong> on <span data-slot="date"></span>. Files signed with it are withdrawn. Make new keys and ask again.</p>
<p class="dim small" data-slot-row="serial" hidden>Serial <code data-slot="serial"></code></p></section>
<section class="card cert" data-tier="trusted"><h3 class="h-md">Trusted developer certificate</h3>
<p class="dim">For developers and organisations WolOS Hub verifies by hand. Your listings then say "Trusted developer" with your name.</p>
<p class="cert-state" data-state="none">Apply below once your origin certificate is issued.</p>
<p class="cert-state" hidden data-state="pending">The hub has your application. A person from the hub reads it and may write to you on GitHub.</p>
<p class="cert-state" hidden data-state="issued"><strong>Issued</strong> on <span data-slot="date"></span>.</p>
<p class="cert-state" hidden data-state="refused"><strong>Not given.</strong> <span data-slot="reason"></span> You can apply again.</p>
<p class="cert-state" hidden data-state="revoked"><strong>Revoked</strong> on <span data-slot="date"></span>. Your listings show your origin certificate again.</p>
<p class="dim small" data-slot-row="serial" hidden>Serial <code data-slot="serial"></code></p></section>
<section class="card cert-ask" data-ask><h3 class="h-md">Ask for a certificate</h3>
<ol class="steps-sm"><li>On your WolOS PC, open a terminal and run this. It makes your keys, locks them with a passphrase you choose, and prints a request.</li></ol>
${copyCode("wol cert request", "cmd")}
<ol class="steps-sm" start="2"><li>Paste everything it printed, choose the certificate and send it.</li></ol>
<form data-form="cert" novalidate><fieldset class="field"><legend>Which certificate</legend>
<label class="check"><input type="radio" name="tier" value="origin" checked> Origin certificate, issued by the hub by itself</label>
<label class="check"><input type="radio" name="tier" value="trusted"> Trusted developer certificate, verified by hand</label></fieldset>
<div class="field"><label>What the command printed<textarea name="request" rows="6" spellcheck="false" autocomplete="off" required></textarea></label></div>
<div class="terms" data-doc="trust" data-inline=""><h3 class="h-sm">Trust Terms</h3><p class="dim">They say what a certificate promises, what the hub may do with it, and when it is revoked. You accept them with every request.</p>
<div class="card cla" tabindex="0" role="region" aria-label="Trust Terms" data-slot="text"></div>
<label class="check"><input type="checkbox" name="trust_ok" required> I have read the Trust Terms and accept them.</label></div>
<p class="err" role="alert" data-err="cert"></p><button class="btn btn-solid" type="submit" data-act="send-cert">Send the request</button></form>
<p hidden data-msg="bad-request">Paste the whole request, from the first line to the last, as the command printed it.</p></section>
</div></template>`;

/* ---------- Publish: the steps ---------- */
export const publish = (assets) => page({
  title: "Publish your app - WolOS Hub", path: "/publish", assets, scripts: [assets.account],
  desc: "Publish an app, plugin or extension on WolOS Hub: sign in with GitHub, accept the agreements, link your repository and push a tag.",
  body: `<section class="wrap narrow-col block">${crumbs}<h1 class="h-xl">Publish your app</h1>
<p class="lead">Apps, plugins and extensions all publish the same way. Your files stay on GitHub; the hub checks every version and lists it.</p>
<ol class="steps">
<li class="step" id="s-signin"><h2><span class="n" aria-hidden="true">1</span>Sign in</h2>
<p class="dim">Sign in with your GitHub account. The hub asks only for your public profile and the organisations you belong to.</p>
<div data-when="out"><a class="btn btn-solid" href="/auth/login?next=%2Fpublish">Sign in with GitHub</a></div>
<p data-when="in" hidden role="status">You are signed in as <strong data-me="login"></strong>.</p></li>
<li class="step" id="s-terms"><h2><span class="n" aria-hidden="true">2</span>Accept the agreements</h2>
<p class="dim">Read each one and accept it once. When one changes, you accept the new version before your next release.</p>
<div data-when="in" hidden class="terms-list">
${terms("cla", "Contributor Agreement", "You keep your work and let the hub list it.")}
${terms("publisher", "Publisher Agreement", "What you promise about the files you publish, and what the hub does when someone reports one.")}</div></li>
<li class="step" id="s-link"><h2><span class="n" aria-hidden="true">3</span>Link your repository</h2>
<p class="dim">Pick who publishes: you, or an organisation you own on GitHub. The id of your listing starts with that name and a dot, like <code>alice.notes</code>. The repository must be public and belong to the same person or organisation.</p>
<div data-when="orgs" hidden><h3 class="h-sm">Organisations</h3><ul class="plain" id="org-list"></ul><p class="err" role="alert" data-err="org"></p></div>
<template id="t-org"><li class="org-row"><span data-slot="text"></span><button type="button" class="btn btn-quiet" data-act="link-org">Link</button></li></template>
<p hidden data-msg="org-linked">is linked.</p><p hidden data-msg="org-yours">is yours on GitHub.</p><p hidden data-msg="you">(you)</p><p hidden data-msg="org">(organisation)</p>
<form id="listing-form" data-when="link" hidden>
<div class="field"><label for="f-owner">Publish as</label><select id="f-owner" name="owner"></select></div>
<div class="field"><label for="f-kind">What is it</label><select id="f-kind" name="kind"><option value="app">An app</option><option value="plugin">A plugin</option><option value="extension">An extension</option></select></div>
<div class="field" id="host-field" hidden><label for="f-host">Extends the app with this id</label><input id="f-host" name="host" type="text" autocomplete="off" spellcheck="false" placeholder="org.wolos.notes"></div>
<div class="field"><label for="f-id">Id</label><input id="f-id" name="id" type="text" required autocomplete="off" spellcheck="false" placeholder="alice.notes" pattern="[a-z0-9][a-z0-9\\-]*(\\.[a-z0-9][a-z0-9\\-]*)+"></div>
<div class="field"><label for="f-name">Name</label><input id="f-name" name="name" type="text" required maxlength="40" autocomplete="off"></div>
<div class="field"><label for="f-summary">One sentence about it</label><input id="f-summary" name="summary" type="text" required maxlength="200" autocomplete="off"><p class="hint dim">The icon, pictures and description come from your package itself, each time you release.</p></div>
<div class="field"><label for="f-license">Licence (like GPL-2.0-or-later or MIT)</label><input id="f-license" name="license" type="text" required maxlength="64" autocomplete="off" spellcheck="false"></div>
<div class="field"><label for="f-repo">Repository on GitHub</label><input id="f-repo" name="repo" type="text" required autocomplete="off" spellcheck="false" placeholder="alice/notes"></div>
<div class="field"><label for="f-asset">File name in your releases</label><input id="f-asset" name="asset" type="text" required maxlength="128" autocomplete="off" spellcheck="false" placeholder="alice.notes-*.wol"><p class="hint dim">An app ends in .wol, a plugin in .wolplug, an extension in .wolext. One star stands for the version.</p></div>
<p class="err" role="alert" data-err></p><button class="btn btn-solid" type="submit">Link the repository</button></form>
<p data-when="linked" hidden role="status"><strong>Linked.</strong> <span data-me="linked"></span> <span data-msg="linked-to" hidden>is linked to</span></p></li>
<li class="step" id="s-tag"><h2><span class="n" aria-hidden="true">4</span>A tag on GitHub publishes</h2>
<p class="dim">Push a tag and publish a release on GitHub with your file attached. That is all: the hub notices it, checks the file and lists it within about fifteen minutes.</p>
<div class="term"><div class="term-bar" aria-hidden="true"><span class="term-dot"></span><span class="term-dot"></span><span class="term-dot"></span></div>${copyCode("git tag v1.0.0\ngit push origin v1.0.0\ngh release create v1.0.0 alice.notes-1.0.0.wol")}</div>
<p class="dim">Each version is checked on its own and gets its own signed statement. Follow it on <a href="/dashboard">your dashboard</a>: checking, listed, or flagged with the reasons in plain words.</p></li>
<li class="step" id="s-cert"><h2><span class="n" aria-hidden="true">5</span>Sign your releases</h2>
<p class="dim">A certificate puts your name on every file you publish, and WolOS confirms it on every PC, even offline. Without one, your listings show "Community".</p>
<div data-when="in" hidden class="w100" id="certs"></div></li>
</ol>${CERT_TEMPLATE}</section>`,
});

/* ---------- Dashboard: one developer or organisation ---------- */
export const dashboard = (assets) => page({
  title: "Your dashboard - WolOS Hub", path: "/dashboard", assets, noindex: true, scripts: [assets.account],
  desc: "Your listings, versions, reports, certificates and organisation members on WolOS Hub.",
  body: `<section class="wrap block dash">${crumbs}<h1 class="h-xl">Your dashboard</h1>
<div data-when="out"><p class="lead">Sign in to see your listings, their versions and your certificates.</p><p><a class="btn btn-solid" href="/auth/login?next=%2Fdashboard">Sign in with GitHub</a></p></div>
<div data-when="in" hidden>
<nav class="seg seg-lg" aria-label="Whose dashboard" id="d-accounts"></nav>
<template id="t-account"><a href="/dashboard"></a></template>
<section aria-labelledby="d-l" class="gap"><h2 id="d-l">Listings</h2><div id="d-listings" class="dash-list"></div>
<p class="dim" id="d-none" hidden>Nothing is listed here yet. <a href="/publish">Link a repository</a> and push a tag.</p></section>
<template id="t-listing"><article class="card dl"><header class="dl-head"><h3><a data-slot="link"></a></h3><span class="dim" data-slot="kind"></span><span class="dim" data-slot="repo"></span></header><ul class="dl-vers"></ul></article></template>
<template id="t-version"><li class="dv"><span class="dv-v" data-slot="version"></span>
<span class="badge badge-community" data-status="checking"><span class="dot" aria-hidden="true"></span>Checking</span>
<span class="badge badge-trusted" data-status="listed"><span class="dot" aria-hidden="true"></span>Listed</span>
<span class="badge badge-community" data-status="flagged"><span class="dot" aria-hidden="true"></span>Flagged</span>
<span class="badge badge-withdrawn" data-status="withdrawn"><span class="dot" aria-hidden="true"></span>Withdrawn</span>
<span class="dim" data-slot="date"></span>
<p class="dim dv-why" data-why="checking">The hub is checking this version. It is listed within about fifteen minutes when the check finds nothing that stops it.</p>
<p class="dim dv-why" data-why="flag">Listed. People see these notes on the listing:</p>
<p class="dim dv-why" data-why="block">Not listed. Fix these and release again:</p>
<p class="dim dv-why" data-why="withdrawn">Not offered to install or as an update.</p>
<ul class="plain dv-find"></ul></li></template>
<section aria-labelledby="d-r" class="gap"><h2 id="d-r">Reports</h2><ul id="d-reports" class="card dash-rows"></ul><p class="dim" id="d-noreports">Nobody has reported anything about these listings.</p></section>
<template id="t-report"><li><span data-slot="listing"></span><span class="dim" data-slot="reason"></span><span class="dim" data-slot="date"></span><span class="badge" data-slot="state"></span></li></template>
<section aria-labelledby="d-c" class="gap"><h2 id="d-c">Certificates</h2><div id="certs"></div></section>
<section aria-labelledby="d-m" class="gap"><h2 id="d-m">Members and roles</h2><p class="dim" id="d-orgintro">From GitHub: who belongs to this organisation and what they may do there. Change it on GitHub.</p>
<p class="dim" id="d-solo" hidden>This is your own account. These are your organisations on GitHub and your role in each.</p><ul id="d-members" class="card dash-rows"></ul></section>
<template id="t-member"><li><span data-slot="login"></span><span class="dim" data-slot="role"></span></li></template>
<p hidden data-msg="role-owner">Owner: publishes, links repositories and asks for certificates</p><p hidden data-msg="role-member">Member</p>
<p hidden data-msg="r-open">Open</p><p hidden data-msg="r-closed">Closed</p>
</div>${CERT_TEMPLATE}</section>`,
});

/* ---------- Admin: a closed shell ----------
   No words, no links to it anywhere, not in the sitemap, noindex. The script asks the Worker for the queue;
   only when the Worker answers (the signed-in person has a role) does it load the panel's own script. */
export const admin = (assets, panelJs) => `${head("WolOS Hub", "", "/admin", assets, true, true)}
<body class="admin-shell">
<main id="main" tabindex="-1" data-admin="${esc(panelJs)}"></main>
<script src="${assets.js}" defer></script>
</body>
</html>
`;
