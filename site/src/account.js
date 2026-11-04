/* WolOS Hub, the report form and sign-in trouble. (Publishing is src/publish.js, the dashboard src/dashboard.js, a version's status
   src/status.js.) Words come from the page (its hidden messages). */
(function () {
  "use strict";
  var H = window.Hub, $ = H.$, call = H.call, msg = H.msg, show = H.show;
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
