/* WolOS Hub picture viewer, on listing pages with pictures: Enter or a click opens one, the arrow keys move,
   Esc closes and gives the focus back. The same viewer as wolos.org. */
(function () {
  "use strict";
  var H = window.Hub, $ = H.$, $$ = H.$$, el = H.el;
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

})();
