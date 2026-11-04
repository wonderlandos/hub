// SPDX-License-Identifier: GPL-2.0-or-later
// The pages for people who publish: the publishing steps, the dashboard of a developer or an organisation,
// and the shell of the closed admin page. Their live parts come from the Worker; the words are here, in
// <template> elements that src/account.js fills in. The admin page carries no words at all.
import { esc } from "./html.mjs";
import { page, head } from "./render.mjs";

const crumbs = `<nav class="crumbs" aria-label="You are here"><a href="/">Hub</a></nav>`;
const copyCode = (text, slot = "") => `<div class="code"><pre><code${slot ? ` data-slot="${slot}"` : ""}>${esc(text)}</code></pre><button type="button" class="copy" data-copy="${esc(text)}"${slot ? ` data-copy-slot="${slot}"` : ""}>Copy</button></div>`;

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

/* ---------- Publish: the steps ----------
   One page, five steps in a rail. The script folds the finished steps into a line, opens the one that needs the person and
   fills in what the hub knows (the Worker's one answer for the page). Without it the steps read as they are. */
const INSTALL = "https://github.com/apps/wolos-hub/installations/new";
const step = (n, id, title, body, sum) => `<article class="pstep card" id="${id}" data-step="${n}" data-state="todo"><h2>${title}</h2><span class="skel skel-line" aria-hidden="true"></span>
<div class="pbody">${body}</div><div class="psum">${sum}</div></article>`;
const rail = (n, title, sub) => `<li class="rail-item" data-step="${n}" data-state="todo"><span class="rail-dot"><span>${n}</span></span><div><strong>${title}</strong><span class="dim" data-slot="sub">${sub}</span></div></li>`;

