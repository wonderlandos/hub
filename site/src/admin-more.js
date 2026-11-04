/* WolOS Hub admin panel, the second script: the audit trail with filters and an export, people (search, ban, sessions),
   listings (search, take down, restore), health, and the debug-only error reports. admin.js loads this when one of these
   tabs opens and hands over its helpers (window.Hub.adm). Every action goes through the same reason box and lands in
   the audit trail. */
(function () {
  "use strict";
  var H = window.Hub, A = H.adm, $ = H.$, el = H.el, call = H.call, E = A.E, day = A.day, row = A.row;
  var time = H.time;
  var ACT = A.ACTIONS;
  ACT.ban = ["Ban", "Ban this account?", "The account may not use the hub. Every sign-in of theirs ends now and they cannot sign in again until unbanned.", function (x) { return "/api/admin/users/" + x.github_id + "/ban"; }, function (t) { return { reason: t }; }];
  ACT.unban = ["Unban", "Let this account back?", "They can sign in again. Their listings stay as they are.", function (x) { return "/api/admin/users/" + x.github_id + "/unban"; }, function (t) { return { reason: t }; }];
  ACT.sessions = ["End their sessions", "End every sign-in of this person?", "Each browser they signed in from is signed out now. They can sign in again.", function (x) { return "/api/admin/users/" + x.github_id + "/sessions/revoke"; }, function (t) { return { reason: t }; }];
  ACT.ltakedown = ["Take down", "Take this listing down?", "The listing leaves the next signed index and its page, without a report.", function (x) { return "/api/admin/listings/" + E(x.id) + "/takedown"; }, function (t) { return { reason: t }; }];
  ACT.lrestore = ["Restore", "Bring this listing back?", "It is listed again when a version passed the check, else it comes back as a draft.", function (x) { return "/api/admin/listings/" + E(x.id) + "/restore"; }, function (t) { return { reason: t }; }];

  var field = function (id, label, type, extra) {
    var i = el("input", Object.assign({ id: id, type: type || "text", autocomplete: "off", spellcheck: "false" }, extra || {}));
    return el("div", { class: "field" }, [el("label", { for: id, text: label }), i]);
  };
  var form = function (cls, fields, button) {
    var f = el("form", { class: cls, novalidate: "" });
    fields.forEach(function (x) { f.appendChild(x); });
    f.appendChild(el("button", { class: "btn btn-solid", type: "submit", text: button }));
    f.appendChild(el("p", { class: "err", role: "alert" }));
    return f;
  };
  var fail = function (f, e) { $(".err", f).textContent = e.message; };
  var skel = function (box) { box.setAttribute("data-pending", ""); };
  var ready = function (box) { box.removeAttribute("data-pending"); var k = $(".skel", box); if (k) k.remove(); };
  var small = function (d) { return d == null ? "" : typeof d === "string" ? d : Object.keys(d).map(function (k) { return k + ": " + (typeof d[k] === "object" ? "(" + small(d[k]) + ")" : d[k]); }).join(", "); };

  /* ---- Audit trail: filters (who, what, on what, when), pages, and the export as one file ---- */
  function audit(box) {
    var f = form("adm-find adm-filters", [field("au-actor", "Who (login or id)"), field("au-action", "What (the start of an action, like cert. or sign-in)"),
      field("au-target", "On what (person:1, listing:alice.notes, or listing: for all)"), field("au-since", "From", "date"), field("au-until", "To", "date")], "Show");
    var list = el("ol", { class: "card adm-audit" }), more = el("button", { type: "button", class: "btn btn-quiet adm-more", text: "Older entries", hidden: "" });
    var exp = el("a", { class: "btn btn-quiet", href: "/api/admin/audit/export", text: "Export as a file", download: "" });
    var none = el("p", { class: "dim", text: "No entry matches.", hidden: "" });
    var query = function () {
      var p = new URLSearchParams();
      var v = function (id) { return $("#" + id, f).value.trim(); };
      if (v("au-actor")) p.set("actor", v("au-actor"));
      if (v("au-action")) p.set("action", v("au-action"));
      if (v("au-target")) p.set("target", v("au-target"));
      if (v("au-since")) p.set("since", String(Date.parse(v("au-since") + "T00:00:00Z") / 1000));
      if (v("au-until")) p.set("until", String(Date.parse(v("au-until") + "T23:59:59Z") / 1000));
      return p;
    };
    var page = function (before) {
      var p = query(); if (before) p.set("before", before);
      if (!before) { list.textContent = ""; none.hidden = true; }
      more.hidden = true;
      call("GET", "/api/admin/audit?" + p).then(function (j) {
        ready(box);
        (j.entries || []).forEach(function (e) {
          var li = el("li", {}, [el("span", { class: "dim", text: time(e.at) }), el("strong", { text: e.actor_login || e.actor_kind + " " + (e.actor_id || "") }),
            el("span", { text: e.action + " " + (e.target || "") }), el("span", { class: "dim", text: small(e.detail) })]);
          var where = [e.ip_prefix, e.colo, e.session ? "session " + e.session : "", e.result && e.result !== "ok" ? e.result : ""].filter(Boolean).join(", ");
          if (where) li.appendChild(el("span", { class: "dim small", text: where }));
          if (e.before || e.after) li.appendChild(el("span", { class: "dim small", text: "before " + small(e.before) + " / after " + small(e.after) }));
          list.appendChild(li);
        });
        none.hidden = !!list.children.length;
        if (j.next) { more.hidden = false; more.onclick = function () { page(j.next); }; }
      }, function (e) { ready(box); fail(f, e); });
    };
    f.onsubmit = function (e) { e.preventDefault(); exp.href = "/api/admin/audit/export?" + query(); page(); };
    box.appendChild(f); box.appendChild(el("p", { class: "get-btns" }, [exp])); box.appendChild(list); box.appendChild(none); box.appendChild(more);
    page();
  }

  /* ---- People: search, then the person with their sessions, listings and last actions; ban, unban, end sessions ---- */
  function users(box) {
    ready(box);
    var f = form("adm-find", [field("us-q", "A login or a name (two characters or more)", "text", { required: "" })], "Search");
    var out = el("div", { class: "adm-list" });
    var banned = el("button", { type: "button", class: "btn btn-quiet", text: "Banned accounts" });
    var person = function (u) {
      skel(out); out.textContent = "";
      call("GET", "/api/admin/users/" + u.github_id).then(function (j) {
        ready(out);
        var p = j.user, lines = [
          "GitHub id " + p.github_id + (p.role ? ", " + p.role + " of the panel" : "") + (p.two_factor ? "" : ", no two-factor sign-in on GitHub") + ". First seen " + day(p.first_seen) + ", last " + day(p.last_seen) + ".",
          p.banned ? "Banned on " + day(p.banned_at) + (j.ban_reason ? ": " + j.ban_reason : "") : "",
          p.sessions + " signed-in browser" + (p.sessions === 1 ? "" : "s") + ", " + j.listings.length + " listing" + (j.listings.length === 1 ? "" : "s") + ".",
        ];
        var li = row(out, (p.name ? p.name + " (" + p.login + ")" : p.login), lines, [p.banned ? "unban" : "ban", "sessions"], p);
        var ses = el("ul", { class: "card adm-audit" });
        j.sessions.forEach(function (s) {
          ses.appendChild(el("li", {}, [el("strong", { text: s.browser }), el("span", { text: s.place + (s.colo ? ", " + s.colo : "") }),
            el("span", { class: "dim", text: "signed in " + time(s.signed_in_at) + ", last used " + time(s.last_seen) + (s.account ? ", as " + s.account : "") + (s.admin ? ", used the panel" : "") }),
            el("span", { class: s.moved ? "err" : "dim", text: s.moved ? "Moved to " + s.moved_to : "" })]));
        });
        if (j.sessions.length) out.appendChild(el("section", { class: "block" }, [el("h3", { text: "Signed-in browsers" }), ses]));
        if (j.listings.length) {
          var ls = el("ul", { class: "card adm-audit" });
          j.listings.forEach(function (l) { ls.appendChild(el("li", {}, [el("strong", { text: l.name }), el("span", { text: l.id + ", " + l.kind + ", " + l.status }), el("span", { class: "dim", text: l.repo })])); });
          out.appendChild(el("section", { class: "block" }, [el("h3", { text: "Listings" }), ls]));
        }
        if (j.actions.length) {
          var as = el("ol", { class: "card adm-audit" });
          j.actions.forEach(function (a) { as.appendChild(el("li", {}, [el("span", { class: "dim", text: time(a.at) }), el("span", { text: a.action + " " + (a.target || "") })])); });
          out.appendChild(el("section", { class: "block" }, [el("h3", { text: "Last actions" }), as]));
        }
      }, function (e) { ready(out); fail(f, e); });
    };
    var found = function (j) {
      out.textContent = "";
      (j.users || []).forEach(function (u) {
        var b = el("button", { type: "button", class: "btn btn-quiet", text: "Open" });
        var li = el("li", { class: "card adm-row" }, [el("h3", { text: (u.name ? u.name + " (" + u.login + ")" : u.login) }),
          el("p", { class: "dim", text: (u.role ? u.role + ". " : "") + (u.banned ? "Banned. " : "") + u.sessions + " signed in, " + u.listings + " listings, last seen " + day(u.last_seen) + "." }), el("p", { class: "get-btns" }, [b])]);
        b.onclick = function () { person(u); };
        out.appendChild(li);
      });
      if (!j.users || !j.users.length) out.appendChild(el("p", { class: "dim", text: "Nobody matches." }));
    };
    f.onsubmit = function (e) { e.preventDefault(); $(".err", f).textContent = ""; call("GET", "/api/admin/users?q=" + E($("#us-q", f).value.trim())).then(found, function (x) { fail(f, x); }); };
    banned.onclick = function () { call("GET", "/api/admin/users?banned=1").then(found, function (x) { fail(f, x); }); };
    box.appendChild(f); box.appendChild(el("p", { class: "get-btns" }, [banned])); box.appendChild(out);
  }

  /* ---- Listings: search by id, name or repository, or by state; take down and restore ---- */
  function listings(box) {
    ready(box);
    var sel = el("select", { id: "ls-state" });
    [["", "Any state"], ["draft", "Draft"], ["checking", "Checking"], ["listed", "Listed"], ["withdrawn", "Withdrawn"]].forEach(function (o) { sel.appendChild(el("option", { value: o[0], text: o[1] })); });
    var f = form("adm-find", [field("ls-q", "Part of an id, a name or a repository"), el("div", { class: "field" }, [el("label", { for: "ls-state", text: "State" }), sel])], "Search");
    var out = el("ul", { class: "adm-list" });
    f.onsubmit = function (e) {
      e.preventDefault(); $(".err", f).textContent = ""; out.textContent = "";
      call("GET", "/api/admin/listings?q=" + E($("#ls-q", f).value.trim()) + "&state=" + E(sel.value)).then(function (j) {
        (j.listings || []).forEach(function (l) {
          row(out, l.name + " (" + l.id + ")", [l.kind + " by " + (l.owner || "") + ", " + l.status + ", " + l.repo + ". " + l.versions + " version" + (l.versions === 1 ? "" : "s") + (l.flags ? ", " + l.flags + " flagged" : "") + (l.open_reports ? ", " + l.open_reports + " open report" + (l.open_reports === 1 ? "" : "s") : "") + ".",
            l.takedown_at ? "Taken down " + day(l.takedown_at) + (l.takedown_note ? ": " + l.takedown_note : "") : ""],
            l.status === "withdrawn" ? ["lrestore"] : ["ltakedown"], l);
        });
        if (!j.listings || !j.listings.length) out.appendChild(el("p", { class: "dim", text: "No listing matches." }));
      }, function (x) { fail(f, x); });
    };
    box.appendChild(f); box.appendChild(out);
  }

  /* ---- Health: sessions, limits hit, error reports, release notices, the trail's last day ---- */
  function health(box) {
    call("GET", "/api/admin/health").then(function (h) {
      ready(box);
      var card = function (title, lines) {
        var s = el("section", { class: "card adm-row" }, [el("h3", { text: title })]);
        lines.forEach(function (l) { s.appendChild(el("p", { class: "dim", text: l })); });
        return s;
      };
      var g = el("div", { class: "adm-list" });
      g.appendChild(card("Signed-in sessions", [h.sessions.n + " in all, " + (h.sessions.admin || 0) + " used the panel, " + (h.sessions.moved || 0) + " moved network and browser (" + h.sessions.moved_7d + " such events in 7 days)."]));
      g.appendChild(card("Rate limits, last 24 hours", h.rate_limits.length ? h.rate_limits.map(function (r) { return r.rule + ": " + r.hits + " requests over " + r.keys + " keys"; }) : ["Nothing counted."]));
      g.appendChild(card("Error reports, last 7 days", [h.errors_on ? h.errors_7d + " reports (see the Errors tab)." : "Error reports are off."]));
      g.appendChild(card("Release notices from GitHub, last 100", h.webhooks.length ? h.webhooks.slice(0, 20).map(function (w) { return time(w.seen_at) + " " + w.event + " " + w.id; }).concat(h.webhooks.length > 20 ? ["and " + (h.webhooks.length - 20) + " more"] : []) : ["None yet."]));
      g.appendChild(card("Tags taken in, last 50", h.intake.length ? h.intake.slice(0, 20).map(function (i) { return time(i.at) + " " + i.listing_id + " " + i.tag + ": " + i.state; }) : ["None yet."]));
      g.appendChild(card("Audit trail, last 24 hours", h.audit_24h.length ? h.audit_24h.map(function (a) { return a.action + ": " + a.n + (a.not_ok ? " (" + a.not_ok + " not ok)" : ""); }) : ["Nothing happened."]));
      box.appendChild(g);
    }, function (e) { ready(box); box.appendChild(el("p", { class: "err", text: e.message })); });
  }

  /* TEMPORARY (debug only): script errors the pages reported, last 7 days. Remove with src/debug.js before the public launch. */
  function errors(box, before) {
    call("GET", "/api/admin/errors" + (before ? "?before=" + before : "")).then(function (j) {
      ready(box);
      if (!before) box.appendChild(el("p", { class: "dim", text: j.enabled ? "Debug only. Script errors the pages reported in the last " + j.keep_days + " days." : "The error reports are off (HUB_DEBUG_ERRORS is not 1)." }));
      var list = $("ol", box) || box.appendChild(el("ol", { class: "card adm-audit" }));
      (j.errors || []).forEach(function (e) {
        list.appendChild(el("li", {}, [el("span", { class: "dim", text: time(e.at) }), el("strong", { text: e.message }),
          el("span", { text: e.url + " (build " + e.build + (e.person ? ", " + e.person : "") + ")" }), el("span", { class: "dim", text: e.ua }), el("pre", { class: "dim", text: e.stack })]));
      });
      var more = $(".adm-more", box); if (more) more.remove();
      if (j.next) { more = el("button", { type: "button", class: "btn btn-quiet adm-more", text: "Older reports" }); more.onclick = function () { errors(box, j.next); }; box.appendChild(more); }
      else if (j.enabled && !list.children.length) box.appendChild(el("p", { class: "dim", text: "Nothing reported." }));
    }, function (x) { ready(box); box.appendChild(el("p", { class: "err", text: x.message })); });
  }

  A.ready({ audit: audit, users: users, listings: listings, health: health, errors: errors });
})();
