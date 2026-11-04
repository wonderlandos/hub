/* WolOS Hub, the publish page: five steps in a rail. The page asks the Worker once (the person and their listings), then for
   the repositories the hub is installed on. Finished steps fold into a line, the step that needs the person opens, and the page
   notices the tag the person pushes. Words come from the page. */
(function () {
  "use strict";
  var H = window.Hub, $ = H.$, $$ = H.$$, el = H.el, call = H.call, slot = H.slot, msg = H.msg, fail = H.fail;
  var root = $("[data-overview=publish]");
  if (!root) return;
  var rail = $$(".rail-item"), steps = $$(".pstep");
  var st = { me: null, ov: null, repos: null, picked: null, more: false, texts: {}, doc: "cla", conn: null, loadingRepos: false };

  function mark(n, state, sub) {
    steps[n - 1].dataset.state = state; rail[n - 1].dataset.state = state;
    if (sub !== undefined) slot(rail[n - 1], "sub", sub);
  }
  var wait = function (n, on) { if (on) steps[n - 1].setAttribute("data-loading", ""); else steps[n - 1].removeAttribute("data-loading"); };
  var inst = function (n) { return msg("installed-on") + " " + n + (n === 1 ? " repository" : " repositories"); };
  var nextVersion = function (v) { var p = String(v).split("."); var i = p.length - 1; while (i > 0 && !/^\d+$/.test(p[i])) i--; p[i] = String(+p[i] + 1); return p.slice(0, i + 1).join("."); };

  /* ---- Step 2: the two agreements, one screen ---- */
  var DOC = { cla: "Contributor Agreement", publisher: "Publisher Agreement" };
  var need = function (m) { return ["cla", "publisher"].filter(function (d) { var s = d === "cla" ? m.cla : m.terms.publisher; return !(s && s.ok); }); };
  var text = function (d) { return st.texts[d] || (st.texts[d] = call("GET", "/api/terms/" + d)); };
  function showDoc(d) {
    st.doc = d;
    $$("#agree-tabs button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.doc === d)); });
    $("#agree-link").href = "/terms/" + d;
    var box = $("#agree-text"); box.textContent = ""; box.appendChild(el("span", { class: "skel skel-line" }));
    text(d).then(function (t) { if (st.doc === d) box.textContent = t.text; }, function (e) { box.textContent = e.message; });
  }
  function terms(m) {
    var todo = need(m);
    $$("#agree-tabs button, #agree-form .check").forEach(function (n) { n.hidden = todo.indexOf(n.dataset.doc) < 0; });
    $("#agree-tabs").hidden = todo.length < 2;
    var changed = ["cla", "publisher"].filter(function (d) { var s = d === "cla" ? m.cla : m.terms.publisher; return s && s.accepted && !s.ok; });
    $$("[data-msg^=changed-]").forEach(function (p) { p.hidden = changed.indexOf(p.dataset.msg.slice(8)) < 0; });
    if (todo.length) { showDoc(todo.indexOf(st.doc) < 0 ? todo[0] : st.doc); todo.forEach(text); }
    slot(steps[1], "versions", m.cla.current === m.terms.publisher.current ? m.cla.current : m.cla.current + " and " + m.terms.publisher.current);
    return todo.length === 0;
  }
  $("#agree-tabs").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) showDoc(b.dataset.doc); });
  $("#agree-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = $("#agree-form"), todo = need(st.me);
    if (todo.some(function (d) { return !f.elements[d].checked; })) return fail(f, new Error(msg("tick")));
    var btn = $("button[type=submit]", f); btn.disabled = true; $("[data-err]", f).textContent = "";
    todo.reduce(function (p, d) { return p.then(function () { return text(d); }).then(function (t) { return call("POST", "/api/terms/" + d, { version: t.version, sha256: t.sha256 }); }); }, Promise.resolve())
      .then(function () { return H.overview("", true); }).then(function (o) { btn.disabled = false; paint(o); }, function (x) { fail(f, x); btn.disabled = false; });
  });

  /* ---- Steps 3 and 4: the repositories the hub is installed on ---- */
  function loadRepos(fresh) {
    if (st.loadingRepos && !fresh) return;
    st.loadingRepos = true; wait(3, true);
    return call("GET", "/api/repos", undefined, fresh ? "reload" : null).then(function (r) { st.repos = r; H.save("repos", r); }, function (e) { st.repos = null; if (e.status !== 401) fail(steps[2], e, "inst"); })
      .then(function () { st.loadingRepos = false; wait(3, false); if (st.ov) paint(st.ov); });
  }
  function repoList() {
    var ul = $("#repo-list"); ul.textContent = "";
    var usable = (st.repos ? st.repos.repos : []);
    usable.forEach(function (r) {
      var li;
      if (r.note) {
        li = H.tpl("t-repo-org"); slot(li, "name", r.full_name);
        var b = $("button", li), n = r.note;
        slot(li, "note", n === "connected" ? msg("conn-as") + " " + r.connected : n === "private" ? msg("private") : n === "org-not-linked" ? (r.owner_role === "owner" ? msg("link-why") : msg("link-owner")) : msg("not-yours"));
        if (n === "org-not-linked" && r.owner_role === "owner") {
          b.textContent += " " + r.owner.login;
          b.onclick = function () {
            b.disabled = true;
            text("cla").then(function (c) { return call("POST", "/api/orgs", { org: r.owner.login, version: c.version, sha256: c.sha256 }); })
              .then(function () { return Promise.all([H.overview("", true), loadRepos(true)]); }, function (e) { fail(steps[3], e, "connect"); b.disabled = false; });
          };
        } else b.remove();
      } else {
        li = H.tpl("t-repo"); var inp = $("input", li);
        slot(li, "name", r.full_name); slot(li, "desc", r.description || "");
        var bd = $("[data-slot=badge]", li); bd.textContent = msg("public"); bd.className = "badge badge-trusted";
        inp.value = r.full_name;
        inp.addEventListener("change", function () { pick(r); });
        if (st.picked && st.picked.id === r.id) inp.checked = true;
        $("[data-slot=note]", li).remove();
      }
      ul.appendChild(li);
    });
    if (!st.picked || !usable.some(function (r) { return r.id === st.picked.id && !r.note; })) {
      var first = usable.filter(function (r) { return !r.note; })[0];
      if (first) { pick(first); var i = $("input", ul.children[usable.indexOf(first)]); if (i) i.checked = true; } else st.picked = null;
    }
    $("#connect-go").disabled = !st.picked;
  }
  var kindNow = function () { return $("input[name=kind]:checked").value; };
  var SUFFIX = { app: ".wol", plugin: ".wolplug", extension: ".wolext" };
  function fillFields() {
    if (!st.picked) return;
    var f = st.picked.fill, k = kindNow(), F = $("#listing-form").elements;
    F.id.value = f.id; F.name.value = f.name; F.summary.value = f.summary; F.license.value = f.license;
    F.asset.value = f.asset.replace(/\.wol(plug|ext)?$/, SUFFIX[k]);
    $("#host-field").hidden = k !== "extension";
    about();
  }
  function about() {
    var F = $("#listing-form").elements;
    slot($("#listed-as"), "id", F.id.value || "?"); slot($("#listed-as"), "asset", F.asset.value || "?");
    $("#connect-go").textContent = st.picked ? msg("connect") + " " + st.picked.full_name : msg("connect");
  }
  function pick(r) { st.picked = r; $("[data-err=connect]").textContent = ""; fillFields(); $("#connect-go").disabled = false; }
  $("#kind-pick").addEventListener("change", fillFields);
  $("#listing-form").addEventListener("input", about);
  $("#connect-go").addEventListener("click", function () {
    var p = st.picked, F = $("#listing-form").elements, btn = this, k = kindNow();
    if (!p) return;
    var body = { repo: p.full_name, kind: k, id: F.id.value.trim(), name: F.name.value.trim(), summary: F.summary.value.trim(), license: F.license.value.trim(), asset: F.asset.value.trim() };
    if (p.owner.type === "Organization") body.owner = p.owner.login;
    if (k === "extension") body.host = F.host.value.trim();
    btn.disabled = true; $("[data-err=connect]").textContent = "";
    call("POST", "/api/listings", body).then(function (l) {
      st.conn = l.id; st.more = false;
      return Promise.all([H.overview("", true), loadRepos(true)]);
    }).then(function (r) { btn.disabled = false; paint(r[0]); steps[4].scrollIntoView({ block: "start", behavior: "smooth" }); },
      function (e) { btn.disabled = false; fail(steps[3], e, "connect"); if (/^bad-(license|id|asset|host)$/.test(e.code)) $(".det", steps[3]).open = true; });
  });
  $$("[data-act=inst-check]").forEach(function (b) { b.addEventListener("click", function () { loadRepos(true); }); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && st.me && st.repos && (!st.repos.installed || !st.repos.repos.some(function (r) { return !r.private; }))) loadRepos(true); });
  $("[data-act=more]").addEventListener("click", function (e) { e.preventDefault(); st.more = true; paint(st.ov); steps[3].scrollIntoView({ block: "start", behavior: "smooth" }); });

  /* ---- Step 5: the tag ---- */
  function tagStep(o) {
    var ls = o.listings.slice().sort(function (a, b) { return b.created_at - a.created_at; });
    var l = ls.filter(function (x) { return x.id === st.conn; })[0] || ls[0];
    if (!l) return;
    var v = l.versions[0] ? nextVersion(l.versions[0].version) : "1.0.0", file = l.asset.replace("*", v);
    var cmd = "git tag v" + v + " && git push origin v" + v + "\ngh release create v" + v + " " + file;
    $("#tag-cmd").textContent = cmd; $("#tag-copy").dataset.copy = cmd;
    slot(steps[3], "conn-sum", l.repo + " " + msg("listed-as") + " " + l.id + ".");
    var seen = $("#tag-seen"), w = $("#tag-wait");
    var att = o.attention.filter(function (a) { return a.href.indexOf("/status?l=" + encodeURIComponent(l.id) + "&") === 0; })[0];
    var href = l.versions[0] ? "/status?l=" + encodeURIComponent(l.id) + "&v=" + encodeURIComponent(l.versions[0].version) : att && att.href;
    seen.hidden = !href; w.hidden = !!href;
    if (href) { $("#tag-link").href = href; $("#tag-link").textContent = l.versions[0] ? msg("see") + " " + l.versions[0].version : att.text; }
  }
  var poll = null;
  function watch(on) {
    clearInterval(poll); poll = null;
    if (on) poll = setInterval(function () { if (!document.hidden) H.overview("", true).then(function (o) { st.ov = o; tagStep(o); }, function () {}); }, 6000 * (window.HubPollScale || 1));
  }

  /* ---- The page ---- */
  function paint(o, stale) {
    root.removeAttribute("data-pending");
    st.ov = o;
    if (!o) { [1, 2, 3, 4, 5].forEach(function (n) { mark(n, n === 1 ? "current" : "todo"); }); watch(false); return; }
    var m = st.me = o.me;
    $$("[data-me=login]").forEach(function (n) { n.textContent = m.login; });
    mark(1, "done", msg("signed-as") + " " + m.login);
    var ok = terms(m);
    mark(2, ok ? "done" : "current", ok ? msg("accepted") : msg("read-two"));
    if (!ok) { [3, 4, 5].forEach(function (n) { mark(n, "todo"); }); watch(false); return; }
    var r = st.repos, pub = r ? r.repos.filter(function (x) { return !x.private; }) : [];
    if (!r) { mark(3, "current"); return; }
    $("[data-inst=none]").hidden = r.installed; $("[data-inst=private]").hidden = !r.installed || pub.length > 0;
    var usable = r.installed && pub.length > 0;
    mark(3, usable ? "done" : "current", usable ? inst(pub.length) : msg("so-hub-sees"));
    slot(steps[2], "inst-sum", inst(pub.length) + ".");
    if (!usable) { mark(4, "todo"); mark(5, "todo"); watch(false); return; }
    var has = o.listings.length > 0;
    mark(4, has && !st.more ? "done" : "current", has ? msg("connected") : msg("pick-one"));
    mark(5, has ? "current" : "todo");
    if (!has || st.more) repoList();
    if (has) { tagStep(o); watch(true); } else watch(false);
  }

  /* The last answer first (marked as old by drawing nothing new until the fresh one arrives), then the fresh one. */
  var s = H.snap(""), hint = document.documentElement.dataset.who;
  if (hint) {
    /* Signed in on the last page: the repositories are asked for now, beside the person's answer, not after it. */
    st.repos = H.snap("repos"); loadRepos();
    if (s) paint(s, true);
  }
  H.overview("").then(function (o) {
    paint(o); if (o.me && need(o.me).length === 0 && !hint) loadRepos();
  }, function (e) { if (e.status === 401) paint(null); else { root.removeAttribute("data-pending"); fail(steps[0], e); } });
})();
