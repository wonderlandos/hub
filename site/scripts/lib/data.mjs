// SPDX-License-Identifier: GPL-2.0-or-later
// The hub index (extended plugin index, format 1; ADR 0047) read at build time and shaped for the pages.
// Source: HUB_INDEX (a file path or an https address, e.g. the published index), else data/index.json.
// The published index has one entry per listing (its newest version); the fixture may add `owners`,
// `featured` and `releases` (every version, newest first), which the pages show as the release history.
import { readFileSync } from "node:fs";
import { at } from "./paths.mjs";

export const KINDS = [
  { kind: "app", dir: "apps", one: "app", many: "Apps", blurb: "Programs for your desktop, from WolOS and from the people who make them." },
  { kind: "plugin", dir: "plugins", one: "plugin", many: "Plugins", blurb: "Small additions for the menu bar, Control Center and your tiles." },
  { kind: "extension", dir: "extensions", one: "extension", many: "Extensions", blurb: "More features for an app you already use." },
];
export const kindOf = (k) => KINDS.find((x) => x.kind === k);

/** Trust levels as the index names them (the 0.12 word "verified" reads as trusted). */
export const TRUST = ["wolos", "trusted", "origin", "community", "withdrawn"];
/** The short label on a card; the listing's trust row says the whole sentence (render.mjs trustRow). */
export const TRUST_LABEL = { wolos: "Made by WolOS", trusted: "Trusted developer", origin: "Verified origin", community: "Community", withdrawn: "Withdrawn" };
const trustOf = (t) => (t === "verified" ? "trusted" : TRUST.includes(t) ? t : "community");

export const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";

export async function loadIndex() {
  const src = process.env.HUB_INDEX;
  let text;
  if (src && /^https:\/\//.test(src)) {
    const r = await fetch(src);
    if (!r.ok) throw new Error(`hub index ${src}: HTTP ${r.status}`);
    text = await r.text();
  } else text = readFileSync(src || at("data/index.json"), "utf8");
  return shape(JSON.parse(text));
}

/** Entries of all three kinds with their owner, in one list; owners by login; categories. */
export function shape(raw) {
  if (raw.format !== 1) throw new Error(`hub index: format ${raw.format} is not 1`);
  const owners = new Map((raw.owners || []).map((o) => [o.login, { ...o, trust: trustOf(o.trust) }]));
  const entries = [];
  for (const k of KINDS) {
    for (const e of raw[k.dir] || []) entries.push(entry(e, k.kind, owners));
  }
  const shown = entries.filter((e) => e.verdict !== "block"); // a blocked file is not listed
  const ids = new Set();
  for (const e of shown) { if (ids.has(e.id)) throw new Error(`hub index: ${e.id} twice`); ids.add(e.id); }
  const featured = (raw.featured || []).map((id) => shown.find((e) => e.id === id)).filter(Boolean);
  for (const o of owners.values()) o.entries = shown.filter((e) => e.owner.login === o.login);
  const cats = new Map();
  for (const e of shown) for (const c of e.categories || []) {
    const s = slug(c);
    if (!cats.has(s)) cats.set(s, { slug: s, name: c, entries: [] });
    cats.get(s).entries.push(e);
  }
  const categories = [...cats.values()].sort((a, b) => a.name.localeCompare(b.name));
  const newest = shown.slice().sort((a, b) => latest(b).first_seen - latest(a).first_seen);
  return { serial: raw.serial, issued: raw.issued, entries: shown, owners: [...owners.values()], featured, categories, newest };
}

function entry(e, kind, owners) {
  if (!e.owner?.login) throw new Error(`hub index: ${e.id} has no owner`);
  if (!owners.has(e.owner.login)) {
    owners.set(e.owner.login, { kind: e.owner.kind, github_id: e.owner.github_id, login: e.owner.login, name: e.author || e.owner.login, trust: trustOf(e.trust) });
  }
  const o = owners.get(e.owner.login);
  const trust = e.withdrawn ? "withdrawn" : trustOf(e.trust);
  const top = { version: e.version, tag: e.source?.tag, commit: e.source?.commit, url: e.url, sha256: e.sha256, size: e.size, verdict: e.verdict, findings: e.findings, first_seen: e.first_seen, checked_at: e.checked_at, yanked: e.yanked, withdrawn: e.withdrawn, statement: e.statement, cert: e.cert, trust };
  const releases = (e.releases?.length ? e.releases : [top]).map((r) => ({ ...r, trust: r.withdrawn ? "withdrawn" : trustOf(r.trust || trust) }))
    .sort((a, b) => b.first_seen - a.first_seen);
  const dir = kindOf(kind).dir;
  return { ...e, kind, dir, trust, ownerInfo: o, owner: e.owner, releases, url_path: `/${dir}/${e.id}` };
}

/** The newest release that is neither withdrawn by its author nor by the hub. */
export const latest = (e) => e.releases.find((r) => !r.yanked && !r.withdrawn) || e.releases[0];

/** Where a person or an organisation lives on the hub. */
export const ownerPath = (o) => `/${o.kind === "person" ? "authors" : "orgs"}/${o.login}`;

/** A version's own page. */
export const versionPath = (e, r) => `${e.url_path}/${r.version}`;
