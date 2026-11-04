/* WolOS Hub, the publish page: five steps in a rail. The page asks the Worker once (the person and their listings), then for
   the repositories the hub is installed on. Finished steps fold into a line, the step that needs the person opens, and the page
   notices the tag the person pushes. Words come from the page. */
(function () {
  "use strict";
  var H = window.Hub, $ = H.$, $$ = H.$$, el = H.el, call = H.call, slot = H.slot, msg = H.msg, fail = H.fail;
  var root = $("[data-overview=publish]");
  if (!root) return;
  var rail = $$(".rail-item"), steps = $$(".pstep");
  var st = { me: null, ov: null, repos: null, reposBy: {}, reposErr: null, as: H.asOf(), q: "", picked: null, more: false, doc: "cla", conn: null, loadingRepos: false, pending: null };

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
  var text = H.terms;
  function showDoc(d) {
    st.doc = d;
    $$("#agree-tabs button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.doc === d)); });
    $("#agree-link").href = "/terms/" + d;
    H.agreement($("#agree-text"), d).then(null, function () {});
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

  /* ---- Steps 3 and 4: the person's (or ?as= organisation's) repositories with their state, in the long list (kit.js repoRow) ---- */
  var PENDING = "hub-connect";
  var asNow = function () { return st.as || ""; };
  var reposUrl = function (as) { return "/api/repos" + (as ? "?as=" + encodeURIComponent(as) : ""); };
  var rank = function (x) { return x.connected ? 0 : x.app !== false ? 1 : 2; };
  function loadRepos(fresh) {
    var as = asNow();
    if (st.loadingRepos === as && !fresh) return;
    st.loadingRepos = as; wait(3, true);
    if (!st.reposBy[as]) pickerState("loading");
    return call("GET", reposUrl(as), undefined, fresh ? "reload" : null).then(function (r) {
      r.repos = r.repos.slice().sort(function (a, b) { return rank(a) - rank(b) || (b.pushed_at || 0) - (a.pushed_at || 0); });
      st.reposBy[as] = r; if (as === asNow()) st.repos = r; if (!as) H.save("repos", r); st.reposErr = null;
    }, function (e) { if (e.status === 401) return; st.reposErr = e; if (!st.reposBy[as]) st.repos = null; fail(steps[2], e, "inst"); })
      .then(function () { if (st.loadingRepos === as) st.loadingRepos = false; wait(3, false); if (st.ov) paint(st.ov); });
  }
  /* loading (skeleton), list, empty (a sentence), error (a sentence and Try again). */
  function pickerState(s) {
    $("#repo-skel").hidden = s !== "loading";
    $("#repo-list").hidden = s !== "list";
    $("#repo-empty").hidden = s !== "empty";
    $("#repo-error").hidden = s !== "error";
  }
  var vl = null;
  var api = { st: function () { return st; }, pick: pick, connect: function (b) { connect(b); }, asNow: function () { return asNow(); }, pickerState: function (x) { pickerState(x); },
    forgetPending: function () { forgetPending(); }, loadRepos: function (f) { return loadRepos(f); }, list: function () { repoList(); }, vl: function () { return vl; }, installHref: function (r) { return installHref(r); }, remember: function (r) { remember(r); }, redraw: function () { if (vl) vl.redraw(); },
    linkOrg: function (r, b) {
      b.disabled = true;
      text("cla").then(function (c) { return call("POST", "/api/orgs", { org: r.owner.login, version: c.version, sha256: c.sha256 }); })
        .then(function () { return Promise.all([H.overview("", true), loadRepos(true)]); }, function (e) { fail(steps[3], e, "connect"); b.disabled = false; });
    } };
  /* GitHub's address that installs WolOS Hub on exactly this repository; `state` names the step and the repository. */
  function installHref(r) { return r.install + "&state=" + encodeURIComponent("connect." + r.id + "." + kindNow()); }
  function remember(r) { try { localStorage.setItem(PENDING, JSON.stringify({ id: r.id, as: asNow(), kind: kindNow(), at: Date.now() })); } catch (x) {} }
  /* Back from GitHub: ?state=connect.<id>.<kind> (GitHub's setup step), or what this browser remembered (30 minutes). */
  function pendingConnect() {
    var p = new URLSearchParams(location.search), m = /^connect\.(\d+)\.(app|plugin|extension)$/.exec(p.get("state") || ""), kept = null;
    try { kept = JSON.parse(localStorage.getItem(PENDING) || "null"); } catch (x) {}
    if (m) return { id: +m[1], kind: m[2], as: p.get("as") || (kept && kept.id === +m[1] ? kept.as : "") };
    return kept && Date.now() - kept.at < 18e5 ? kept : null;
  }
  function forgetPending() {
    try { localStorage.removeItem(PENDING); } catch (x) {}
    var p = new URLSearchParams(location.search);
    if (p.has("state") || p.has("installation_id") || p.has("setup_action")) {
      ["state", "installation_id", "setup_action", "code"].forEach(function (k) { p.delete(k); });
      history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : "") + location.hash);
    }
  }
  /* The list and the account tabs are the kit's picker (kit.js picker()); until the kit is here the skeleton stays. */
  var P = null;
  function repoList() {
    if (P) return P.list();
    if (!st.repos && !st.reposErr) return pickerState("loading");
    pickerState("loading");
    H.kit().then(function (k) { if (!P) { vl = k.vlist($("#repo-list"), function (r, li) { k.repoRow(r, li, api); }); P = k.picker(api); P.tabs(); } repoList(); },
      function (e) { st.reposErr = e; st.repos = null; pickerState("error"); fail($("#repo-error"), e, "repos"); });
  }
  function tabs() { if (P) P.tabs(); }
  $("#repo-q").addEventListener("input", function () { st.q = this.value.trim().toLowerCase(); repoList(); });
  $("[data-act=repos-again]").addEventListener("click", function () { loadRepos(true); });
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
    $("#connect-go").textContent = st.picked ? (st.picked.app === false ? msg("r-install") : msg("connect")) + " " + st.picked.full_name : msg("connect");
  }
  function pick(r) { st.picked = r; $("[data-err=connect]").textContent = ""; fillFields(); $("#connect-go").disabled = false; }
  $("#kind-pick").addEventListener("change", fillFields);
  $("#listing-form").addEventListener("input", about);
  /* Connect the picked repository with what the form says (filled in from GitHub); not installed yet: to GitHub first. */
  function connect(btn) {
    var p = st.picked, F = $("#listing-form").elements, k = kindNow();
    if (!p) return;
    if (p.app === false && p.install) { remember(p); location.href = installHref(p); return; }
    var body = { repo: p.full_name, kind: k, id: F.id.value.trim(), name: F.name.value.trim(), summary: F.summary.value.trim(), license: F.license.value.trim(), asset: F.asset.value.trim() };
    if (p.owner.type === "Organization") body.owner = p.owner.login;
    if (k === "extension") body.host = F.host.value.trim();
    btn.disabled = true; $("[data-err=connect]").textContent = "";
    call("POST", "/api/listings", body).then(function (l) {
      st.conn = l.id; st.more = false;
      return Promise.all([H.overview("", true), loadRepos(true)]);
    }).then(function (r) { btn.disabled = false; paint(r[0]); steps[4].scrollIntoView({ block: "start", behavior: "smooth" }); },
      function (e) { btn.disabled = false; fail(steps[3], e, "connect"); if (/^bad-(license|id|asset|host)$/.test(e.code)) $(".det", steps[3]).open = true; });
  }
  $("#connect-go").addEventListener("click", function () { connect(this); });
  $$("[data-act=inst-check]").forEach(function (b) { b.addEventListener("click", function () { loadRepos(true); }); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && st.me && st.repos && (st.pending || !st.repos.installed || !st.repos.repos.some(function (r) { return !r.private && r.app !== false; }))) loadRepos(true); });
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
    tabs();
    var r = st.repos, pub = r ? r.repos.filter(function (x) { return !x.private; }) : [], onApp = pub.filter(function (x) { return x.app !== false; });
    /* Not here yet: step 3 waits and step 4 shows the list's skeleton (or, when GitHub did not answer, the sentence). */
    if (!r) { mark(3, "current"); mark(4, "current"); mark(5, "todo"); repoList(); return; }
    /* Step 3 is done as soon as there is a public repository to pick: installing is one button on its row in step 4. */
    $("[data-inst=none]").hidden = r.installed && onApp.length > 0; $("[data-inst=private]").hidden = !r.installed || pub.length > 0; $("[data-inst=empty]").hidden = pub.length > 0;
    var usable = pub.length > 0;
    mark(3, usable ? "done" : "current", onApp.length ? inst(onApp.length) : usable ? msg("r-pick-sub") : msg("so-hub-sees"));
    slot(steps[2], "inst-sum", onApp.length ? inst(onApp.length) + "." : msg("r-pick-sub") + ".");
    if (!usable && !asNow()) { mark(4, "todo"); mark(5, "todo"); watch(false); return; }
    var has = o.listings.length > 0;
    mark(4, has && !st.more ? "done" : "current", has ? msg("connected") : msg("pick-one"));
    mark(5, has ? "current" : "todo");
    if (st.pending) { st.more = true; mark(4, "current"); }
    if (!has || st.more) repoList();
    if (has) { tagStep(o); watch(true); } else watch(false);
  }

  st.pending = pendingConnect();
  if (st.pending && st.pending.as) st.as = st.pending.as;
  /* The last answer first (marked as old by drawing nothing new until the fresh one arrives), then the fresh one. */
  var s = H.snap(""), hint = document.documentElement.dataset.who;
  if (hint) {
    /* Signed in on the last page: the repositories are asked for now, beside the person's answer, not after it. */
    if (!asNow() && !st.pending) { st.repos = H.snap("repos"); if (st.repos) st.reposBy[""] = st.repos; }
    loadRepos(!!st.pending);
    if (s) paint(s, true);
  }
  /* Signed in or out in another tab: the steps follow without a reload. */
  document.addEventListener("hub:who", function () {
    st.repos = null; st.reposBy = {}; st.picked = null;
    H.overview("", true).then(function (o) { paint(o); loadRepos(true); }, function (e) { if (e.status === 401) paint(null); });
  });
  H.overview("").then(function (o) {
    paint(o); if (o.me && need(o.me).length === 0 && !hint) loadRepos(!!st.pending);
  }, function (e) { if (e.status === 401) paint(null); else { root.removeAttribute("data-pending"); fail(steps[0], e); } });
})();
