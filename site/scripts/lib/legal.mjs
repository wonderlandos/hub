// SPDX-License-Identifier: GPL-2.0-or-later
// The agreements and policies as pages: /terms/<doc> from legal/<doc>.md at the top of the hub repository
// (LEGAL_DIR overrides). A file starts with front matter (version, effective as YYYY-MM-DD, title); the body is
// plain Markdown: headings, paragraphs, lists, quotes, bold, italic, code and https links. No HTML passes
// through: everything is escaped. A missing file gives a page that says the text is being written.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { at } from "./paths.mjs";
import { esc } from "./html.mjs";

export const DOCS = [
  ["cla", "Contributor Agreement", "What you agree to when you publish your work on WolOS Hub."],
  ["usage", "Terms of Use", "The rules for using WolOS Hub."],
  ["privacy", "Privacy Policy", "What WolOS Hub keeps about you, why, and for how long."],
  ["publisher", "Publisher Agreement", "What you promise about the files you publish, and what the hub does when one is reported."],
  ["trust", "Trust Terms", "What a certificate from WolOS Hub promises, and when it is revoked."],
];

const inline = (t) => esc(t)
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
  .replace(/\[([^\]]+)\]\((https:\/\/[^)\s"]+|\/[^)\s"]*)\)/g, '<a href="$2">$1</a>');

export function markdown(md) {
  const out = [], lines = md.replace(/\r\n?/g, "\n").split("\n");
  let para = [], list = null;
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; }
    if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; }
  };
  for (const raw of lines) {
    const l = raw.trim();
    let m;
    if (!l) { flush(); continue; }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { flush(); const n = Math.min(4, m[1].length + 1); out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
    if ((m = /^[-*]\s+(.*)$/.exec(l)) || (m = /^\d+[.)]\s+(.*)$/.exec(l))) {
      const tag = /^\d/.test(l) ? "ol" : "ul";
      if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; }
      if (list && list.tag !== tag) flush();
      list ||= { tag, items: [] }; list.items.push(m[1]); continue;
    }
    if ((m = /^>\s?(.*)$/.exec(l))) { flush(); out.push(`<blockquote><p>${inline(m[1])}</p></blockquote>`); continue; }
    if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1] += " " + l; continue; }
    if (list) flush();
    para.push(l);
  }
  flush();
  return out.join("\n");
}

/** {doc, title, blurb, found, version, effective, html, text} for each document. */
export function legalDocs() {
  const dir = process.env.LEGAL_DIR || at("../legal");
  return DOCS.map(([doc, title, blurb]) => {
    const f = resolve(dir, `${doc}.md`);
    if (!existsSync(f)) return { doc, title, blurb, found: false };
    const text = readFileSync(f, "utf8").replace(/^﻿/, "");
    const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text.replace(/\r\n?/g, "\n"));
    const meta = Object.fromEntries((fm ? fm[1] : "").split("\n").map((l) => /^(\w+):\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
    let body = fm ? text.replace(/\r\n?/g, "\n").slice(fm[0].length) : text;
    const t = meta.title || title, h1 = /^\s*#\s+(.*)\n/.exec(body);
    if (h1 && h1[1].trim().toLowerCase() === t.toLowerCase()) body = body.slice(h1[0].length); // the page shows the title already
    return { doc, title: meta.title || title, blurb, found: true, version: meta.version || "", effective: meta.effective || "", html: markdown(body), text };
  });
}
