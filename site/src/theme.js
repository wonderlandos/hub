/* Before first paint: the visitor's colour choice (the same key the WolOS site uses) and a flag that scripts run. */
try { var t = localStorage.getItem("theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch (e) {}
document.documentElement.classList.add("js");
