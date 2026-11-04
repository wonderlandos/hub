/* TEMPORARY, debug only. Reports a page's script errors to the Worker (POST /api/debug/errors) so the people who build the hub
   can see what broke. It sends the message, stack, page address without query, and the build (the hash in hub.js's name); no
   cookie is set and nothing else is read. The Worker decides whether it is on (HUB_DEBUG_ERRORS=1): on its first 404 this
   tab stops asking. Three reports per page at most, none twice. Remove this file and its line in scripts/build.mjs and
   scripts/lib/render.mjs before the public launch. */
(function () {
  "use strict";
  var KEY = "hub-debug-off", sent = 0, seen = {};
  if (document.querySelector('meta[name="hub-api"][content="off"]')) return;
  try { if (sessionStorage.getItem(KEY)) return; } catch (e) {}
  function send(kind, message, stack) {
    message = String(message || "").slice(0, 500);
    if (sent >= 3 || seen[message]) return;
    seen[message] = 1; sent++;
    var s = document.querySelector('script[src*="/assets/hub."]');
    var build = s ? (/hub\.([0-9a-f]+)\.js/.exec(s.getAttribute("src")) || [])[1] || "" : "";
    try {
      fetch("/api/debug/errors", {
        method: "POST", keepalive: true, headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: kind, message: message, stack: String(stack || "").slice(0, 3000), url: location.origin + location.pathname, build: build })
      }).then(function (r) { if (r.status === 404) try { sessionStorage.setItem(KEY, "1"); } catch (e) {} }, function () {});
    } catch (e) {}
  }
  window.addEventListener("error", function (e) { if (e.message) send("error", e.message, e.error && e.error.stack); });
  window.addEventListener("unhandledrejection", function (e) { var r = e.reason; send("rejection", r && r.message ? r.message : r, r && r.stack); });
})();
