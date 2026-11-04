/* WolOS Hub in the browser: sign-in state, search, the viewer for pictures, Copy, the look switch, and the
   forms for publishing and reports. Plain script, no dependencies. The Worker answers on the same origin
   (/api/*, /auth/*); its errors carry a `sentence` that is shown as it is. */
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

  /* ---- The Worker ---- */
  function call(method, path, body) {
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
  function me() {
    if (!meP) meP = call("GET", "/api/me").catch(function (e) { if (e.status === 401) return null; throw e; });
    return meP;
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

  /* ---- Signed in or not ---- */
  var who = $("#who");
  function renderWho(m) {
    if (!who || !m) return;
    who.textContent = "";
    if (m.avatar) who.appendChild(el("img", { src: m.avatar, alt: "", width: "28", height: "28" }));
    who.appendChild(el("span", { class: "login", text: m.name || m.login }));
    var out = el("button", { type: "button", class: "btn btn-quiet", text: "Sign out" });
    out.addEventListener("click", function () {
      out.disabled = true;
      call("POST", "/auth/logout").then(function () { location.reload(); }, function () { out.disabled = false; });
    });
    who.appendChild(out);
  }
  var needsMe = who || $("[data-when]");
  if (needsMe) me().then(function (m) { renderWho(m); document.dispatchEvent(new CustomEvent("hub:me", { detail: m })); }, function () { document.dispatchEvent(new CustomEvent("hub:me", { detail: null })); });
  var show = function (root, name, on) { $$('[data-when~="' + name + '"]', root).forEach(function (n) { n.hidden = !on; }); };
  var fail = function (form, e, which) {
    var box = $("[data-err" + (which ? '="' + which + '"' : "") + "]", form || document) || $("[data-err]");
    if (box) box.textContent = e.message || GENERIC;
  };

  /* ---- Search ---- */
  var results = $("#results");
  if (results) {
    var q = $("#q"), count = $("#count"), rows = null;
    var words = function (s) { return s.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean); };
    var score = function (r, ws) {
      var n = r.n.toLowerCase(), hay = (r.n + " " + r.id + " " + r.s + " " + r.a + " " + r.k + " " + r.c.join(" ") + " " + r.tl).toLowerCase(), sc = 0;
      for (var i = 0; i < ws.length; i++) {
        if (hay.indexOf(ws[i]) < 0) return 0;
        sc += n.indexOf(ws[i]) === 0 ? 6 : n.indexOf(ws[i]) > 0 ? 4 : r.id.indexOf(ws[i]) >= 0 ? 3 : 1;
      }
      return sc;
    };
    var card = function (r) {
      var li = el("li", { class: "card item" });
      var a = el("a", { class: "stretch", href: r.u }, [el("span", { class: "sr", text: r.n + ", " })]);
      var meta = el("p", { class: "meta" }, [
        el("span", { class: "badge badge-" + r.t }, [el("span", { class: "dot", "aria-hidden": "true" }), document.createTextNode(r.tl)]),
        el("span", { class: "dim", text: r.a + " · " + r.k }),
      ]);
      var body = el("div", { class: "item-body" }, [el("h3", { text: r.n }), el("p", { class: "dim", text: r.s }), meta]);
      li.appendChild(a);
      li.appendChild(el("span", { class: "tile t-" + (r.t === "wolos" ? "wolos" : "system"), "aria-hidden": "true", text: r.n.charAt(0).toUpperCase() }));
      li.appendChild(body);
      return li;
    };
    var run = function () {
      var text = q.value.trim(), ws = words(text);
      results.textContent = "";
      if (!ws.length) { count.textContent = "Type a name, a maker or a few words."; return; }
      var hits = rows.map(function (r) { return [score(r, ws), r]; }).filter(function (x) { return x[0] > 0; })
        .sort(function (a, b) { return b[0] - a[0] || a[1].n.localeCompare(b[1].n); });
      hits.forEach(function (x) { results.appendChild(card(x[1])); });
      count.textContent = hits.length ? hits.length + (hits.length === 1 ? " result" : " results") + " for “" + text + "”" : "Nothing matches “" + text + "”. Try a shorter word, or browse the apps, plugins and extensions.";
    };
    var start = function () {
      q.value = new URLSearchParams(location.search).get("q") || "";
      run();
      q.addEventListener("input", function () {
        run();
        var u = new URL(location.href); if (q.value.trim()) u.searchParams.set("q", q.value.trim()); else u.searchParams.delete("q");
        history.replaceState(null, "", u);
      });
    };
    fetch("/search.json").then(function (r) { return r.json(); }).then(function (j) { rows = j; start(); }, function () { count.textContent = OFFLINE; });
  }

  /* ---- Pictures: the viewer ---- */
  var dlg = null, shots = [], at = 0, opener = null;
  function paint() {
    var a = shots[at], img = a.querySelector("img"), ratio = Number(a.dataset.fw) / Number(a.dataset.fh) || 1.6;
    var dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    var natural = Math.max(Number(a.dataset.w) || 0, Number(a.dataset.fw) / dpr);
    var fig = $("figure", dlg); fig.textContent = "";
    fig.style.width = "min(" + natural.toFixed(1) + "px, calc(100vw - 2rem), calc((100dvh - 9rem) * " + ratio.toFixed(4) + "))";
    var pic = el("picture");
    if (a.dataset.webp) pic.appendChild(el("source", { type: "image/webp", srcset: a.dataset.webp }));
    pic.appendChild(el("img", { src: a.getAttribute("href"), alt: img ? img.alt : "", width: a.dataset.fw, height: a.dataset.fh, draggable: "false" }));
    fig.appendChild(pic);
    var cap = el("figcaption", { text: img ? img.alt : "" });
    if (shots.length > 1) cap.appendChild(el("span", { text: (at + 1) + " of " + shots.length }));
    fig.appendChild(cap);
  }
  function go(k) { at = (at + k + shots.length) % shots.length; paint(); }
  function make() {
    var d = el("dialog", { class: "lightbox", "aria-label": "Picture viewer" });
    var close = el("button", { type: "button", class: "lb-btn lb-close", "aria-label": "Close the picture", text: "×" });
    var prev = el("button", { type: "button", class: "lb-btn lb-prev", "aria-label": "Previous picture", text: "‹" });
    var next = el("button", { type: "button", class: "lb-btn lb-next", "aria-label": "Next picture", text: "›" });
    var box = el("div", { class: "lb" }, [el("figure")]);
    [box, close, prev, next].forEach(function (n) { d.appendChild(n); });
    close.addEventListener("click", function () { d.close(); });
    prev.addEventListener("click", function () { go(-1); });
    next.addEventListener("click", function () { go(1); });
    box.addEventListener("click", function (e) { if (e.target === box) d.close(); });
    d.addEventListener("keydown", function (e) {
      if (shots.length > 1 && e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (shots.length > 1 && e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    });
    d.addEventListener("close", function () { document.documentElement.style.overflow = ""; if (opener) opener.focus({ preventScroll: true }); });
    document.body.appendChild(d);
    return d;
  }
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest("a[data-lightbox]"); if (!a) return;
    e.preventDefault();
    shots = $$("a[data-lightbox]"); at = Math.max(0, shots.indexOf(a)); opener = a;
    dlg = dlg || make();
    var many = shots.length > 1;
    $(".lb-prev", dlg).hidden = $(".lb-next", dlg).hidden = !many;
    paint();
    document.documentElement.style.overflow = "hidden";
    dlg.showModal();
    $(".lb-close", dlg).focus();
  });

  /* ---- Publish ---- */
  var pub = $("#s-signin");
  if (pub) {
    var claForm = $("#cla-form"), lf = $("#listing-form"), cla = null;
    var setMe = function (name, v) { $$('[data-me="' + name + '"]').forEach(function (n) { n.textContent = v; }); };
    var cur = null;
    var draw = function (m) {
      cur = m;
      show(document, "out", !m); show(document, "in", !!m);
      if (!m) return;
      setMe("login", m.login);
      var ok = m.cla && m.cla.ok;
      show(document, "cla", !ok); show(document, "cla-ok", ok); setMe("cla", ok ? m.cla.accepted : "");
      show(document, "link", ok);
      var orgs = (m.orgs || []).filter(function (o) { return o.role === "owner"; });
      var list = $("#org-list"); list.textContent = "";
      var owner = $("#f-owner"); owner.textContent = "";
      owner.appendChild(el("option", { value: "person", text: m.login + " (you)" }));
      (m.orgs || []).forEach(function (o) {
        if (o.linked && o.cla && o.cla.ok) owner.appendChild(el("option", { value: o.login, text: o.login + " (organisation)" }));
      });
      show(document, "orgs", ok && orgs.length > 0);
      orgs.forEach(function (o) {
        var li = el("li", { class: "org-row" }, [el("span", { text: o.login + (o.linked && o.cla && o.cla.ok ? " is linked." : " is yours on GitHub.") })]);
        if (!(o.linked && o.cla && o.cla.ok)) {
          var b = el("button", { type: "button", class: "btn btn-quiet", text: "Link " + o.login });
          b.addEventListener("click", function () {
            b.disabled = true;
            call("POST", "/api/orgs", { org: o.login, version: cla.version, sha256: cla.sha256 }).then(function () { meP = null; return me(); }, function (e) { fail($("#s-link"), e, "org"); b.disabled = false; throw e; }).then(draw, function () {});
          });
          li.appendChild(b);
        }
        list.appendChild(li);
      });
    };
    document.addEventListener("hub:me", function (e) {
      draw(e.detail);
      if (e.detail && !(e.detail.cla && e.detail.cla.ok)) call("GET", "/api/cla").then(function (c) { cla = c; $("#cla-text").textContent = c.text; }, function (x) { fail(claForm, x); });
      else if (e.detail) call("GET", "/api/cla").then(function (c) { cla = c; }, function () {});
    });
    claForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!cla) return fail(claForm, new Error(GENERIC));
      var btn = $("button[type=submit]", claForm); btn.disabled = true;
      call("POST", "/api/cla", { version: cla.version, sha256: cla.sha256 }).then(function () { meP = null; return me(); }, function (x) { fail(claForm, x); btn.disabled = false; throw x; })
        .then(function (m) { btn.disabled = false; draw(m); }, function () {});
    });
    var kind = $("#f-kind");
    kind.addEventListener("change", function () { $("#host-field").hidden = kind.value !== "extension"; $("#f-host").required = kind.value === "extension"; });
    lf.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = new FormData(lf), body = {};
      ["owner", "kind", "id", "name", "summary", "license", "repo", "asset"].forEach(function (k) { body[k] = String(f.get(k) || "").trim(); });
      if (body.kind === "extension") body.host = String(f.get("host") || "").trim();
      var btn = $("button[type=submit]", lf); btn.disabled = true; $("[data-err]", lf).textContent = "";
      call("POST", "/api/listings", body).then(function (l) {
        lf.hidden = true; show(document, "linked", true); setMe("linked", l.name + " is linked to " + l.source.repo + ". Tag a release in the next step and it appears here.");
      }, function (x) { fail(lf, x); btn.disabled = false; });
    });
  }

  /* ---- Report ---- */
  var rf = $("#report-form");
  if (rf) {
    var p = new URLSearchParams(location.search);
    $("#r-listing").value = p.get("listing") || ""; $("#r-version").value = p.get("version") || "";
    var si = $("#report-signin"); if (si) si.href = "/auth/login?next=" + encodeURIComponent(location.pathname + location.search);
    var text = $("#r-text"), left = $("#r-left");
    text.addEventListener("input", function () { left.textContent = String(2000 - text.value.length); });
    document.addEventListener("hub:me", function (e) { show(document, "out", !e.detail); show(document, "in", !!e.detail); });
    rf.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = new FormData(rf), err = $("[data-err]", rf);
      var body = { listing_id: String(f.get("listing_id") || "").trim(), reason: f.get("reason"), text: String(f.get("text") || "").trim() };
      var v = String(f.get("version") || "").trim(); if (v) body.version = v;
      if (!body.listing_id) { err.textContent = "Give the id of the listing."; $("#r-listing").focus(); return; }
      if (!body.reason) { err.textContent = "Choose what is wrong."; $("input[name=reason]", rf).focus(); return; }
      if (!body.text) { err.textContent = "Tell us what happened."; text.focus(); return; }
      err.textContent = "";
      var btn = $("button[type=submit]", rf); btn.disabled = true;
      call("POST", "/api/reports", body).then(function (j) {
        rf.hidden = true; $("#report-done").hidden = false; $("[data-me=report]").textContent = String(j.report.id); $("#report-done").setAttribute("tabindex", "-1"); $("#report-done").focus();
      }, function (x) { err.textContent = x.message; btn.disabled = false; });
    });
  }

  /* ---- Sign-in trouble ---- */
  var msg = $("#signin-msg");
  if (msg) {
    var WHY = { denied: "You cancelled the sign-in on GitHub.", state: "The sign-in took too long or started on another page. Try again.", banned: "This account can't sign in to the hub." };
    var code = new URLSearchParams(location.search).get("error");
    if (code) msg.textContent = WHY[code] || "The sign-in did not finish. Try again.";
  }
})();
