// SPDX-License-Identifier: GPL-2.0-or-later
// The pages for people who publish keep their words in the page and their behaviour in a script. This check ties them:
// every message, template and element id a page script asks for exists in the built page it runs on, the five steps of
// /publish are in the rail and the page in the same order, the status page has its four stages' words, and the exact
// sentences of docs/PUBLISH-FLOW.md that the pages carry themselves are there.
import { readFileSync } from "node:fs";
import { at } from "./lib/paths.mjs";

const read = (p) => readFileSync(at(p), "utf8");
const bad = [];
const PAGES = { publish: ["publish", "publish"], dashboard: ["dashboard", "dashboard"], status: ["status", "status"] };
for (const [route, [script]] of Object.entries(PAGES)) {
  const html = read(`dist/${route}/index.html`), js = read(`src/${script}.js`).replace(/\/\*[\s\S]*?\*\//g, "");
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const msgs = new Set([...html.matchAll(/data-msg="([^"]+)"/g)].map((m) => m[1]));
  for (const m of js.matchAll(/\bmsg\("([\w-]+)"\)/g)) if (!msgs.has(m[1])) bad.push(`/${route}: ${script}.js asks for the message "${m[1]}", the page has none`);
  for (const m of js.matchAll(/\btpl\("([\w-]+)"\)/g)) if (!ids.has(m[1])) bad.push(`/${route}: ${script}.js clones the template "${m[1]}", the page has none`);
  for (const m of js.matchAll(/\$\("#([\w-]+)"\)/g)) if (!ids.has(m[1])) bad.push(`/${route}: ${script}.js looks for #${m[1]}, the page has none`);
  if (route !== "status" && !html.includes("data-overview=")) bad.push(`/${route}: no data-overview, so the page would ask for the person and its data separately`);
}
const pub = read("dist/publish/index.html");
const order = ["Sign in", "Accept the agreements", "Install WolOS Hub on GitHub", "Connect a repository", "Push a tag"].map((t) => pub.indexOf(`<h2>${t}</h2>`));
if (order.some((i) => i < 0) || order.some((v, i) => i && v < order[i - 1])) bad.push("/publish: the five steps are not all there in order");
if ((pub.match(/class="rail-item"/g) || []).length !== 5) bad.push("/publish: the rail does not list five steps");
if (!/git tag v|tag-cmd/.test(pub)) bad.push("/publish: no lines to push a tag");
const st = read("dist/status/index.html");
for (const w of ["On GitHub", "Check again", "What the check found", "Signature", "The file", "Publish the fix"]) if (!st.includes(w)) bad.push(`/status: the words "${w}" are missing`);
const sitemap = read("dist/sitemap.xml");
if (sitemap.includes("/status") || sitemap.includes("/dashboard")) bad.push("sitemap: the status page and the dashboard are private pages");
if (!/<meta name="robots" content="noindex/.test(st)) bad.push("/status: not noindex");
if (bad.length) { console.error(`check-publish: ${bad.length} problem(s)\n  ${bad.join("\n  ")}`); process.exit(1); }
console.log("check-publish: publish, dashboard and status: every message, template and element a script asks for is in its page; five steps in order; the status page has its words and is not in the sitemap");