export const publish = (assets) => page({
  title: "Publish your app - WolOS Hub", path: "/publish", assets, scripts: [assets.publish],
  desc: "Publish an app, plugin or extension on WolOS Hub: sign in with GitHub, accept the agreements, install the hub on your repository, connect it and push a tag.",
  body: `<section class="wrap block" data-overview="publish" data-pending>${crumbs}<h1 class="h-xl">Publish your app</h1>
<p class="lead">Apps, plugins and extensions publish the same way. Your files stay on GitHub; the hub checks every version and lists it.</p>
<div class="pub">
<ol class="rail" aria-label="The steps" id="rail">${rail(1, "Sign in", "With your GitHub account")}${rail(2, "Agreements", "Two texts, accepted once")}${rail(3, "Install on GitHub", "So the hub sees your releases")}${rail(4, "Connect a repository", "Pick one, say what it is")}${rail(5, "Push a tag", "The hub does the rest")}</ol>
<div class="pub-main">
${step(1, "s-signin", "Sign in", `<p class="dim">Sign in with your GitHub account. The hub asks only for your public profile and the organisations you belong to.</p>
<a class="btn btn-solid" href="/auth/login?next=%2Fpublish">Sign in with GitHub</a>`, `<p role="status">You are signed in as <strong data-me="login"></strong>.</p>`)}
${step(2, "s-terms", "Accept the agreements", `<p class="dim">Read both and accept them once. When one changes, you accept the new version before your next release.</p>
<div class="seg" role="group" aria-label="Which agreement" id="agree-tabs"><button type="button" data-doc="cla" aria-pressed="true">Contributor Agreement</button><button type="button" data-doc="publisher" aria-pressed="false">Publisher Agreement</button></div>
<div class="card cla w100" tabindex="0" role="region" aria-label="The agreement" id="agree-text"></div>
<p class="dim small"><a href="/terms/cla" id="agree-link">Read it on its own page</a></p>
<form id="agree-form" novalidate>
<label class="check" data-doc="cla"><input type="checkbox" name="cla"> I have read the Contributor Agreement and accept it.</label>
<label class="check" data-doc="publisher"><input type="checkbox" name="publisher"> I have read the Publisher Agreement and accept it.</label>
<p class="err" role="alert" data-err></p><button class="btn btn-solid" type="submit">Accept and continue</button></form>
<p hidden data-msg="tick">Tick the box for each agreement to accept it.</p>
<p hidden data-msg="changed-cla">The Contributor Agreement has a new version. Read it and accept it before your next release.</p>
<p hidden data-msg="changed-publisher">The Publisher Agreement has a new version. Read it and accept it before your next release.</p>`,
  `<p role="status">Agreements accepted: version <span data-slot="versions"></span>. <a href="/dashboard#agreements">See them</a></p>`)}
${step(3, "s-install", "Install WolOS Hub on GitHub", `<p class="dim" data-inst="none">Install WolOS Hub on the repositories you publish from. The hub uses it to see your releases.</p>
<p class="dim" data-inst="private" hidden>WolOS Hub is installed, but only on private repositories. People download your files from your releases, so the repository must be public. Make one public on GitHub, then come back.</p>
<p class="get-btns"><a class="btn btn-solid" id="inst-link" href="${INSTALL}" rel="noopener">Install on GitHub</a><button type="button" class="btn btn-quiet" data-act="inst-check">I have installed it</button></p>
<p class="err" role="alert" data-err="inst"></p>`,
  `<p role="status"><span data-slot="inst-sum"></span> <a href="${INSTALL}" rel="noopener">Add more repositories</a></p>`)}
${step(4, "s-connect", "Connect a repository", `<p class="dim">Pick the repository you publish from. The hub fills in the rest from GitHub; you can change it.</p>
<ul class="repos" id="repo-list" role="radiogroup" aria-label="Your repositories"></ul>
<template id="t-repo"><li><label class="repo"><input type="radio" name="repo"><span class="rname" data-slot="name"></span><span class="dim" data-slot="desc"></span><span class="badge" data-slot="badge"></span><span class="dim rnote" data-slot="note"></span></label></li></template>
<template id="t-repo-org"><li class="repo" data-note=""><span class="rname" data-slot="name"></span><span class="dim rnote" data-slot="note"></span><button type="button" class="btn btn-quiet" data-act="link-org">Link</button></li></template>
<fieldset class="pick" id="kind-pick"><legend>What is it</legend><label><input type="radio" name="kind" value="app" checked> App</label><label><input type="radio" name="kind" value="plugin"> Plugin</label><label><input type="radio" name="kind" value="extension"> Extension</label></fieldset>
<p class="listed-as" id="listed-as"><strong>It will be listed as <span data-slot="id"></span></strong><br><span class="dim">Releases need a file named <code data-slot="asset"></code>. One star stands for the version.</span></p>
<details class="det"><summary>Change the details</summary>
<form id="listing-form" novalidate>
<div class="field" id="host-field" hidden><label for="f-host">The app it extends (its id)</label><input id="f-host" name="host" type="text" autocomplete="off" spellcheck="false" placeholder="org.wolos.notes"></div>
<div class="field"><label for="f-id">Id</label><input id="f-id" name="id" type="text" autocomplete="off" spellcheck="false"></div>
<div class="field"><label for="f-name">Name</label><input id="f-name" name="name" type="text" maxlength="40" autocomplete="off"></div>
<div class="field"><label for="f-summary">One sentence about it</label><input id="f-summary" name="summary" type="text" maxlength="200" autocomplete="off"><p class="hint dim">The icon, pictures and description come from your package, each time you release.</p></div>
<div class="field"><label for="f-license">Licence (like GPL-2.0-or-later or MIT)</label><input id="f-license" name="license" type="text" maxlength="64" autocomplete="off" spellcheck="false"></div>
<div class="field"><label for="f-asset">File name in your releases</label><input id="f-asset" name="asset" type="text" maxlength="128" autocomplete="off" spellcheck="false"><p class="hint dim">An app ends in .wol, a plugin in .wolplug, an extension in .wolext. One star stands for the version.</p></div>
</form></details>
<p class="err" role="alert" data-err="connect"></p>
<p class="get-btns"><button type="button" class="btn btn-solid" id="connect-go" data-act="connect">Connect</button></p>`,
  `<p role="status"><span data-slot="conn-sum"></span> <a href="/publish#s-connect" data-act="more">Connect another</a></p>`)}
${step(5, "s-tag", "Push a tag", `<p class="dim">Push a tag and publish a release on GitHub with your file attached. That is all: the hub notices it, checks the file and lists it within about an hour.</p>
<div class="term w100"><div class="term-bar" aria-hidden="true"><span class="term-dot"></span><span class="term-dot"></span><span class="term-dot"></span></div><div class="code"><pre><code id="tag-cmd"></code></pre><button type="button" class="copy" id="tag-copy" data-copy="">Copy</button></div></div>
<p class="dim" id="tag-wait"><span class="wait-dot" aria-hidden="true"></span>Waiting for your tag. This page notices it.</p>
<p class="get-btns" id="tag-seen" hidden><a class="btn btn-solid" id="tag-link" href="/dashboard">See where it stands</a></p>
<p class="dim small">Each version is checked on its own and gets its own signed statement. The same steps work from the terminal with <code>wol publish</code>. To show your name on your releases, <a href="/dashboard#certs">sign them with a certificate</a>.</p>`, `<p role="status">Your next release goes through this page.</p>`)}
</div></div>
<p hidden data-msg="signed-as">Signed in as</p><p hidden data-msg="accepted">Accepted</p><p hidden data-msg="read-two">Two texts, accepted once</p>
<p hidden data-msg="installed-on">Installed on</p><p hidden data-msg="so-hub-sees">So the hub sees your releases</p>
<p hidden data-msg="connected">Connected</p><p hidden data-msg="pick-one">Pick one, say what it is</p>
<p hidden data-msg="conn-as">Connected as</p><p hidden data-msg="private">Private. Make it public on GitHub to publish it.</p>
<p hidden data-msg="link-why">Owned by an organisation you own on GitHub. Linking accepts the Contributor Agreement for it.</p><p hidden data-msg="link-owner">Owned by an organisation. An owner of it links it to the hub first.</p>
<p hidden data-msg="not-yours">Not yours. Only its owner can publish it.</p><p hidden data-msg="public">Public</p><p hidden data-msg="connect">Connect</p>
<p hidden data-msg="listed-as">is listed as</p><p hidden data-msg="see">See where it stands:</p>
</section>`,
});

