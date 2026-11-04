/* WolOS Hub, the components of the pages for people who publish, loaded by hub.js kit() when a page first needs one:
   the agreement component (agreementNodes) and the long list (vlist). Plain script, no dependencies. */
(function () {
  "use strict";
  var H = window.Hub, el = H.el, msg = H.msg, $ = H.$;
  /* ---- The agreement component (hub.js agreement() fetches the text and calls this): one text from /api/terms/<doc> (the exact bytes that are hashed and accepted), drawn the
     way its own page /terms/<doc> draws it (scripts/lib/legal.mjs markdown()): the title, the version line, the "In short"
     box, numbered sections with their headings, paragraphs and lists. Every page that shows an agreement (publish step 2,
     the dashboard's Trust Terms) uses this, never the raw text. Built from DOM nodes, never innerHTML. */
  function inline(t) {
    var f = document.createDocumentFragment(), re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https:\/\/[^)\s"]+|\/[^)\s"]*)\)/g, at = 0, m;
    while ((m = re.exec(t))) {
      if (m.index > at) f.appendChild(document.createTextNode(t.slice(at, m.index)));
      f.appendChild(m[1] ? el("code", { text: m[1] }) : m[2] ? el("strong", { text: m[2] }) : el("a", { href: m[4], text: m[3] }));
      at = re.lastIndex;
    }
    if (at < t.length) f.appendChild(document.createTextNode(t.slice(at)));
    return f;
  }
  function agreementNodes(md) {
    var body = String(md).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "");
    var out = document.createDocumentFragment(), para = [], list = null, quote = null, sec = null;
    var into = function () { return sec || out; };
    var p = function (t) { var n = el("p"); n.appendChild(inline(t)); return n; };
    var flush = function () {
      if (para.length) { into().appendChild(p(para.join(" "))); para = []; }
      if (list) { var ul = el(list.tag); list.items.forEach(function (i) { var li = el("li"); li.appendChild(inline(i)); ul.appendChild(li); }); into().appendChild(ul); list = null; }
      if (quote) { var q = el("aside", { class: "agreement-short" }); quote.forEach(function (x) { q.appendChild(p(x)); }); into().appendChild(q); quote = null; }
    };
    body.split("\n").forEach(function (raw) {
      var l = raw.trim(), m;
      if (!l) return flush();
      if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) {
        flush();
        if (m[1].length === 1) { var h = el("h3", { class: "agreement-title" }); h.appendChild(inline(m[2])); out.appendChild(h); sec = null; return; }
        if (m[1].length === 2) { sec = el("section", { class: "agreement-sec" }); out.appendChild(sec); }
        var hh = el(m[1].length === 2 ? "h4" : "h5"); hh.appendChild(inline(m[2])); into().appendChild(hh); return;
      }
      if ((m = /^>\s?(.*)$/.exec(l))) { if (!quote) flush(); quote = quote || []; if (m[1]) quote.push(m[1]); return; }
      if (quote) flush();
      if ((m = /^[-*]\s+(.*)$/.exec(l))) { if (para.length) { into().appendChild(p(para.join(" "))); para = []; } list = list || { tag: "ul", items: [] }; list.items.push(m[1]); return; }
      if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1] += " " + l; return; }
      if (list) flush();
      if (/^Version \S+, effective /.test(l) && !para.length) { flush(); var v = el("p", { class: "agreement-version dim small" }); v.appendChild(inline(l)); into().appendChild(v); return; }
      para.push(l);
    });
    flush();
    return out;
  }
  /* ---- The long-list component: rows of one fixed height (the box's data-row, px) in a box with its own scroll; only the
     rows in view (and a few around them) are in the page, so 300 or 3,000 items cost the same. draw(item, li) fills a row;
     the box's height follows the list up to data-max rows. Used by the repository picker, the sessions list and the
     admin tables. */
  function vlist(box, draw) {
    var rowH = +box.dataset.row || 64, maxRows = +box.dataset.max || 7, items = [], drawn = {}, raf = 0;
    var pad = el("ul", { class: "vlist-pad", role: box.dataset.role || "list" });
    box.textContent = ""; box.appendChild(pad); box.classList.add("vlist");
    function paint() {
      raf = 0;
      var top = box.scrollTop, h = box.clientHeight || rowH * maxRows;
      var from = Math.max(0, Math.floor(top / rowH) - 4), to = Math.min(items.length, Math.ceil((top + h) / rowH) + 4), keep = {};
      for (var i = from; i < to; i++) {
        var li = drawn[i];
        if (!li) { li = el("li", { class: "vrow" }); li.style.transform = "translateY(" + i * rowH + "px)"; draw(items[i], li, i); pad.appendChild(li); }
        keep[i] = li;
      }
      Object.keys(drawn).forEach(function (k) { if (!keep[k]) drawn[k].remove(); });
      drawn = keep;
    }
    box.addEventListener("scroll", function () { if (!raf) raf = requestAnimationFrame(paint); }, { passive: true });
    return {
      set: function (list) {
        items = list || []; Object.keys(drawn).forEach(function (k) { drawn[k].remove(); }); drawn = {};
        pad.style.height = items.length * rowH + "px";
        box.style.height = Math.min(items.length, maxRows) * rowH + 2 + "px";
        box.hidden = !items.length; box.scrollTop = 0; paint();
      },
      redraw: function () { Object.keys(drawn).forEach(function (k) { drawn[k].remove(); }); drawn = {}; paint(); },
      items: function () { return items; },
    };
  }
  /* One row of the repository picker on /publish: its state and its one button (Connect, Install and connect, Link, See it). */
  function repoRow(r, li, api) {
    var st = api.st();
    var main = el("div", { class: "vrow-main" }), sub = el("div", { class: "vrow-sub" }), act = el("div", { class: "vrow-act" });
    main.appendChild(el("span", { class: "rname", text: r.full_name, title: r.full_name }));
    var n = r.note, badge = r.connected ? ["r-connected", "trusted"] : r.private ? ["r-private", "community"] : r.app === false ? ["r-not-installed", "community"] : ["r-installed", "origin"];
    sub.appendChild(el("span", { class: "badge badge-" + badge[1], text: msg(badge[0]) }));
    var why = n === "connected" ? msg("conn-as") + " " + r.connected : n === "private" ? msg("private") : n === "org-not-linked" ? (r.owner_role === "owner" ? msg("link-why") : msg("link-owner")) : n === "not-yours" ? msg("not-yours") : r.description || "";
    sub.appendChild(el("span", { class: "rdesc", text: why, title: why }));
    main.appendChild(sub);
    if (n === "connected") act.appendChild(el("a", { class: "btn btn-quiet btn-sm", href: "/dashboard" + (r.owner.type === "Organization" ? "?as=" + encodeURIComponent(r.owner.login) : ""), text: msg("r-see") }));
    else if (n === "org-not-linked" && r.owner_role === "owner") {
      var lb = el("button", { type: "button", class: "btn btn-quiet btn-sm", "data-act": "link-org", text: msg("r-link") + " " + r.owner.login });
      lb.onclick = function () { api.linkOrg(r, lb); };
      act.appendChild(lb);
    } else if (!n && r.app === false && r.install) {
      var ia = el("a", { class: "btn btn-quiet btn-sm", "data-act": "install-connect", href: api.installHref(r), rel: "noopener", text: msg("r-install") });
      ia.addEventListener("click", function () { api.remember(r); });
      act.appendChild(ia);
    } else if (!n) {
      var cb = el("button", { type: "button", class: "btn btn-solid btn-sm", "data-act": "connect-row", text: msg("connect") });
      cb.onclick = function (e) { e.stopPropagation(); api.pick(r); api.connect(cb); };
      act.appendChild(cb);
    }
    if (!n) { li.addEventListener("click", function (e) { if (!e.target.closest("a,button")) { api.pick(r); api.redraw(); } }); li.style.cursor = "pointer"; }
    if (st.picked && st.picked.id === r.id) li.setAttribute("data-picked", "");
    li.dataset.repo = r.full_name;
    li.appendChild(main); li.appendChild(act);
  }
  /* The repository picker's list (search, count, empty sentence, the pick, coming back from GitHub) and its account tabs. */
  function picker(api) {
    var st = api.st();
  function list() {
    var r = st.repos, all = r ? r.repos : [], q = st.q;
    if (st.reposErr && !r) { api.pickerState("error"); H.fail($("#repo-error"), st.reposErr, "repos"); return; }
    if (!r) { api.pickerState("loading"); return; }
        performance.mark("hub-repos-data");
    var usable = all.filter(function (x) { return !x.note; });
    if (!st.picked || !usable.some(function (x) { return x.id === st.picked.id; })) { var first = usable.filter(function (x) { return x.app !== false; })[0] || usable[0]; if (first) api.pick(first); else st.picked = null; }
    var shown = q ? all.filter(function (x) { return x.full_name.toLowerCase().indexOf(q) >= 0; }) : all;
    var withApp = all.filter(function (x) { return x.app !== false; }).length;
    $("#repo-count").textContent = (q ? shown.length + " " + msg("r-shown") + " / " : "") + all.length + " " + msg("r-count") + ", " + withApp + " " + msg("r-with") + (r.truncated ? ". " + msg("r-more") : "");
    if (!shown.length) { api.pickerState("empty"); $("#repo-empty").textContent = all.length ? msg("r-nomatch") : msg("r-none"); }
    else api.pickerState("list");
    api.vl().set(shown);
    performance.mark("hub-repos-drawn"); try { performance.measure("hub-repos", "hub-repos-data", "hub-repos-drawn"); } catch (x) {}
    $("#connect-go").disabled = !st.picked;
    var pend = st.pending;
    if (pend && pend.as === api.asNow()) {
      var got = all.filter(function (x) { return x.id === pend.id; })[0];
      st.pending = null; api.forgetPending();
      if (got && !got.note && got.app !== false) { var kr = $('input[name=kind][value="' + pend.kind + '"]'); if (kr) kr.checked = true; api.pick(got); api.vl().redraw(); api.connect($("#connect-go")); }
      else if (got) { api.pick(got); api.vl().redraw(); }
    }
  }
  function tabs() {
    var nav = $("#repo-tabs"), m = st.me; if (!m) return;
    var accts = [m.login].concat((m.orgs || []).map(function (o) { return o.login; }));
    nav.hidden = accts.length < 2; nav.textContent = "";
    accts.forEach(function (login, i) {
      var as = i ? login : "", a = el("a", { href: "/publish" + (as ? "?as=" + encodeURIComponent(as) : "") + "#s-connect", text: login });
      if (as === api.asNow()) a.setAttribute("aria-current", "true");
      a.onclick = function (e) {
        e.preventDefault(); if (as === api.asNow()) return;
        st.as = as; st.repos = st.reposBy[as] || null; st.picked = null;
        history.replaceState(null, "", "/publish" + (as ? "?as=" + encodeURIComponent(as) : "") + "#s-connect");
        tabs(); list(); api.loadRepos(!!st.reposBy[as]);
      };
      nav.appendChild(a);
    });
  }
    return { list: list, tabs: tabs };
  }
  /* Draws the text of `doc` into `box` (.agreement-text); gives {doc, version, text, sha256}. */
  function agreement(box, doc, termsText) {
    box.dataset.doc = doc; box.setAttribute("aria-busy", "true");
    box.textContent = ""; box.appendChild(el("span", { class: "skel skel-line" }));
    return termsText(doc).then(function (t) {
      if (box.dataset.doc !== doc) return t;
      box.textContent = ""; box.appendChild(agreementNodes(t.text)); box.removeAttribute("aria-busy"); box.terms = t;
      return t;
    }, function (e) { if (box.dataset.doc === doc) { box.textContent = ""; box.appendChild(el("p", { class: "err", text: e.message })); box.removeAttribute("aria-busy"); } throw e; });
  }
  window.HubKit = { agreement: agreement, picker: picker, agreementNodes: agreementNodes, vlist: vlist, repoRow: repoRow };
})();
