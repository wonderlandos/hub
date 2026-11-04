/* WolOS Hub admin panel. hub.js loads this only after the Worker gave the queue (it answers 404 to anyone without
   a role), and the Worker checks the role again on every action. Every action has a reason box and a confirmation
   sheet, and lands in the audit trail. The buttons follow the role's rights as the Worker grants them. */
(function () {
  "use strict";
  var H = window.Hub, $ = H.$, $$ = H.$$, el = H.el, call = H.call, q = H.queue || {};
  var main = $("main[data-admin]"), role = q.role || "";
  var GRANTS = {
    owner: "approve refuse revoke downgrade resolve takedown flag withdraw second roles errors",
    admin: "approve refuse revoke downgrade takedown withdraw second errors",
    reviewer: "approve refuse flag", support: "resolve",
  };
  /* The Worker's queue lists the permissions of the role ("request.approve"); the panel's actions are named shorter. */
  var PERM = { approve: "request.approve", refuse: "request.refuse", revoke: "cert.revoke", downgrade: "cert.downgrade", second: "cert.revoke", resolve: "report.resolve",
    takedown: "report.takedown", flag: "release.flag", withdraw: "release.withdraw", roles: "roles.manage", errors: "errors.read" };
  var allowed = function (a) { return q.can ? q.can.indexOf(PERM[a] || a) >= 0 : (GRANTS[role] || "").split(" ").indexOf(a) >= 0; };
  var E = encodeURIComponent;
  /* label, sheet title, what happens, route, body (text from the box, choice) */
  var ACTIONS = {
    approve: ["Approve", "Approve this certificate request?", "The certificate is issued. Their listings then carry their name.", function (x) { return "/api/admin/requests/" + x.id + "/approve"; }, function (t) { return { note: t }; }],
    refuse: ["Refuse", "Refuse this certificate request?", "No certificate is issued. The reason is shown to the person who asked.", function (x) { return "/api/admin/requests/" + x.id + "/refuse"; }, function (t) { return { reason: t }; }],
    downgrade: ["Downgrade", "Downgrade to the origin certificate?", "The trusted certificate is revoked as superseded. Their releases keep the origin certificate: who made them and from which repository.", function (x) { return "/api/admin/certs/" + x.serial + "/downgrade"; }, function (t) { return { note: t }; }],
    revoke: ["Revoke", "Revoke every certificate of this subject?", "Every file signed with them is withdrawn on every PC at the next revocation list. A stolen key acts at once; abuse waits for a second admin.", function (x) { return "/api/admin/certs/" + x.serial + "/revoke"; }, function (t, c) { return { reason: c, note: t }; },
      [["key-compromise", "The key was stolen or exposed"], ["abuse", "Abuse of the certificate"]]],
    second: ["Approve the revocation", "Approve this revocation as the second admin?", "The revocation starts now and the files signed with the certificate are withdrawn.", function (x) { return "/api/admin/revocations/" + E(x.group) + "/approve"; }, function (t) { return { note: t }; }],
    flag: ["Flag version", "Flag this version?", "The version is listed with your note shown to everyone, until its maker releases again.", function (x) { return "/api/admin/releases/" + E(x.listing) + "/" + E(x.version) + "/flag"; }, function (t) { return { reason: t }; }],
    withdraw: ["Withdraw version", "Withdraw this version?", "Only this version is withdrawn: it is no longer offered to install or as an update. The certificate of its maker is untouched.", function (x) { return "/api/admin/listings/" + E(x.listing) + "/versions/" + E(x.version) + "/withdraw"; }, function (t) { return { reason: t }; }],
    resolve: ["Resolve", "Close this report without action?", "The listing stays as it is. The report is closed.", function (x) { return "/api/admin/reports/" + x.id + "/resolve"; }, function (t) { return { note: t }; }],
    takedown: ["Take down", "Take this listing down?", "The listing leaves the next signed index and its page.", function (x) { return "/api/admin/reports/" + x.id + "/takedown"; }, function (t) { return { note: t }; }],
    roles: ["Change the role", "Change this person's role?", "The new role applies at their next request. None removes the role.", function () { return "/api/admin/roles"; }, function (t, c, x) { return { login: x.login, role: c, reason: t }; },
      [["owner", "Owner"], ["admin", "Admin"], ["reviewer", "Reviewer"], ["support", "Support"], ["none", "None"]]],
  };
  var day = function (s) { return s ? H.day(s) : ""; };

  /* ---- The confirmation sheet ---- */
  var sheet = el("dialog", { class: "sheet", "aria-labelledby": "sh-t" });
  sheet.innerHTML = '<form class="sheet-form" novalidate><h2 id="sh-t" class="h-md"></h2><p class="dim" id="sh-who"></p><p id="sh-what"></p><fieldset class="field" id="sh-c"></fieldset>' +
    '<div class="field"><label for="sh-r">Reason, kept in the audit trail</label><textarea id="sh-r" rows="4" maxlength="500" required></textarea></div>' +
    '<p class="err" role="alert" id="sh-e"></p><p class="get-btns"><button type="button" class="btn btn-quiet" id="sh-no">Cancel</button><button type="submit" class="btn btn-solid" id="sh-go"></button></p></form>';
  document.body.appendChild(sheet);
  var pending = null;
  $("#sh-no").onclick = function () { sheet.close(); };
  $("form", sheet).addEventListener("submit", function (e) {
    e.preventDefault();
    var text = $("#sh-r").value.trim(), p = pending, A = ACTIONS[p.a], ch = $("input:checked", sheet);
    if (!text) { $("#sh-e").textContent = "Write the reason first."; $("#sh-r").focus(); return; }
    var go = $("#sh-go"); go.disabled = true;
    call("POST", A[3](p.x), A[4](text, ch && ch.value, p.x)).then(function (j) {
      go.disabled = false; sheet.close();
      p.row.classList.add("adm-done");
      $$("button", p.row).forEach(function (b) { b.disabled = true; });
      $(".adm-said", p.row).textContent = j.sentence || "Done: " + A[0] + ".";
    }, function (x) { go.disabled = false; $("#sh-e").textContent = x.message; });
  });
  function ask(a, x, row, who) {
    var A = ACTIONS[a], c = $("#sh-c");
    pending = { a: a, x: x, row: row };
    $("#sh-t").textContent = A[1]; $("#sh-who").textContent = who; $("#sh-what").textContent = A[2];
    $("#sh-go").textContent = A[0]; $("#sh-r").value = ""; $("#sh-e").textContent = "";
    c.textContent = ""; c.hidden = !A[5];
    (A[5] || []).forEach(function (o, i) {
      c.appendChild(el("label", { class: "check" }, [el("input", i ? { type: "radio", name: "sh-c", value: o[0] } : { type: "radio", name: "sh-c", value: o[0], checked: "" }), document.createTextNode(" " + o[1])]));
    });
    sheet.showModal(); $("#sh-r").focus();
  }

  /* ---- Rows and sections ---- */
  function row(list, who, lines, acts, x) {
    var li = el("li", { class: "card adm-row" }, [el("h3", { text: who })]);
    lines.filter(Boolean).forEach(function (l) { li.appendChild(el("p", { class: "dim", text: l })); });
    var bar = el("p", { class: "get-btns" });
    acts.filter(allowed).forEach(function (a, i) {
      var b = el("button", { type: "button", class: "btn " + (i ? "btn-quiet" : "btn-solid"), text: ACTIONS[a][0] });
      b.onclick = function () { ask(a, x, li, who); };
      bar.appendChild(b);
    });
    li.appendChild(bar); li.appendChild(el("p", { class: "adm-said", role: "status" }));
    list.appendChild(li);
  }
  function section(id, title, items, draw, none) {
    var s = el("section", { class: "block", "aria-labelledby": id }, [el("h2", { id: id, text: title + " (" + items.length + ")" })]);
    var list = el("ul", { class: "adm-list" }); s.appendChild(list);
    items.forEach(function (x) { draw(list, x); });
    if (!items.length) s.appendChild(el("p", { class: "dim", text: none }));
    return s;
  }
  var who = function (s) { return s ? (s.name ? s.name + " (" + s.login + ")" : s.login || "") : ""; };
  var tierName = function (t) { return t === "trusted" ? "Trusted developer certificate" : "Origin certificate"; };

  function queue() {
    var box = el("div");
    if (q.requests) box.appendChild(section("a-req", "Certificate requests", q.requests, function (list, r) {
      row(list, who(r.subject), [tierName(r.tier || "origin") + (r.kind === "org" ? ", organisation" : ", person") + ". Asked on " + day(r.created_at || r.requested_at) + ".",
        "Names " + (r.namespaces || []).join(", ") + ", key " + (r.key_id || "") + (r.encryption ? ", with encryption keys." : "."),
        r.status === "approved" ? "Approved by " + r.approved_by + (r.dispatch_error ? ". Issuing did not start: " + r.dispatch_error : ". Being issued.") : ""],
        r.status === "approved" ? ["approve"] : ["approve", "refuse"], r);
    }, "No certificate request is waiting."));
    if (q.revocations) box.appendChild(section("a-rev", "Revocations", q.revocations, function (list, r) {
      row(list, r.action + " " + r.serial, [r.reason + (r.note ? ": " + r.note : "") + ". Asked on " + day(r.created_at) + ".", "Approved by " + (r.approved_by || []).join(", ") + ".", r.dispatch_error],
        r.status === "pending" ? ["second"] : [], r);
    }, "No revocation is waiting."));
    if (q.reports) box.appendChild(section("a-rep", "Reports", q.reports, function (list, r) {
      var l = r.listing || {};
      row(list, (l.name || l.id) + (r.version ? " " + r.version : ""), [l.id + ", " + r.reason + ", " + day(r.created_at) + ".", r.text],
        r.version ? ["resolve", "takedown", "flag", "withdraw"] : ["resolve", "takedown"], { id: r.id, listing: l.id, version: r.version });
    }, "No report is open."));
    return box;
  }

  /* ---- Look up a developer, an organisation or a listing ---- */
  function lookup() {
    var box = el("div", { class: "block" }), out = el("ul", { class: "adm-list" });
    var f = el("form", { class: "adm-find" });
    f.innerHTML = '<div class="field"><label for="lk">A GitHub login, or the id of a listing</label><input id="lk" type="text" autocomplete="off" spellcheck="false" required></div><button class="btn btn-solid" type="submit">Look up</button><p class="err" role="alert"></p>';
    f.onsubmit = function (e) {
      e.preventDefault();
      var v = $("#lk").value.trim(), err = $(".err", f); out.textContent = ""; err.textContent = "";
      if (v.indexOf(".") > 0) call("GET", "/api/listings/" + E(v)).then(function (l) {
        (l.releases || []).forEach(function (r) {
          row(out, l.name + " " + r.version, [l.id + ", " + (r.verdict || "") + ", " + day(r.first_seen) + "."], ["flag", "withdraw"], { listing: l.id, version: r.version });
        });
      }, function (x) { err.textContent = x.message; });
      else call("GET", "/api/certs/" + E(v)).then(function (j) {
        (j.certs || []).forEach(function (c) {
          var t = c.tier || "origin";
          row(out, j.login + ": " + tierName(t), [c.serial + ", issued " + day(c.issued_at) + (c.revoked_at ? ", revoked " + day(c.revoked_at) + " (" + (c.revoke_reason || "") + ")" : "") + "."],
            c.revoked_at ? [] : t === "trusted" ? ["downgrade", "revoke"] : ["revoke"], c);
        });
        if (!out.children.length) err.textContent = "No certificate for " + v + ".";
      }, function (x) { err.textContent = x.message; });
    };
    box.appendChild(f); box.appendChild(out);
    return box;
  }

  /* ---- Roles (owners only) ---- */
  function roles(box) {
    call("GET", "/api/admin/roles").then(function (j) {
      var list = el("ul", { class: "adm-list" });
      (j.roles || []).forEach(function (r) {
        row(list, r.login, [r.role + (r.seeded ? ", from the hub's settings" : ", given by " + r.granted_by + " on " + day(r.granted_at)) + (r.two_factor ? "." : ". Two-factor sign-in is off on GitHub, so the panel stays closed to them.")], r.seeded ? [] : ["roles"], r);
      });
      box.appendChild(list);
      var f = el("form", { class: "adm-find" });
      f.innerHTML = '<div class="field"><label for="rl">Give a role to a GitHub login</label><input id="rl" type="text" autocomplete="off" spellcheck="false" required></div><button class="btn btn-solid" type="submit">Choose the role</button>';
      var add = el("ul", { class: "adm-list" });
      f.onsubmit = function (e) { e.preventDefault(); add.textContent = ""; var l = $("#rl").value.trim(); row(add, l, [], ["roles"], { login: l }); $("button", add).click(); };
      box.appendChild(f); box.appendChild(add);
    }, function (x) { box.appendChild(el("p", { class: "err", text: x.message })); });
  }

  /* ---- Audit trail ---- */
  var detail = function (d) { return d == null ? '' : typeof d === 'string' ? d : Object.keys(d).map(function (k) { return k + ': ' + d[k]; }).join(', '); };
  function audit(box, before) {
    call("GET", "/api/admin/audit" + (before ? "?before=" + before : "")).then(function (j) {
      var es = j.entries || [], list = $("ol", box) || box.appendChild(el("ol", { class: "card adm-audit" }));
      es.forEach(function (e) {
        list.appendChild(el("li", {}, [el("span", { class: "dim", text: day(e.at) }), el("strong", { text: e.actor_login || String(e.actor || "") }),
          el("span", { text: e.action + " " + (e.target || "") }), el("span", { class: "dim", text: detail(e.detail) })]));
      });
      var more = $(".adm-more", box); if (more) more.remove();
      if (es.length) { more = el("button", { type: "button", class: "btn btn-quiet adm-more", text: "Older entries" }); more.onclick = function () { audit(box, es[es.length - 1].id); }; box.appendChild(more); }
      else if (!list.children.length) box.appendChild(el("p", { class: "dim", text: "The audit trail is empty." }));
    }, function (x) { box.appendChild(el("p", { class: "err", text: x.message })); });
  }

  /* TEMPORARY (debug only): script errors the pages reported, last 7 days. Remove with src/debug.js before the public launch. */
  function errors(box, before) {
    call("GET", "/api/admin/errors" + (before ? "?before=" + before : "")).then(function (j) {
      if (!before) box.appendChild(el("p", { class: "dim", text: j.enabled ? "Debug only. Script errors the pages reported in the last " + j.keep_days + " days." : "The error reports are off (HUB_DEBUG_ERRORS is not 1)." }));
      var list = $("ol", box) || box.appendChild(el("ol", { class: "card adm-audit" }));
      (j.errors || []).forEach(function (e) {
        list.appendChild(el("li", {}, [el("span", { class: "dim", text: new Date(e.at * 1000).toISOString().slice(0, 19).replace("T", " ") }), el("strong", { text: e.message }),
          el("span", { text: e.url + " (build " + e.build + (e.person ? ", " + e.person : "") + ")" }), el("span", { class: "dim", text: e.ua }), el("pre", { class: "dim", text: e.stack })]));
      });
      var more = $(".adm-more", box); if (more) more.remove();
      if (j.next) { more = el("button", { type: "button", class: "btn btn-quiet adm-more", text: "Older reports" }); more.onclick = function () { errors(box, j.next); }; box.appendChild(more); }
      else if (j.enabled && !list.children.length) box.appendChild(el("p", { class: "dim", text: "Nothing reported." }));
    }, function (x) { box.appendChild(el("p", { class: "err", text: x.message })); });
  }

  /* ---- The page ---- */
  var tabs = el("nav", { class: "seg seg-lg", "aria-label": "Admin" });
  var views = { queue: queue(), lookup: lookup(), roles: el("div", { class: "block" }), audit: el("div", { class: "block" }), errors: el("div", { class: "block" }) };
  var TABS = [["queue", "Queue"], ["lookup", "Look up"], ["roles", "Roles"], ["audit", "Audit trail"], ["errors", "Errors"]].filter(function (t) { return (t[0] !== "roles" || allowed("roles")) && (t[0] !== "errors" || allowed("errors")); });
  var open = function (k) {
    $$("a", tabs).forEach(function (a) { a.setAttribute("aria-current", String(a.dataset.v === k)); });
    Object.keys(views).forEach(function (v) { views[v].hidden = v !== k; });
    if (k === "audit" && !views.audit.dataset.got) { views.audit.dataset.got = "1"; audit(views.audit); }
    if (k === "errors" && !views.errors.dataset.got) { views.errors.dataset.got = "1"; errors(views.errors); }
    if (k === "roles" && !views.roles.dataset.got) { views.roles.dataset.got = "1"; roles(views.roles); }
  };
  TABS.forEach(function (t) {
    var a = el("a", { href: "#" + t[0], "data-v": t[0], text: t[1] });
    a.onclick = function (e) { e.preventDefault(); history.replaceState(null, "", "#" + t[0]); open(t[0]); };
    tabs.appendChild(a);
  });
  main.appendChild(el("header", { class: "wrap bar" }, [el("span", { class: "brand", text: "WolOS Hub admin" }), tabs, el("span", { class: "dim who", id: "adm-me" })]));
  main.appendChild(el("div", { class: "wrap" }, Object.keys(views).map(function (k) { return views[k]; })));
  var start = location.hash.slice(1);
  open(TABS.some(function (t) { return t[0] === start; }) ? start : "queue");
  H.me().then(function (m) { if (m) $("#adm-me").textContent = (m.name || m.login) + ", " + role; }, function () {});
})();
