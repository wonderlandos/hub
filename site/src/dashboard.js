/* WolOS Hub, the dashboard of a developer or an organisation: one answer from the Worker per account, drawn at once from the
   last one this tab saw. Switching account (a person, an organisation) loads nothing but that account's answer: the address
   changes, the header is not touched and what is on screen stays until the new answer is ready. Words come from the page. */
(function () {
  "use strict";
  var H = window.Hub, $ = H.$, $$ = H.$$, el = H.el, call = H.call, slot = H.slot, msg = H.msg, show = H.show, fail = H.fail;
  var root = $("[data-overview=dashboard]");
  if (!root) return;
  var state = function (r, name) { $$("[data-state]", r).forEach(function (n) { if (n.parentNode === r || n.closest("[data-tier],[data-ask],.terms") === r) n.hidden = n.dataset.state !== name; }); };
  var same = function (a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); };
  var seq = 0, accts = [], links = [], me = null, cache = {};

  /* ---- Certificates: origin and trusted, for a person or an organisation (from the overview) ---- */
  function certs(box, acct, o, stale) {
    var c = H.tpl("t-certs"); if (!box || !c) return;
    var cmd = window.HubCert.command(acct, me);
    slot(c, "cmd", cmd); $("[data-copy-slot=cmd]", c).dataset.copy = cmd;
    var t = $(".terms", c); H.agreement($(".agreement-text", t), "trust").then(function (x) { t.terms = x; }, function (e) { fail(t.closest("form"), e, "cert"); });
    var got = {};
    ["origin", "trusted"].forEach(function (tier) {
      var card = $('[data-tier="' + tier + '"]', c), s = o.certs.states[tier];
      var cert = o.certs.list.filter(function (x) { return x.tier === tier; })[0];
      if (s === "none" && o.certs.refused[tier] !== undefined) { s = "refused"; slot(card, "reason", o.certs.refused[tier]); }
      got[tier] = s; state(card, s);
      var when = cert && (s === "revoked" ? cert.revoked_at : s === "issued" ? cert.issued_at : 0);
      if (when) slot($('[data-state="' + s + '"]', card), "date", H.day(when));
      if (cert && s !== "pending") { slot(card, "serial", cert.serial); $("[data-slot-row=serial]", card).hidden = false; }
    });
    if (stale && stale()) return;
    box.textContent = ""; box.appendChild(c);
    var ask = $("[data-ask]", c), form = $("form", ask);
    var canTrusted = got.origin === "issued" && !/issued|pending/.test(got.trusted), canOrigin = !/issued|pending/.test(got.origin);
    ask.hidden = !canOrigin && !canTrusted;
    $('input[value="origin"]', form).disabled = !canOrigin; $('input[value="trusted"]', form).disabled = !canTrusted;
    $('input[value="' + (canOrigin ? "origin" : "trusted") + '"]', form).checked = true;
    form.onsubmit = function (e) {
      e.preventDefault();
      var f = new FormData(form), req, tt = $(".terms", form).terms;
      try { req = JSON.parse(String(f.get("request") || "")); } catch (x) { req = null; }
      if (!req || typeof req !== "object") return fail(form, new Error(msg("bad-request")), "cert");
      if (!tt || !f.get("trust_ok")) return $('input[name="trust_ok"]', form).focus();
      req.tier = f.get("tier"); req.trust_terms = { version: tt.version, sha256: tt.sha256 };
      var btn = $("button[type=submit]", form); btn.disabled = true;
      call("POST", "/api/cert/request", req).then(function () { return load(acct, true); }).then(null, function (x) { fail(form, x, "cert"); btn.disabled = false; });
    };
  }

  /* ---- Agreements ---- */
  function agreements(o) {
    var box = $("#d-agreements");
    var nodes = (o.agreements || []).map(function (a) {
      var c = H.tpl("t-agreement");
      slot(c, "name", a.name);
      state(c, a.per_request ? (a.ok ? "req-ok" : "req-none") : a.ok ? "ok" : a.accepted.length ? "old" : "none");
      $$("[data-slot=current]", c).forEach(function (n) { n.textContent = a.current; });
      var rows = $('[data-slot="rows"]', c);
      a.accepted.forEach(function (x) {
        var li = H.tpl("t-agreed");
        slot(li, "version", msg("a-version") + " " + x.version); slot(li, "date", H.day(x.accepted_at));
        slot(li, "by", x.by ? msg("a-by") + " " + x.by : ""); slot(li, "hash", x.sha256);
        rows.appendChild(li);
      });
      rows.hidden = !a.accepted.length;
      slot(c, "link").href = a.url;
      var read = $(".agr-read", c);
      read.addEventListener("toggle", function () { if (read.open && !read.dataset.got) { read.dataset.got = "1"; H.agreement($(".agreement-text", read), a.doc).then(null, function () { delete read.dataset.got; }); } });
      return c;
    });
    box.textContent = ""; nodes.forEach(function (n) { box.appendChild(n); });
  }

  /* ---- Listings ---- */
  var TONE = { published: "trusted", working: "origin", held: "community", failed: "withdrawn", removed: "community" };
  var status = function (l, v) { return "/status?l=" + encodeURIComponent(l) + "&v=" + encodeURIComponent(v); };
  function badge(n, outcome, text) {
    var b = $("[data-slot=badge]", n); b.className = "badge badge-" + (TONE[outcome] || "community"); slot(b, "badge-text", text);
  }
  function listing(l) {
    var a = H.tpl("t-listing"), link = slot(a, "link", l.name);
    var live = l.versions.some(function (v) { return v.outcome === "published"; });
    link.href = live ? "/" + l.kind + "s/" + l.id + "/" : status(l.id, l.versions[0] ? l.versions[0].version : "");
    if (!live && !l.versions[0]) link.removeAttribute("href");
    slot(a, "tile", l.name.charAt(0).toUpperCase()); slot(a, "kind", l.kind + " ·"); slot(a, "repo", l.repo + " ·"); slot(a, "id", l.id);
    badge(a, live ? "published" : "held", live ? msg("listed") : msg("connected"));
    var vs = $(".dl-vers", a), more = $(".dl-more", a);
    if (l.versions[0]) {
      var lt = l.versions[0], box = $("[data-slot=latest]", a); box.hidden = false;
      slot(box, "lv", lt.version); $("[data-slot=track]", box).appendChild(H.track(lt.stages, true)); slot(box, "lhead", lt.headline.title);
    }
    l.versions.forEach(function (r, i) {
      var v = H.tpl("t-version");
      slot(v, "version", r.version); slot(v, "date", r.first_seen ? H.day(r.first_seen) : "");
      badge(v, r.outcome, r.headline.title);
      slot(v, "link").href = status(l.id, r.version);
      var fl = $(".dv-find", v);
      (r.findings || []).forEach(function (x) { fl.appendChild(el("li", { text: x.sentence })); });
      if (!fl.children.length) fl.remove();
      if (i >= 3) v.hidden = true;
      vs.appendChild(v);
    });
    if (l.versions.length > 3) {
      more.hidden = false; more.textContent = msg("show-all") + " (" + l.versions.length + ")";
      more.onclick = function () { $$(".dv", a).forEach(function (n) { n.hidden = false; }); more.hidden = true; };
    }
    return a;
  }

  /* ---- One account ---- */
  function render(acct, o, stale) {
    root.removeAttribute("data-pending");
    var box = $("#d-listings"), nodes = o.listings.map(listing);
    box.textContent = ""; nodes.forEach(function (n) { box.appendChild(n); });
    $("#d-none").hidden = nodes.length > 0;
    var at = $("#d-att"); at.textContent = "";
    o.attention.forEach(function (a) {
      var li = H.tpl("t-att"); li.dataset.level = a.level; slot(li, "text", a.text); slot(li, "link").href = a.href; at.appendChild(li);
    });
    $("#d-att-s").hidden = !o.attention.length;
    var rl = $("#d-reports"); rl.textContent = "";
    (o.reports || []).forEach(function (r) {
      var li = H.tpl("t-report"); slot(li, "listing", r.listing_id + (r.version ? " " + r.version : "")); slot(li, "reason", r.reason);
      slot(li, "date", H.day(r.created_at)); slot(li, "state", msg(r.state === "open" ? "r-open" : "r-closed")); rl.appendChild(li);
    });
    rl.hidden = !rl.children.length; $("#d-noreports").hidden = !rl.hidden;
    var ml = $("#d-members"); ml.textContent = "";
    (o.members || []).forEach(function (x) { var li = H.tpl("t-member"); slot(li, "login", x.login); slot(li, "role", msg(x.role === "owner" ? "role-owner" : "role-member")); ml.appendChild(li); });
    $("#d-solo").hidden = !!acct.org; $("#d-orgintro").hidden = !acct.org; ml.hidden = !ml.children.length;
    agreements(o);
    certs($("#certs"), acct, o, function () { return false; });
    sessions(o.sessions || []);
    adminDoor(o.me);
  }
  /* The way to the admin panel, only when the overview says this person has a panel role. */
  function adminDoor(m) {
    var d = $("#d-admin"); if (!d) return;
    d.hidden = !(m && m.admin && m.admin_role);
    if (!d.hidden) slot(d, "role", m.admin_role);
    $$("[data-admin-tab]", d).forEach(function (a) { if (d.hidden) a.removeAttribute("href"); else a.href = H.adminHref(a.dataset.adminTab); });
  }
  /* ---- Where you are signed in: each session of the person, from the overview; End signs that browser out at once ---- */
  function sessions(list) {
    var ul = $("#d-sessions"), err = $("#d-sess-err"); if (!ul) return;
    ul.textContent = ""; err.textContent = "";
    list.forEach(function (s) {
      var li = H.tpl("t-session");
      slot(li, "browser", s.browser + (s.current ? " (" + msg("s-this") + ")" : ""));
      slot(li, "place", s.place + (s.colo ? ", " + s.colo : ""));
      slot(li, "when", msg("s-seen") + " " + H.time(s.last_seen) + (s.admin ? ". " + msg("s-admin") : ""));
      slot(li, "flag", s.moved ? msg("s-moved") : "");
      if (s.moved) li.dataset.level = "warn";
      var b = slot(li, "end");
      if (s.current) b.remove();
      else b.onclick = function () {
        b.disabled = true;
        H.call("POST", "/api/me/sessions/" + encodeURIComponent(s.ref) + "/revoke").then(function () { li.textContent = s.browser + ": " + msg("s-ended"); }, function (e) { b.disabled = false; err.textContent = e.message; });
      };
      ul.appendChild(li);
    });
    var all = $("#d-signout-all");
    all.onclick = function () {
      all.disabled = true;
      H.call("POST", "/api/me/sessions/revoke-all").then(function () { H.forget(); location.href = "/"; }, function (e) { all.disabled = false; err.textContent = e.message; });
    };
  }
  function load(acct, fresh) {
    var mark = ++seq, stale = function () { return mark !== seq; };
    links.forEach(function (l, i) { if (accts[i] === acct) l.setAttribute("aria-current", "page"); else l.removeAttribute("aria-current"); });
    var k = acct.org ? acct.login : "";
    var s = !fresh && H.snap(k);
    if (s) render(acct, s, true);
    return H.overview(k, fresh).then(function (o) {
      cache[k] = o; me = o.me;
      if (!stale()) render(acct, o);
    }, function (e) { if (!stale()) { root.removeAttribute("data-pending"); fail($("[data-when~=in]"), e, "page"); } });
  }
  function dashboard(m) {
    show(document, "out", !m); show(document, "in", !!m);
    if (!m) { root.removeAttribute("data-pending"); return; }
    me = m;
    accts = [{ id: m.github_id, login: m.login, role: "owner" }].concat((m.orgs || []).map(function (o) { return { id: o.github_org_id, login: o.login, org: true, role: o.role }; }));
    var pick = function () { var want = H.asOf(); return accts.filter(function (a) { return a.login === want; })[0] || accts[0]; };
    var href = function (a) { return "/dashboard" + (a.org ? "?as=" + encodeURIComponent(a.login) : ""); };
    var nav = $("#d-accounts"); nav.textContent = "";
    links = accts.map(function (a) {
      var l = H.tpl("t-account"); l.textContent = a.login; l.href = href(a);
      l.addEventListener("click", function (e) {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (pick() !== a) history.pushState(null, "", href(a));
        load(a);
      });
      nav.appendChild(l);
      return l;
    });
    load(pick());
    if (!popped) { popped = true; window.addEventListener("popstate", function () { if (accts.length) load(pick()); }); }
    /* While the person looks at one account, the others are fetched quietly, so switching shows its data at once. */
    setTimeout(function () { accts.forEach(function (a) { if (a.org && a !== pick()) H.overview(a.login, false, true).then(null, function () {}); }); }, 1500);
  }
  var popped = false;
  var signedOut = function () { me = null; accts = []; show(document, "in", false); show(document, "out", true); root.removeAttribute("data-pending"); };
  H.me().then(dashboard, signedOut);
  /* Signed in or out in another tab: the page follows without a reload (the header already did, hub.js). */
  document.addEventListener("hub:who", function () { cache = {}; seq++; H.me(true).then(dashboard, signedOut); });
})();
