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
  function call(method, path, body) {
    if (NOAPI) return Promise.reject(Object.assign(new Error(OFFLINE), { status: path === "/api/me" ? 401 : 0 }));
    var opt = { method: method, credentials: "include", headers: { accept: "application/json" } };
    if (body !== undefined) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.sentence || GENERIC); e.status = r.status; e.code = j.error; throw e; }
        return j;
      });
    }, function () { throw new Error(OFFLINE); });
  }
  var meP = null;
  function me(fresh) {
    if (!meP || fresh) meP = call("GET", "/api/me").catch(function (e) { if (e.status === 401) return null; throw e; });
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
  window.Hub = { $: $, $$: $$, el: el, call: call, me: me, tpl: tpl, slot: slot, msg: msg, show: show, fail: fail, day: day, GENERIC: GENERIC };

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

  /* ---- Signed in or not ---- */
  var who = $("#who");
  function renderWho(m) {
    var t = document.getElementById("t-who");
    if (!who || !m || !t) return;
    who.textContent = "";
    who.appendChild(t.content.cloneNode(true));
    var pic = $("img", who);
    if (m.avatar) { pic.src = m.avatar; pic.hidden = false; }
    slot(who, "name", m.name || m.login);
    var out = $('[data-act="signout"]', who);
    out.addEventListener("click", function () {
      out.disabled = true;
      call("POST", "/auth/logout").then(function () { location.reload(); }, function () { out.disabled = false; });
    });
  }
  var needsMe = who || $("[data-when]");
  if (needsMe) me().then(function (m) { renderWho(m); document.dispatchEvent(new CustomEvent("hub:me", { detail: m })); }, function () { document.dispatchEvent(new CustomEvent("hub:me", { detail: null })); });

})();
