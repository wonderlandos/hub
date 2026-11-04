/* WolOS Hub, the status page of one version: received, checked, signed, published, or why not and what to do. It asks the Worker
   for the version's status, again every few seconds while a stage is under way (a repeated question that has not changed costs
   almost nothing), and stops at a final state. Words come from the Worker's sentences and from the page. */
(function () {
  "use strict";
  var H = window.Hub, $ = H.$, $$ = H.$$, el = H.el, call = H.call, slot = H.slot, msg = H.msg, show = H.show, fail = H.fail;
  var root = $("#st");
  if (!root) return;
  var q = new URLSearchParams(location.search), L = q.get("l") || "", V = q.get("v") || "";
    var bytes = function (n) { return n == null ? "" : n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB"; };
  var nextVersion = function (v) { var p = String(v).split("."); var i = p.length - 1; while (i > 0 && !/^\d+$/.test(p[i])) i--; p[i] = String(+p[i] + 1); return p.slice(0, i + 1).join("."); };
  var K = window.HubPollScale || 1, timer = null, delay = 5000 * K, busy = false, last = null, etag = null;

  function draw(b) {
    last = b;
    root.removeAttribute("data-pending");
    slot(root, "title", b.listing.name + " " + b.version);
    $("h1 .skel", root).hidden = true;
    slot(root, "sub", b.listing.id + " · " + (b.tag ? "tag " + b.tag + " · " : "") + b.listing.repo + " " + msg("on-github"));
    document.title = b.listing.name + " " + b.version + " - WolOS Hub";
    var t = $("#st-track"); t.textContent = ""; t.appendChild(H.track(b.stages));
    var h = $("#st-head"); h.hidden = false;
    h.dataset.outcome = b.outcome;
    slot(h, "title", b.headline.title); slot(h, "sentence", b.headline.sentence); slot(h, "fix", b.headline.fix || "");
    $("[data-slot=fix]", h).hidden = !b.headline.fix;
    $("[data-act=recheck]", h).hidden = !b.can.recheck;
    var lk = $("[data-slot=listing]", h); lk.hidden = !b.listed_path; if (b.listed_path) lk.href = b.listed_path;
    var f = $("#st-find"); f.hidden = !b.findings.length; var fl = $("#st-find-list"); fl.textContent = "";
    b.findings.forEach(function (x) {
      var d = el("div", { class: "fnd" }, [el("strong", { text: x.sentence })]);
      if (x.fix) d.appendChild(el("span", { class: "dim", text: msg("to-fix") + " " + x.fix }));
      fl.appendChild(d);
    });
    var sg = $("#st-sig"); sg.hidden = !b.signature;
    if (b.signature) {
      slot(sg, "statement", b.signature.statement.sentence + " " + (b.signature.statement.at ? H.day(b.signature.statement.at) + "." : ""));
      slot(sg, "author", b.signature.author.sentence);
      $("[data-slot=cert-link]", sg).hidden = b.signature.author.trust !== "community";
    }
    var fi = $("#st-file"); fi.hidden = !b.file;
    if (b.file) {
      slot(fi, "fname", b.file.name); slot(fi, "fsize", bytes(b.file.size)); slot(fi, "furl").href = b.file.url;
      slot(fi, "sha", b.file.sha256 || msg("no-hash")); $("[data-copy-slot=sha]", fi).dataset.copy = b.file.sha256 || ""; $("[data-copy-slot=sha]", fi).hidden = !b.file.sha256;
    }
    var nx = $("#st-next"); nx.hidden = b.headline.code !== "blocked";
    if (!nx.hidden) {
      var nv = nextVersion(b.version), cmd = "git tag v" + nv + " && git push origin v" + nv + "\ngh release create v" + nv + " " + b.listing.asset.replace("*", nv);
      $("#st-cmd").textContent = cmd; $("#st-copy").dataset.copy = cmd;
    }
    $("[data-err]", root).textContent = "";
    clearTimeout(timer);
    if (b.poll) { delay = Math.min(30000 * K, Math.max(b.poll * 1000 * K, delay)); timer = setTimeout(get, delay); }
  }
  function get() {
    if (busy) return; busy = true;
    call("GET", "/api/listings/" + encodeURIComponent(L) + "/versions/" + encodeURIComponent(V) + "/status").then(function (b) {
      busy = false;
      var tag = JSON.stringify(b);
      if (tag !== etag) { etag = tag; delay = 5000 * K; draw(b); } else { delay = Math.min(30000 * K, delay * 1.5); if (last && last.poll) timer = setTimeout(get, delay); }
    }, function (e) {
      busy = false; root.removeAttribute("data-pending");
      if (last) { $("[data-err]", root).textContent = msg("stale"); timer = setTimeout(get, 15000 * K); return; }
      $("h1 .skel", root).hidden = true;
      slot(root, "title", e.status === 404 ? msg("nothing") : msg("failed")); $("[data-err]", root).textContent = e.message;
    });
  }
  $("[data-act=recheck]").addEventListener("click", function () {
    var b = this; b.disabled = true;
    call("POST", "/api/listings/" + encodeURIComponent(L) + "/recheck", { tag: (last && last.tag) || V }).then(function () { b.disabled = false; delay = 5000 * K; etag = null; get(); }, function (e) { b.disabled = false; fail(root, e); });
  });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && last && last.poll) { clearTimeout(timer); get(); } });
  if (!L || !V) { root.removeAttribute("data-pending"); slot(root, "title", msg("nothing")); $("h1 .skel", root).hidden = true; return; }
  get();
})();
