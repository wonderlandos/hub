/* WolOS Hub in the browser, on every page: sign-in state, the look switch, Copy, "/" for search, the picture
   "Verify offline" and the admin loader. Plain script, no dependencies. The Worker answers on the same origin
   (/api/*, /auth/*); its errors carry a `sentence` that is shown as it is. Page scripts (search.js,
   pictures.js, account.js, and admin.js only for people with a role) use window.Hub. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var el = function (tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) { if (k === "text") n.textContent = attrs[k]; else n.setAttribute(k, attrs[k]); }
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  };
  var GENERIC = "Something went wrong. Try again.";
  var OFFLINE = "The hub can't be reached. Check your connection and try again.";

  /* ---- The Worker (none behind a static build: then nothing is asked and everyone is signed out) ---- */
  var NOAPI = !!document.querySelector('meta[name="hub-api"][content="off"]');
  function call(method, path, body, cache, quiet) {
    if (NOAPI) return Promise.reject(Object.assign(new Error(OFFLINE), { status: /^\/api\/(me|my\/overview)/.test(path) ? 401 : 0 }));
    var opt = { method: method, credentials: "include", headers: { accept: "application/json" } };
    if (cache) opt.cache = cache;
    if (quiet) opt.headers["x-hub-prefetch"] = "1"; /* the dashboard's quiet fetch of the other accounts: not a switch for the Worker */
    if (body !== undefined) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.sentence || GENERIC); e.status = r.status; e.code = j.error; throw e; }
        return j;
      });
    }, function () { throw new Error(OFFLINE); });
  }
  /* One answer per page: the pages of people who publish ask /api/my/overview (the person and everything the page shows,
     one round trip) and take the signed-in person from it; the other pages ask /api/me. The last overview of each account is
     kept for this tab (sessionStorage), so the next page draws from it at once and replaces it when the answer arrives. */
  var OV = !!document.querySelector("[data-overview]");
  var ovs = {}, SNAP = "hub-snap:";
  var asOf = function () { return new URLSearchParams(location.search).get("as") || ""; };
  /* A snapshot belongs to one person: it is stored under the login this browser last signed in as, and never used for another
     (not when the kept sign-in changed, not when the snapshot's own person differs). */
  var snapKey = function (k) { var w = kept(); return w ? SNAP + w.login.toLowerCase() + "|" + k : null; };
  var snap = function (k) {
    try {
      var key = snapKey(k), v = key && JSON.parse(sessionStorage.getItem(key) || "null"), w = kept();
      return v && (!v.me || (w && v.me.login.toLowerCase() === w.login.toLowerCase())) ? v : null;
    } catch (x) { return null; }
  };
  var save = function (k, v) {
    try {
      var login = v && v.me ? v.me.login : (kept() || {}).login;
      if (login) sessionStorage.setItem(SNAP + login.toLowerCase() + "|" + k, JSON.stringify(v));
    } catch (x) {}
  };
  /* Forget this tab's snapshots (all, or all but one person's). */
  var forget = function (except) {
    if (!except) ovs = {};
    try { Object.keys(sessionStorage).forEach(function (k) { if (k.indexOf(SNAP) === 0 && !(except && k.indexOf(SNAP + except.toLowerCase() + "|") === 0)) sessionStorage.removeItem(k); }); } catch (x) {}
  };
  /* Never the browser's copy unasked: "no-cache" revalidates (ETag, 304); fresh skips it. Shared for ASK_AGAIN ms. */
  var ASK_AGAIN = 5000;
  function overview(as, fresh, quiet) {
    var k = as || "", o = ovs[k];
    if (!o || fresh || (o.at && Date.now() - o.at > ASK_AGAIN)) {
      var e = ovs[k] = { at: 0 };
      e.p = call("GET", "/api/my/overview" + (k ? "?as=" + encodeURIComponent(k) : ""), undefined, fresh ? "reload" : "no-cache", quiet).then(function (o) {
        e.at = Date.now();
        save(k, o);
        return o;
      }, function (x) { if (ovs[k] === e) delete ovs[k]; throw x; });
    }
    return ovs[k].p;
  }
  var meP = null;
  function me(fresh) {
    if (!meP || fresh) {
      var p = OV ? overview(asOf(), fresh).then(function (o) { return o.me; }) : call("GET", "/api/me");
      meP = p.catch(function (e) { if (e.status === 401) return null; throw e; });
    }
    return meP;
  }
  /* A <template> by id, cloned; slot(n, name) finds [data-slot=name] in it. */
  var tpl = function (id) { var t = document.getElementById(id); return t ? t.content.firstElementChild.cloneNode(true) : null; };
  var slot = function (n, name, text) { var s = $('[data-slot="' + name + '"]', n); if (s && text !== undefined) s.textContent = text; return s; };
  var msg = function (name) { var m = $('[data-msg="' + name + '"]'); return m ? m.textContent : ""; };
  var show = function (root, name, on) { $$('[data-when~="' + name + '"]', root).forEach(function (n) { n.hidden = !on; }); };
  var fail = function (form, e, which) {
    var box = $("[data-err" + (which ? '="' + which + '"' : "") + "]", form || document) || $("[data-err]");
    if (box) box.textContent = e.message || GENERIC;
  };
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var day = function (s) { var d = new Date(s * 1000); return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear(); };
  var time = function (s) { var d = new Date(s * 1000); return day(s) + ", " + ("0" + d.getUTCHours()).slice(-2) + ":" + ("0" + d.getUTCMinutes()).slice(-2); };
  /* The four stages of a version as a track: received, checked, signed, published (each done, current, waiting, failed or skipped). */
  var STAGE_NAMES = { received: "Received", checked: "Checked", signed: "Signed", published: "Published" };
  function track(stages, small) {
    var ol = el("ol", { class: "track" + (small ? " track-sm" : ""), "aria-label": "Where this version stands" });
    stages.forEach(function (s) {
      var li = el("li", { class: "tr", "data-state": s.state }, [el("span", { class: "tr-dot", "aria-hidden": "true" }), el("span", { class: "tr-name", text: STAGE_NAMES[s.key] })]);
      if (s.at && !small) li.appendChild(el("time", { class: "tr-at dim", text: time(s.at) }));
      ol.appendChild(li);
    });
    return ol;
  }
  /* ---- src/kit.js, loaded once when a page first needs it (data-kit) ---- */
  var terms = {};
  var termsText = function (d) { return terms[d] || (terms[d] = call("GET", "/api/terms/" + d).then(null, function (e) { delete terms[d]; throw e; })); };
  var kitP = null;
  function kit() {
    if (!kitP) kitP = new Promise(function (ok, no) {
      var at = $("[data-kit]"), s = at && el("script", { src: at.dataset.kit });
      if (!s) return no(new Error(GENERIC));
      s.onload = function () { ok(window.HubKit); }; s.onerror = function () { kitP = null; no(new Error(OFFLINE)); };
      document.head.appendChild(s);
    });
    return kitP;
  }
  var agreement = function (box, doc) { box.dataset.doc = doc; return kit().then(function (k) { return k.agreement(box, doc, termsText); }); };
  /* Only this script names the admin address (check-links.mjs). */
  var adminHref = function (tab) { return "/admin" + (tab ? "#" + tab : ""); };
  window.Hub = { $: $, $$: $$, el: el, call: call, kit: kit, adminHref: adminHref, me: me, overview: overview, snap: snap, save: save, forget: forget, asOf: asOf, tpl: tpl, slot: slot, msg: msg, show: show, fail: fail, day: day, time: time, track: track, GENERIC: GENERIC,
    terms: termsText, agreement: agreement };

  /* ---- The closed admin page: nothing unless the Worker gives the queue ---- */
  var adm = $("main[data-admin]");
  if (adm) {
    call("GET", "/api/admin/queue").then(function (q) {
      window.Hub.queue = q;
      document.head.appendChild(el("script", { src: adm.dataset.admin }));
    }, function () {});
    return;
  }

  /* ---- Look: auto, light or dark; kept like the WolOS site keeps it ---- */
  var theme = $("#theme");
  if (theme) {
    var cur = document.documentElement.dataset.theme || "auto";
    var mark = function (t) { $$("button", theme).forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.theme === t)); }); };
    mark(cur);
    theme.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var t = b.dataset.theme;
      if (t === "auto") { delete document.documentElement.dataset.theme; try { localStorage.removeItem("theme"); } catch (x) {} }
      else { document.documentElement.dataset.theme = t; try { localStorage.setItem("theme", t); } catch (x) {} }
      mark(t);
    });
  }

  /* ---- Copy ---- */
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button.copy"); if (!b) return;
    var text = b.dataset.copy, label = b.textContent;
    var done = function (ok) { b.textContent = ok ? "Copied" : "Press Ctrl+C"; setTimeout(function () { b.textContent = label; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
    else done(false);
  });


  /* ---- "/" goes to the search field ---- */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = document.activeElement;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    var q = $("#q"); if (!q) return;
    e.preventDefault(); q.focus(); q.select();
  });

  /* ---- Verify offline: opening the panel downloads the statement ---- */
  var off = $("details#offline[data-statement]");
  if (off) off.addEventListener("toggle", function () {
    if (!off.open || off.dataset.got) return;
    off.dataset.got = "1";
    var a = el("a", { href: off.dataset.statement, download: off.dataset.name, hidden: "" });
    document.body.appendChild(a); a.click(); a.remove();
  });

  /* ---- Signed in or not ----
     The last answer (login, name, picture; nothing secret) is kept in localStorage, so the next page draws the signed-in header
     at once and keeps it until the session answers. "Sign in" shows only when the Worker says 401 (then the copy is removed).
     A failed or slow request changes nothing. The header is built once; later answers only change its words. */
  var who = $("#who"), KEY = "hub-who", signedOutHtml = who ? who.innerHTML : "";
  var keep = function (m) { if (!m) forget(); else forget(m.login); try { localStorage.removeItem("hub-signing"); if (m) localStorage.setItem(KEY, JSON.stringify({ login: m.login, name: m.name || null, avatar: m.avatar || null, admin: !!m.admin })); else localStorage.removeItem(KEY); } catch (x) {} };
  var kept = function () { try { var v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && typeof v.login === "string" ? v : null; } catch (x) { return null; } };
  var htmlOf = document.documentElement;
  function renderWho(m) {
    var t = document.getElementById("t-who");
    if (!who || !t) return;
    if (!m) {
      delete htmlOf.dataset.who;
      if (who.dataset.in) { who.textContent = ""; who.innerHTML = signedOutHtml; delete who.dataset.in; }
      who.dataset.ready = "";
      return;
    }
    htmlOf.dataset.who = "in";
    if (!who.dataset.in) {
      who.textContent = "";
      who.appendChild(t.content.cloneNode(true));
      who.dataset.in = "1";
      var out = $('[data-act="signout"]', who);
      out.addEventListener("click", function () {
        out.disabled = true;
        call("POST", "/auth/logout").then(function () { keep(null); forget(); location.reload(); }, function () { out.disabled = false; });
      });
    }
    var pic = $("img", who);
    if (m.avatar) { if (pic.getAttribute("src") !== m.avatar) pic.src = m.avatar; pic.hidden = false; } else pic.hidden = true;
    slot(who, "name", m.name || m.login);
    var adm = slot(who, "admin"); adm.hidden = !m.admin;
    if (m.admin) adm.href = adminHref(""); else adm.removeAttribute("href");
    who.dataset.ready = "";
  }
  var first = kept();
  if (first) renderWho(first);
  /* Going to GitHub to sign in: the page we come back to waits for the answer instead of showing "Sign in" first. */
  document.addEventListener("click", function (e) { var a = e.target.closest && e.target.closest('a[href^="/auth/login"]'); if (a) try { localStorage.setItem("hub-signing", String(Date.now())); } catch (x) {} });
  /* Back from signing in: what this tab kept belongs to before. */
  try { if (localStorage.getItem("hub-signing")) forget(); } catch (x) {}
  /* Another tab signed in or out: the header and the page follow (hub:who). */
  window.addEventListener("storage", function (e) {
    if (e.key !== KEY) return;
    forget(); meP = null; renderWho(kept());
    document.dispatchEvent(new CustomEvent("hub:who", { detail: kept() }));
  });
  var needsMe = who || $("[data-when]");
  if (needsMe) me().then(function (m) { keep(m); renderWho(m); document.dispatchEvent(new CustomEvent("hub:me", { detail: m })); },
    function () { delete htmlOf.dataset.who; if (who) who.dataset.ready = ""; document.dispatchEvent(new CustomEvent("hub:me", { detail: first })); });

})();