/* ---------- Dashboard: one developer or organisation ---------- */
export const dashboard = (assets) => page({
  title: "Your dashboard - WolOS Hub", path: "/dashboard", assets, noindex: true, scripts: [assets.certcmd, assets.dashboard],
  desc: "Your listings, versions, reports, certificates and organisation members on WolOS Hub.",
  body: `<section class="wrap block dash" data-overview="dashboard" data-pending>${crumbs}<h1 class="h-xl">Your dashboard</h1>
<div data-when="out"><p class="lead">Sign in to see your listings, their versions and your certificates.</p><p><a class="btn btn-solid" href="/auth/login?next=%2Fdashboard">Sign in with GitHub</a></p></div>
<div data-when="in" hidden>
<nav class="seg seg-lg" aria-label="Whose dashboard" id="d-accounts"></nav>
<template id="t-account"><a href="/dashboard"></a></template>
<div class="dgrid">
<nav class="dnav" aria-label="On this page"><a href="#d-l">Listings</a><a href="#certs">Certificates</a><a href="#agreements">Agreements</a><a href="#d-r">Reports</a><a href="#d-m">Members</a></nav>
<div class="dmain">
<section class="att card" id="d-att-s" aria-labelledby="d-att-h" hidden><h2 id="d-att-h">Needs your attention</h2><ul class="plain" id="d-att"></ul></section>
<template id="t-att"><li><span data-slot="text"></span> <a data-slot="link">See why</a></li></template>
<section aria-labelledby="d-l" class="gap"><h2 id="d-l">Listings</h2><span class="skel skel-line" aria-hidden="true"></span><div id="d-listings" class="dash-list keep-pending"></div>
<p class="dim" id="d-none" hidden>Nothing is connected here yet.</p><p id="d-add"><a class="card dl-add" href="/publish#s-connect">Connect a repository</a></p></section>
<template id="t-listing"><article class="card dl"><header class="dl-top"><span class="tile" aria-hidden="true" data-slot="tile"></span><div><h3><a data-slot="link"></a></h3><p class="dim small"><span data-slot="kind"></span> <span data-slot="repo"></span> <code data-slot="id"></code></p></div><span class="badge badge-community" data-slot="badge"><span class="dot" aria-hidden="true"></span><span data-slot="badge-text"></span></span></header>
<div class="dl-latest" data-slot="latest" hidden><strong>Latest: <span data-slot="lv"></span></strong><div data-slot="track"></div><p class="dim" data-slot="lhead"></p></div>
<ul class="dl-vers"></ul><button type="button" class="btn btn-quiet dl-more" hidden>Show all versions</button></article></template>
<template id="t-version"><li class="dv"><span class="dv-v" data-slot="version"></span><span class="badge badge-community" data-slot="badge"><span class="dot" aria-hidden="true"></span><span data-slot="badge-text"></span></span><span class="dim" data-slot="date"></span><a data-slot="link">Status</a>
<ul class="plain dv-find"></ul></li></template>
<section aria-labelledby="d-c" class="gap" id="certs-s"><h2 id="d-c">Certificates</h2><div id="certs"></div></section>
<section aria-labelledby="d-a" class="gap" id="agreements"><h2 id="d-a">Agreements</h2>
<p class="dim" id="d-aintro">The texts this account accepted, as the hub recorded them: the version, the day, who accepted it, and the SHA-256 of the exact text.</p>
<div id="d-agreements" class="dash-list"></div></section>
<template id="t-agreement"><article class="card agr"><h3 class="h-sm" data-slot="name"></h3>
<p class="cert-state" hidden data-state="ok"><strong>Current.</strong> Version <span data-slot="current"></span> is accepted.</p>
<p class="cert-state" hidden data-state="old"><strong>A newer version is out.</strong> Version <span data-slot="current"></span> is the current one. You accept it before your next release.</p>
<p class="cert-state" hidden data-state="none"><strong>Not accepted yet.</strong> Version <span data-slot="current"></span> is the current one.</p>
<p class="cert-state" hidden data-state="req-ok"><strong>Accepted with each certificate request.</strong> Version <span data-slot="current"></span> is the current one and was accepted.</p>
<p class="cert-state" hidden data-state="req-none"><strong>Accepted with each certificate request.</strong> Version <span data-slot="current"></span> is the current one. No request has been made yet.</p>
<ul class="plain agr-rows" data-slot="rows"></ul>
<p><a data-slot="link">Read the text</a></p></article></template>
<template id="t-agreed"><li><span data-slot="version"></span> <span class="dim" data-slot="date"></span> <span class="dim" data-slot="by"></span> <code class="hash" data-slot="hash"></code></li></template>
<p hidden data-msg="a-version">Version</p><p hidden data-msg="a-by">accepted by</p>
<section aria-labelledby="d-r" class="gap"><h2 id="d-r">Reports</h2><ul id="d-reports" class="card dash-rows"></ul><p class="dim" id="d-noreports">Nobody has reported anything about these listings.</p></section>
<template id="t-report"><li><span data-slot="listing"></span><span class="dim" data-slot="reason"></span><span class="dim" data-slot="date"></span><span class="badge" data-slot="state"></span></li></template>
<section aria-labelledby="d-m" class="gap"><h2 id="d-m">Members and roles</h2><p class="dim" id="d-orgintro">From GitHub: who belongs to this organisation and what they may do there. Change it on GitHub.</p>
<p class="dim" id="d-solo" hidden>This is your own account. These are your organisations on GitHub and your role in each.</p><ul id="d-members" class="card dash-rows"></ul></section>
<template id="t-member"><li><span data-slot="login"></span><span class="dim" data-slot="role"></span></li></template>
<p hidden data-msg="role-owner">Owner: publishes, links repositories and asks for certificates</p><p hidden data-msg="role-member">Member</p>
<p hidden data-msg="r-open">Open</p><p hidden data-msg="r-closed">Closed</p>
<p hidden data-msg="listed">Listed</p><p hidden data-msg="connected">Connected</p><p hidden data-msg="show-all">Show all versions</p>
</div></div><p class="err" role="alert" data-err="page"></p></div>${CERT_TEMPLATE}</section>`,
});

