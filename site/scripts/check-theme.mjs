// SPDX-License-Identifier: GPL-2.0-or-later
// Light and dark, from the tokens only. In src/hub.css, src/hub.js and every built page:
//   - no colour literal (#hex, rgb(), hsl(), a named colour): only var(--wol-*), var(--term-*) and color-mix of them;
//   - every font-size is one of the seven steps var(--text-*);
//   - the tokens file is the site's (tokens.css names both schemes and the type scale);
//   - the pairs people read (text, secondary text, links, buttons, badges) keep their contrast in both schemes:
//     4.5 for text, 3 for the accent as a line or a fill;
//   - every page sets the look before first paint and offers Auto, Light and Dark.
import { readFileSync } from "node:fs";
import { at } from "./lib/paths.mjs";
import { builtPages } from "./lib/visible.mjs";

const read = (p) => readFileSync(p, "utf8");
const bad = [];
const css = read(at("src/hub.css")), tokens = read(at("src/tokens.css"));
const js = ["hub", "search", "account", "publish", "dashboard", "status", "admin"].map((n) => read(at(`src/${n}.js`))).join("\n");

const strip = (c) => c.replace(/\/\*[\s\S]*?\*\//g, "");
const LIT = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(|(?<![-\w])(?:white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|teal|navy)(?![-\w])/g;
const LIT_JS = /["']#[0-9a-fA-F]{3,8}["']|\b(?:rgba?|hsla?)\(/g;
for (const [name, text, re] of [["src/hub.css", strip(css), LIT], ["src/*.js", js.replace(/\/\*[\s\S]*?\*\//g, ""), LIT_JS]]) {
  for (const m of text.matchAll(re)) bad.push(`${name}: colour literal "${m[0]}" near "${text.slice(Math.max(0, m.index - 30), m.index + 20).replace(/\s+/g, " ")}"`);
}
for (const m of strip(css).matchAll(/font-size:\s*([^;}]+)/g)) if (!/^var\(--text-(?:xs|sm|base|lg|xl|2xl|3xl)\)$|^inherit$/.test(m[1].trim()) && !/^\.\d+em$/.test(m[1].trim())) bad.push(`src/hub.css: font-size "${m[1].trim()}" is not a step of the scale`);
for (const m of strip(css).matchAll(/var\((--[\w-]+)/g)) if (!new RegExp(`${m[1]}\\s*:`).test(tokens) && !/^--(?:wol|term|text|font|color)-/.test(m[1])) bad.push(`src/hub.css: ${m[1]} is not a token`);
for (const m of strip(css).matchAll(/var\((--[\w-]+)/g)) if (!new RegExp(`${m[1]}\\s*:`).test(tokens)) bad.push(`src/hub.css: ${m[1]} is not defined in tokens.css`);
for (const need of ["--wol-bg", "--wol-accent", "--text-3xl", "[data-theme=\"dark\"]", ":root[data-theme=\"light\"]", "prefers-color-scheme: dark"]) if (!tokens.includes(need)) bad.push(`src/tokens.css lacks ${need}`);

// Contrast, computed from the tokens in each scheme.
const block = (re) => { const m = re.exec(tokens); if (!m) return {}; let d = 0, i = tokens.indexOf("{", m.index), s = i; for (; i < tokens.length; i++) { if (tokens[i] === "{") d++; else if (tokens[i] === "}" && --d === 0) break; } return Object.fromEntries([...tokens.slice(s, i).matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()])); };
const light = { ...block(/^:root \{\n\s*--wol-bg/m) }, dark = { ...light, ...block(/^\[data-theme="dark"\]/m) };
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const PAIRS = [["--wol-text", "--wol-bg", 4.5], ["--wol-text", "--wol-surface", 4.5], ["--wol-text-2", "--wol-bg", 4.5], ["--wol-text-2", "--wol-surface", 4.5], ["--wol-text-2", "--wol-surface-2", 4.5], ["--wol-text", "--wol-surface-2", 4.5], ["--wol-bg", "--wol-text", 4.5], ["--wol-accent-fg", "--wol-accent", 3], ["--wol-accent", "--wol-bg", 3], ["--wol-red", "--wol-surface", 3], ["--wol-icon-paper", "--wol-icon-wolos-body", 3], ["--wol-icon-paper", "--wol-icon-system-body", 4.5], ["--wol-icon-paper", "--wol-icon-dev-body", 4.5], ["--wol-icon-paper", "--wol-icon-files-body", 3], ["--wol-icon-paper", "--wol-icon-web-body", 4.5], ["--wol-icon-paper", "--wol-icon-talk-body", 3]];
const worst = {};
for (const [scheme, t] of [["light", light], ["dark", dark]]) for (const [fg, bg, min] of PAIRS) {
  if (!/^#/.test(t[fg] || "") || !/^#/.test(t[bg] || "")) { bad.push(`${scheme}: ${fg} or ${bg} is not a plain colour in tokens.css`); continue; }
  const r = ratio(t[fg], t[bg]); worst[scheme] = Math.min(worst[scheme] ?? 99, r / min);
  if (r < min) bad.push(`${scheme}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${min}`);
}

// Pages.
const pages = builtPages(at("dist"));
for (const r of pages) {
  const html = read(r === "/404" ? at("dist/404.html") : at("dist" + (r === "/" ? "" : r), "index.html"));
  const head = html.slice(0, html.indexOf("</head>"));
  if (!/<script src="\/assets\/theme\.[0-9a-f]+\.js">/.test(head) || head.indexOf("theme.") > head.indexOf('rel="stylesheet"')) bad.push(`${r}: the look is not set before the stylesheet`);
  if (!/<meta name="color-scheme" content="light dark">/.test(head)) bad.push(`${r}: no color-scheme meta`);
  // The closed admin shell has no words of its own; it follows the look chosen on the hub.
  if (r !== "/admin") for (const k of ["auto", "light", "dark"]) if (!html.includes(`data-theme="${k}"`)) bad.push(`${r}: no ${k} button`);
  if (/<html\b[^>]*\sdata-theme=/.test(html)) bad.push(`${r}: data-theme is set in the static HTML`);
  for (const m of html.matchAll(/\sstyle="([^"]*)"/g)) if (!/^max-width:\d+px$/.test(m[1])) bad.push(`${r}: inline style "${m[1]}" (only a picture's max-width is allowed)`);
}
if (bad.length) { console.error(`check-theme: ${bad.length} problem(s)\n  ${bad.join("\n  ")}`); process.exit(1); }
console.log(`check-theme: ${pages.length} pages; no colour literal, every font size a step of the scale; light and dark pairs hold (tightest margin ${((Math.min(...Object.values(worst)) - 1) * 100).toFixed(0)}% over the minimum); the look is set before first paint`);
