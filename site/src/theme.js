/* Before first paint: the visitor's colour choice (the same key the WolOS site uses), a flag that scripts run, and a hint that
   this browser was signed in on the last page, or just went to GitHub to sign in (data-who="in"), so the header and the dashboard never flash "Sign in" while the
   session is asked for. hub.js keeps the hint true or removes it. */
try { var t = localStorage.getItem("theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch (e) {}
document.documentElement.classList.add("js");
try { var s = localStorage.getItem("hub-signing"); if (localStorage.getItem("hub-who") || (s && Date.now() - Number(s) < 6e5)) document.documentElement.dataset.who = "in"; } catch (e) {}
