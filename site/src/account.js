/* WolOS Hub for people who publish and report: the agreements, linking a repository, the certificate cards, the
   dashboard of a developer or an organisation, the report form and sign-in trouble. Words come from the page
   (its <template> elements and hidden messages). */
(function () {
  "use strict";
  var H = window.Hub, $ = H.$, $$ = H.$$, el = H.el, call = H.call, slot = H.slot, msg = H.msg, show = H.show, fail = H.fail;
  var setMe = function (name, v) { $$('[data-me="' + name + '"]').forEach(function (n) { n.textContent = v; }); };
  var state = function (root, name) { $$("[data-state]", root).forEach(function (n) { if (n.parentNode === root || n.closest("[data-tier],[data-ask],.terms") === root) n.hidden = n.dataset.state !== name; }); };
  var texts = {};
  var text = function (doc) { return texts[doc] || (texts[doc] = call("GET", "/api/terms/" + doc)); };
  var cur = null, redraw = function () {};

  /* ---- One agreement ---- */
  function terms(box, m) {
    var doc = box.dataset.doc, st = doc === "cla" ? m.cla : (m.terms || {})[doc];
    if (box.hasAttribute("data-inline")) { text(doc).then(function (t) { box.terms = t; slot(box, "text", t.text); }, function (e) { fail(box.closest("form"), e, "cert"); }); return; }
    var ok = !!(st && st.ok);
    state(box, ok ? "ok" : "need");
    if (ok) { slot(box, "version", st.accepted); return; }
    var form = $("form", box);
    text(doc).then(function (t) { slot(box, "text", t.text); }, function (e) { fail(form, e); });
    form.onsubmit = function (e) {
      e.preventDefault();
      var btn = $("button[type=submit]", form); btn.disabled = true;
      text(doc).then(function (t) { return call("POST", "/api/terms/" + doc, { version: t.version, sha256: t.sha256 }); })
        .then(function () { return H.me(true); }).then(function (n) { btn.disabled = false; redraw(n); }, function (x) { fail(form, x); btn.disabled = false; });
    };
  }

  /* ---- Certificates: origin and trusted, for a person or an organisation ---- */
  function certs(box, m, acct, stale) {
    var c = H.tpl("t-certs"); if (!box || !c) return Promise.resolve();
    /* Built apart and put in place when the states are known, so switching accounts replaces the card in one step. */
    var cmd = window.HubCert.command(acct, m);
    slot(c, "cmd", cmd); $("[data-copy-slot=cmd]", c).dataset.copy = cmd;
    $$(".terms", c).forEach(function (t) { terms(t, m); });
    return Promise.all([call("GET", "/api/cert/requests").catch(function () { return { requests: [] }; }),
      call("GET", "/api/certs/" + encodeURIComponent(acct.login)).catch(function () { return { certs: [] }; })]).then(function (r) {
      var reqs = (r[0].requests || []).filter(function (q) { return q.subject && String(q.subject.login).toLowerCase() === acct.login.toLowerCase(); });
      var got = {};
      ["origin", "trusted"].forEach(function (tier) {
        var card = $('[data-tier="' + tier + '"]', c);
        var mine = function (x) { return (x.tier || "origin") === tier; };
        var cert = (r[1].certs || []).filter(mine)[0], req = reqs.filter(mine)[0];
        var s = !acct.org && m.certs && m.certs[tier];
        if (!s) s = req && /^(pending|approved)$/.test(req.status) ? "pending" : cert ? (cert.revoked_at ? "revoked" : "issued") : "none";
        if (s === "none" && req && req.status === "refused") { s = "refused"; slot(card, "reason", req.reason || ""); }
        var when = cert && (s === "revoked" ? cert.revoked_at : s === "issued" ? cert.issued_at : 0);
        got[tier] = s;
        state(card, s);
        if (when) slot($('[data-state="' + s + '"]', card), "date", H.day(when));
        if (cert && s !== "pending") { slot(card, "serial", cert.serial); $("[data-slot-row=serial]", card).hidden = false; }
      });
      if (stale && stale()) return;
      box.textContent = ""; box.appendChild(c);
      var ask = $("[data-ask]", c), form = $("form", ask);
      var canTrusted = got.origin === "issued" && !/issued|pending/.test(got.trusted);
      var canOrigin = !/issued|pending/.test(got.origin);
      ask.hidden = !canOrigin && !canTrusted;
      $('input[value="origin"]', form).disabled = !canOrigin;
      $('input[value="trusted"]', form).disabled = !canTrusted;
      $('input[value="' + (canOrigin ? "origin" : "trusted") + '"]', form).checked = true;
      form.onsubmit = function (e) {
        e.preventDefault();
        var f = new FormData(form), req, t = $(".terms", form).terms;
        try { req = JSON.parse(String(f.get("request") || "")); } catch (x) { req = null; }
        if (!req || typeof req !== "object") return fail(form, new Error(msg("bad-request")), "cert");
        if (!t || !f.get("trust_ok")) return $('input[name="trust_ok"]', form).focus();
        req.tier = f.get("tier"); req.trust_terms = { version: t.version, sha256: t.sha256 };
        var btn = $("button[type=submit]", form); btn.disabled = true;
        call("POST", "/api/cert/request", req).then(function () { return H.me(true); }).then(function (n) { return certs(box, n, acct); }).then(null,
          function (x) { fail(form, x, "cert"); btn.disabled = false; });
      };
    });
  }

  /* ---- Publish ---- */
  function publish(m) {
    show(document, "out", !m); show(document, "in", !!m);
    if (!m) return;
    setMe("login", m.login);
    $$("#s-terms .terms").forEach(function (b) { terms(b, m); });
    var ok = m.cla && m.cla.ok && m.terms && m.terms.publisher && m.terms.publisher.ok;
    show(document, "link", ok);
    var owned = (m.orgs || []).filter(function (o) { return o.role === "owner"; });
    var list = $("#org-list"), owner = $("#f-owner");
    list.textContent = ""; owner.textContent = "";
    owner.appendChild(el("option", { value: "person", text: m.login + " " + msg("you") }));
    (m.orgs || []).forEach(function (o) { if (o.linked && o.cla && o.cla.ok) owner.appendChild(el("option", { value: o.login, text: o.login + " " + msg("org") })); });
    show(document, "orgs", ok && owned.length > 0);
    owned.forEach(function (o) {
      var li = H.tpl("t-org"), linked = o.linked && o.cla && o.cla.ok, b = $("button", li);
      slot(li, "text", o.login + " " + msg(linked ? "org-linked" : "org-yours"));
      if (linked) b.remove();
      else {
        b.textContent += " " + o.login;
        b.onclick = function () {
          b.disabled = true;
          text("cla").then(function (c) { return call("POST", "/api/orgs", { org: o.login, version: c.version, sha256: c.sha256 }); })
            .then(function () { return H.me(true); }).then(redraw, function (e) { fail($("#s-link"), e, "org"); b.disabled = false; });
        };
      }
      list.appendChild(li);
    });
    certs($("#certs"), m, { id: m.github_id, login: m.login });
  }
  var lf = $("#listing-form");
  if (lf) {
    redraw = publish;
    var kind = $("#f-kind");
    kind.addEventListener("change", function () { $("#host-field").hidden = kind.value !== "extension"; $("#f-host").required = kind.value === "extension"; });
    lf.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = new FormData(lf), body = {};
      ["owner", "kind", "id", "name", "summary", "license", "repo", "asset"].forEach(function (k) { body[k] = String(f.get(k) || "").trim(); });
      if (body.kind === "extension") body.host = String(f.get("host") || "").trim();
      var btn = $("button[type=submit]", lf); btn.disabled = true; $("[data-err]", lf).textContent = "";
      call("POST", "/api/listings", body).then(function (l) {
        lf.hidden = true; show(document, "linked", true); setMe("linked", l.name + " " + msg("linked-to") + " " + l.source.repo + ".");
      }, function (x) { fail(lf, x); btn.disabled = false; });
    });
  }

  /* ---- Dashboard ---- */
  var STATUS = function (r) {
    if (r.withdrawn || r.yanked) return ["withdrawn", "withdrawn"];
    if (r.verdict === "pending" || !r.verdict) return ["checking", "checking"];
    if (r.verdict === "flag" || r.flag) return ["flagged", "flag"];
    if (r.verdict === "block") return ["flagged", "block"];
    return ["listed", ""];
  };
  /* The dashboard is one page. Choosing another account (a person or an organisation) changes only the regions under
     the account switch: the address changes without a load, the header is not touched, and what is on screen stays
     until the new answer is ready. */
  var seq = 0;
  /* The agreements this account accepted (the Worker's record); the list is replaced in one step when the answer is in. */
  function agreements(acct, stale) {
    call("GET", "/api/my/agreements" + (acct.org ? "?as=" + encodeURIComponent(acct.login) : "")).then(function (j) {
      if (stale()) return;
      var nodes = (j.agreements || []).map(function (a) {
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
        return c;
      });
      var box = $("#d-agreements"); box.textContent = "";
      nodes.forEach(function (n) { box.appendChild(n); });
    }, function () { $("#d-agreements").textContent = ""; });
  }
  function dashboard(m) {
    show(document, "out", !m); show(document, "in", !!m);
    if (!m) return;
    var accts = [{ id: m.github_id, login: m.login, role: "owner" }].concat((m.orgs || []).map(function (o) { return { id: o.github_org_id, login: o.login, org: true, role: o.role }; }));
    var pick = function () {
      var want = new URLSearchParams(location.search).get("as");
      return accts.filter(function (a) { return a.login === want; })[0] || accts[0];
    };
    var href = function (a) { return "/dashboard" + (a.org ? "?as=" + encodeURIComponent(a.login) : ""); };
    var nav = $("#d-accounts"); nav.textContent = "";
    var links = accts.map(function (a) {
      var l = H.tpl("t-account"); l.textContent = a.login; l.href = href(a);
      l.addEventListener("click", function (e) {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (pick() !== a) history.pushState(null, "", href(a));
        choose(a);
      });
      nav.appendChild(l);
      return l;
    });
    var same = function (a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); };
    /* My listings and reports come once for all accounts; each account filters them. */
    var fromIndex = function () {
      return fetch("/search.json").then(function (r) { return r.json(); }).then(function (rows) {
        return Promise.all(rows.filter(function (x) { return accts.some(function (a) { return same(x.o, a.login); }); }).map(function (x) { return call("GET", "/api/listings/" + encodeURIComponent(x.id)).then(function (l) { return l.owner ? l : null; }, function () { return null; }); }));
      }).then(function (ls) { return { listings: ls.filter(Boolean), reports: [] }; }, function () { return { listings: [], reports: [] }; });
    };
    var mineP = call("GET", "/api/my/listings").catch(fromIndex);
    function choose(acct) {
      var mark = ++seq, stale = function () { return mark !== seq; };
      links.forEach(function (l, i) { if (accts[i] === acct) l.setAttribute("aria-current", "page"); else l.removeAttribute("aria-current"); });
      mineP.then(function (j) {
        if (stale()) return;
        var mine = (j.listings || []).filter(function (l) { return l.owner && same(l.owner.login, acct.login); });
        var box = $("#d-listings"), nodes = [];
        mine.forEach(function (l) {
          var a = H.tpl("t-listing"), link = slot(a, "link", l.name);
          link.href = "/" + l.kind + "s/" + l.id; slot(a, "kind", l.kind); slot(a, "repo", l.source && l.source.repo);
          (l.releases || []).forEach(function (r) {
            var v = H.tpl("t-version"), s = STATUS(r);
            slot(v, "version", r.version); slot(v, "date", r.first_seen ? H.day(r.first_seen) : "");
            $$("[data-status]", v).forEach(function (n) { if (n.dataset.status !== s[0]) n.remove(); });
            $$("[data-why]", v).forEach(function (n) { if (n.dataset.why !== s[1]) n.remove(); });
            var fl = $(".dv-find", v);
            (r.findings || []).concat(r.flag && r.flag.reason ? [{ sentence: r.flag.reason }] : []).forEach(function (x) { fl.appendChild(el("li", { text: x.sentence })); });
            if (!fl.children.length) fl.remove();
            $(".dl-vers", a).appendChild(v);
          });
          nodes.push(a);
        });
        box.textContent = ""; nodes.forEach(function (n) { box.appendChild(n); });
        $("#d-none").hidden = mine.length > 0;
        var ids = mine.map(function (l) { return l.id; }), rl = $("#d-reports"); rl.textContent = "";
        (j.reports || []).filter(function (r) { return ids.indexOf(r.listing_id) >= 0; }).forEach(function (r) {
          var li = H.tpl("t-report"); slot(li, "listing", r.listing_id + (r.version ? " " + r.version : "")); slot(li, "reason", r.reason);
          slot(li, "date", H.day(r.created_at)); slot(li, "state", msg(r.state === "open" ? "r-open" : "r-closed")); rl.appendChild(li);
        });
        rl.hidden = !rl.children.length; $("#d-noreports").hidden = !rl.hidden;
      });
      certs($("#certs"), m, acct, stale);
      agreements(acct, stale);
      var rows = [], row = function (login, role) { rows.push([login, msg(role === "owner" ? "role-owner" : "role-member")]); };
      var put = function () {
        if (stale()) return;
        var ml = $("#d-members"); ml.textContent = "";
        rows.forEach(function (r) { var li = H.tpl("t-member"); slot(li, "login", r[0]); slot(li, "role", r[1]); ml.appendChild(li); });
        $("#d-solo").hidden = !!acct.org; $("#d-orgintro").hidden = !acct.org;
        ml.hidden = !acct.org && !ml.children.length;
      };
      if (!acct.org) { accts.slice(1).forEach(function (a) { row(a.login, a.role); }); put(); return; }
      call("GET", "/api/orgs/" + encodeURIComponent(acct.login) + "/members").then(function (j) {
        (j.members || []).forEach(function (x) { row(x.login, x.role); });
      }, function () { row(m.login, acct.role); }).then(put);
    }
    choose(pick());
    if (!dashboard.popped) { dashboard.popped = true; window.addEventListener("popstate", function () { if (dashboard.go) dashboard.go(); }); }
    dashboard.go = function () { choose(pick()); };
  }
  if ($("#d-listings")) redraw = dashboard;
  if (lf || $("#d-listings")) H.me().then(function (m) { redraw(m); }, function () { redraw(null); });
  /* ---- Report ---- */
  var rf = $("#report-form");
  if (rf) {
    var p = new URLSearchParams(location.search);
    $("#r-listing").value = p.get("listing") || ""; $("#r-version").value = p.get("version") || "";
    var si = $("#report-signin"); if (si) si.href = "/auth/login?next=" + encodeURIComponent(location.pathname + location.search);
    var text = $("#r-text"), left = $("#r-left");
    text.addEventListener("input", function () { left.textContent = String(2000 - text.value.length); });
    H.me().then(function (m) { show(document, "out", !m); show(document, "in", !!m); }, function () { show(document, "out", true); });
    rf.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = new FormData(rf), err = $("[data-err]", rf);
      var body = { listing_id: String(f.get("listing_id") || "").trim(), reason: f.get("reason"), text: String(f.get("text") || "").trim() };
      var v = String(f.get("version") || "").trim(); if (v) body.version = v;
      if (!body.listing_id) { err.textContent = msg("listing"); $("#r-listing").focus(); return; }
      if (!body.reason) { err.textContent = msg("reason"); $("input[name=reason]", rf).focus(); return; }
      if (!body.text) { err.textContent = msg("text"); text.focus(); return; }
      err.textContent = "";
      var btn = $("button[type=submit]", rf); btn.disabled = true;
      call("POST", "/api/reports", body).then(function (j) {
        rf.hidden = true; $("#report-done").hidden = false; $("[data-me=report]").textContent = String(j.report.id); $("#report-done").setAttribute("tabindex", "-1"); $("#report-done").focus();
      }, function (x) { err.textContent = x.message; btn.disabled = false; });
    });
  }

  /* ---- Sign-in trouble ---- */
  var sm = $("#signin-msg");
  if (sm) {
    var code = new URLSearchParams(location.search).get("error");
    if (code) { var why = $('[data-why="' + code + '"]') || $('[data-why="other"]'); sm.textContent = why.textContent; }
  }
})();