/* ---------- Status of one version ---------- */
export const status = (assets) => page({
  title: "Where this version stands - WolOS Hub", path: "/status", assets, noindex: true, scripts: [assets.status],
  desc: "Where a version of an app, plugin or extension stands on WolOS Hub: received, checked, signed and published.",
  body: `<section class="wrap block narrow-wide" id="st" data-pending><nav class="crumbs" aria-label="You are here"><a href="/">Hub</a> / <a href="/dashboard">Dashboard</a></nav>
<h1 class="h-xl"><span data-slot="title"></span><span class="skel skel-title" aria-hidden="true"></span></h1>
<p class="dim" data-slot="sub"></p>
<div class="st">
<section class="card" aria-label="Where this version stands"><span class="skel skel-line" aria-hidden="true"></span><div id="st-track"></div></section>
<section class="card st-headline" id="st-head" hidden aria-live="polite"><div><h2 data-slot="title"></h2><p data-slot="sentence"></p><p class="dim" data-slot="fix"></p></div>
<p class="get-btns"><button type="button" class="btn btn-quiet" data-act="recheck" hidden>Check again</button><a class="btn btn-solid" data-slot="listing" hidden>Open the listing</a></p></section>
<p class="err" role="alert" data-err></p>
<section class="card" id="st-find" hidden aria-labelledby="st-find-h"><h2 class="h-md" id="st-find-h">What the check found</h2><div id="st-find-list"></div></section>
<section class="card" id="st-sig" hidden aria-labelledby="st-sig-h"><h2 class="h-md" id="st-sig-h">Signature</h2><p data-slot="statement"></p><p data-slot="author"></p><p><a data-slot="cert-link" href="/dashboard#certs">Sign your releases to show your name on them</a></p></section>
<section class="card" id="st-file" hidden aria-labelledby="st-file-h"><h2 class="h-md" id="st-file-h">The file</h2><p><span data-slot="fname"></span> <span class="dim" data-slot="fsize"></span> <a data-slot="furl" rel="noopener">On GitHub</a></p>
<div class="hash"><code data-slot="sha"></code><button type="button" class="copy" data-copy="" data-copy-slot="sha">Copy</button></div></section>
<section class="card" id="st-next" hidden aria-labelledby="st-next-h"><h2 class="h-md" id="st-next-h">Publish the fix</h2><p class="dim">A version that was checked is never replaced. Publish the fix as the next version.</p>
<div class="code"><pre><code id="st-cmd"></code></pre><button type="button" class="copy" id="st-copy" data-copy="">Copy</button></div></section>
</div>
<p hidden data-msg="on-github">on GitHub</p><p hidden data-msg="to-fix">To fix:</p><p hidden data-msg="no-hash">The hub has not read the file yet.</p>
<p hidden data-msg="nothing">There is no such version</p><p hidden data-msg="failed">This page could not be loaded</p>
<p hidden data-msg="stale">This page could not be refreshed. What you see is how it was a moment ago.</p>
</section>`,
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
