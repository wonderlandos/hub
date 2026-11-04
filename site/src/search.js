/* WolOS Hub search: reads /search.json once and ranks by name, maker, words and category. Same card as the store. */
(function () {
  "use strict";
  var H = window.Hub, $ = H.$, el = H.el;
  var results = $("#results"); if (!results) return;
  var q = $("#q"), count = $("#count"), none = $("#none"), rows = null;
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
    li.appendChild(el("a", { class: "stretch", href: r.u }, [el("span", { class: "sr", text: r.n + ", " })]));
    li.appendChild(r.i ? el("img", { class: "icon", src: r.i, width: "52", height: "52", alt: "" })
      : el("span", { class: "tile t-" + (r.l || "system"), "aria-hidden": "true", text: r.n.charAt(0).toUpperCase() }));
    li.appendChild(el("div", { class: "item-body" }, [el("h3", { text: r.n }), el("p", { class: "dim", text: r.s }), el("p", { class: "meta" }, [
      el("span", { class: "badge badge-" + r.t }, [el("span", { class: "dot", "aria-hidden": "true" }), document.createTextNode(r.tl)]),
      el("span", { class: "dim", text: r.a + " · " + r.k }),
    ])]));
    return li;
  };
  var hint = count.textContent;
  var run = function () {
    var text = q.value.trim(), ws = words(text);
    results.textContent = ""; none.hidden = true;
    if (!ws.length) { count.textContent = hint; return; }
    var hits = rows.map(function (r) { return [score(r, ws), r]; }).filter(function (x) { return x[0] > 0; })
      .sort(function (a, b) { return b[0] - a[0] || a[1].n.localeCompare(b[1].n); });
    hits.forEach(function (x) { results.appendChild(card(x[1])); });
    count.textContent = hits.length ? hits.length + (hits.length === 1 ? " result" : " results") + " for “" + text + "”" : "“" + text + "”";
    none.hidden = hits.length > 0;
  };
  fetch("/search.json").then(function (r) { return r.json(); }).then(function (j) {
    rows = j;
    q.value = new URLSearchParams(location.search).get("q") || "";
    run();
    q.addEventListener("input", function () {
      run();
      var u = new URL(location.href); if (q.value.trim()) u.searchParams.set("q", q.value.trim()); else u.searchParams.delete("q");
      history.replaceState(null, "", u);
    });
  }, function () { count.textContent = "The hub can't be reached. Check your connection and try again."; });
})();
