// SPDX-License-Identifier: GPL-2.0-or-later
// The agreements and policies as pages: /terms/<slug> from legal/<FILE>.md at the top of the hub repository
// (LEGAL_DIR overrides). The route map, titles and SHA-256 come from the version table in legal/README.md;
// DOCS below is the same map for a folder without that file (check-legal.mjs keeps the two equal).
// A text starts with front matter (title, version, effective), then "# Title", then the line
// "Version N, effective DATE.", then the "In short" box (a > quote, not binding), then numbered sections.
// The body is plain Markdown: headings, paragraphs, lists, quotes, bold, italic, code and links to https or
// to the hub. No HTML passes through: everything is escaped. A missing file gives a page that says the text
// is being written.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { at } from "./paths.mjs";
import { esc } from "./html.mjs";

/** [slug, file, title], in the order of the README table. */
export const DOCS = [
  ["cla", "CLA.md", "Contributor Licence Agreement"],
  ["usage", "TERMS-OF-USE.md", "Terms of Use"],
  ["privacy", "PRIVACY.md", "Privacy Policy"],
  ["cookies", "COOKIES.md", "Cookie Notice"],
  ["publisher", "PUBLISHER-AGREEMENT.md", "Publisher Agreement"],
  ["trust", "TRUST-TERMS.md", "Trust Terms"],
  ["certificates", "CERTIFICATE-TERMS.md", "Certificate Terms"],
  ["policies", "HUB-POLICIES.md", "Hub Policies"],
  ["notices", "DMCA-AND-NOTICES.md", "Notices and Takedown"],
  ["disclosure", "SECURITY-POLICY.md", "Disclosure Policy"],
  ["trademark", "TRADEMARK.md", "Trade Mark Policy"],
  ["changes", "CHANGES-LOG.md", "Changes Log"],
];
/** Files in legal/ that are not served. */
export const NOT_SERVED = ["README.md", "RESEARCH.md"];

export const legalDir = () => process.env.LEGAL_DIR || at("../legal");
export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** The README version table: [{file, slug, title, version, effective, sha256, binds}], or null without a README. */
export function readmeTable(dir = legalDir()) {
  const f = resolve(dir, "README.md");
  if (!existsSync(f)) return null;
  const rows = [];
  for (const l of readFileSync(f, "utf8").replace(/\r\n?/g, "\n").split("\n")) {
    const c = l.split("|").slice(1, -1).map((x) => x.trim());
    if (c.length < 8 || !/^`[^`]+\.md`$/.test(c[0])) continue;
    const route = /^\/terms\/([a-z0-9-]+)$/.exec(c[1]);
    rows.push({ file: c[0].slice(1, -1), route: c[1], slug: route ? route[1] : null, title: c[2], version: c[3], effective: c[4], sha256: c[6].replace(/`/g, ""), binds: c[7] });
  }
  return rows;
}

const inline = (t) => esc(t)
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
  .replace(/\[([^\]]+)\]\((https:\/\/[^)\s"]+|\/[^)\s"]*)\)/g, '<a href="$2">$1</a>');
/** Plain words of a line (for headings in the side list and the In short box). */
export const plain = (t) => t.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
export const headingId = (t) => { const n = /^(\d+)\.\s/.exec(t); return n ? `s${n[1]}` : "s-" + plain(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); };

/** HTML of a Markdown body and its ## headings ({id, text}) for the side list. */
export function markdown(md) {
  const out = [], toc = [], lines = md.replace(/\r\n?/g, "\n").split("\n");
  let para = [], list = null, quote = null;
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; }
    if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; }
    if (quote) { out.push(`<blockquote>${quote.map((q) => `<p>${inline(q)}</p>`).join("")}</blockquote>`); quote = null; }
  };
  for (const raw of lines) {
    const l = raw.trim();
    let m;
    if (!l) { flush(); continue; }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) {
      flush();
      const n = Math.min(4, Math.max(2, m[1].length)), id = headingId(m[2]);
      if (n === 2) toc.push({ id, text: plain(m[2]) });
      out.push(`<h${n} id="${id}">${inline(m[2])}</h${n}>`); continue;
    }
    if ((m = /^>\s?(.*)$/.exec(l))) { if (!quote) flush(); quote ||= []; if (m[1]) quote.push(m[1]); continue; }
    if (quote) flush();
    if ((m = /^[-*]\s+(.*)$/.exec(l)) || (m = /^\d+[.)]\s+(.*)$/.exec(l))) {
      const tag = /^\d/.test(l) ? "ol" : "ul";
      if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; }
      if (list && list.tag !== tag) flush();
      list ||= { tag, items: [] }; list.items.push(m[1]); continue;
    }
    if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1] += " " + l; continue; }
    if (list) flush();
    para.push(l);
  }
  flush();
  return { html: out.join("\n"), toc };
}

/** One text, split into its parts. */
export function parse(text) {
  const t = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(t);
  const meta = Object.fromEntries((fm ? fm[1] : "").split("\n").map((l) => /^(\w+):\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
  let body = fm ? t.slice(fm[0].length) : t;
  const h1 = /^\s*#\s+(.*)\n/.exec(body);
  if (h1) body = body.slice(h1[0].length);
  const vl = /^\s*(Version\s+\S+,\s+effective\s+[^\n]*?\.?)\s*\n/.exec(body);
  if (vl) body = body.slice(vl[0].length);
  // The In short box: the first quote, when its first line says "In short".
  let short = null;
  const q = /^\s*((?:>[^\n]*\n?)+)/.exec(body);
  if (q && /^>\s*\*\*In short\b/i.test(q[1])) {
    const ql = q[1].split("\n").map((l) => l.replace(/^>\s?/, "").trim()).filter(Boolean);
    const head = /^\*\*In short\s*(?:\(([^)]*)\))?:?\*\*:?\s*(.*)$/i.exec(ql[0]);
    short = { note: head && head[1] ? head[1] : "", lines: [...(head && head[2] ? [head[2]] : []), ...ql.slice(1)].map((l) => ({ html: inline(l), text: plain(l) })) };
    body = body.slice(q[0].length);
  }
  return { meta, title: h1 ? h1[1].trim() : meta.title || "", versionLine: vl ? vl[1] : "", short, ...markdown(body) };
}

/** {doc, file, title, binds, found, version, effective, versionLine, short, html, toc, text, sha256, listed} for each text. */
export function legalDocs(dir = legalDir()) {
  const table = readmeTable(dir);
  const rows = table ? table.filter((r) => r.slug) : DOCS.map(([slug, file, title]) => ({ slug, file, title, sha256: "", binds: "" }));
  return rows.map((r) => {
    const f = resolve(dir, r.file), base = { doc: r.slug, file: r.file, title: r.title, binds: r.binds, listed: r.sha256 };
    if (!existsSync(f)) return { ...base, found: false };
    const bytes = readFileSync(f), text = bytes.toString("utf8"), p = parse(text);
    return { ...base, found: true, title: p.meta.title || p.title || r.title, version: p.meta.version || r.version || "", effective: p.meta.effective || r.effective || "",
      versionLine: p.versionLine, short: p.short, html: p.html, toc: p.toc, text, bytes, sha256: sha256(bytes) };
  });
}
