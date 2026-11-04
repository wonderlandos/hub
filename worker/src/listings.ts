// SPDX-License-Identifier: GPL-2.0-or-later
// Listings: an app, plugin or extension bound to a GitHub repository its owner owns.

import type { Ctx } from "./ctx";
import type { Env } from "./env";
import { now } from "./env";
import { fail, json, readJson, sameOrigin, str } from "./http";
import { requireSession } from "./session";
import { requireCla, requireTerms } from "./cla";
import { liveRole } from "./orgs";
import { getRepo } from "./github";
import { limit, MAX_LISTINGS_PER_PERSON, RULES } from "./ratelimit";
import { audit } from "./audit";
import { indexTrust, type Picture } from "./pipeline";

export const KINDS = ["app", "plugin", "extension"] as const;
export type Kind = (typeof KINDS)[number];
export const STATUSES = ["draft", "checking", "listed", "withdrawn"] as const;

// hub-index index.schema.json: 3 to 64 characters, parts of a-z, 0-9 and inner '-'.
const ID = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?){1,7}$/;
export const MAX_ID = 64;
export const MAX_NAME = 40;
const ASSET = /^[A-Za-z0-9._+-]*\*?[A-Za-z0-9._+-]*$/;
const LICENSE = /^[A-Za-z0-9.+ ()-]{1,64}$/;
const SUFFIX: Record<Kind, string> = { app: ".wol", plugin: ".wolplug", extension: ".wolext" };
export const RESERVED = "org.wolos.";

export function validId(id: string): boolean {
  return id.length >= 3 && id.length <= MAX_ID && ID.test(id);
}

/** The id prefix a person or organisation owns: its GitHub login, lowercased, and a dot. */
export const namespaceOf = (login: string) => login.toLowerCase() + ".";

export interface ListingRow {
  id: string; kind: Kind; host: string | null; owner_kind: "person" | "org" | "wolos"; owner_id: number;
  repo_id: number; repo: string; asset: string; name: string; summary: string; license: string;
  status: (typeof STATUSES)[number]; created_by: number; created_at: number; updated_at: number;
}
export interface ReleaseRow {
  listing_id: string; version: string; tag: string; commit_sha: string | null; asset_name: string; asset_url: string;
  size: number | null; sha256: string | null; trust: string; verdict: string; prerelease: number;
  first_seen: number; checked_at: number | null; yanked_at: number | null;
}

/** Does a release asset name match the listing's asset pattern (one '*' at most)? */
export function assetMatches(pattern: string, name: string): boolean {
  const i = pattern.indexOf("*");
  if (i < 0) return pattern === name;
  const pre = pattern.slice(0, i), post = pattern.slice(i + 1);
  return name.length >= pre.length + post.length && name.startsWith(pre) && name.endsWith(post);
}

export async function ownerLogin(env: Env, kind: string, id: number): Promise<string | null> {
  if (kind === "wolos") return "wonderlandos";
  const sql = kind === "org" ? "SELECT login FROM orgs WHERE github_org_id = ?" : "SELECT login FROM persons WHERE github_id = ?";
  return (await env.DB.prepare(sql).bind(id).first<{ login: string }>())?.login ?? null;
}

const parse = <T>(j: string | null): T | null => {
  if (j === null) return null;
  try { return JSON.parse(j) as T; } catch { return null; }
};

/** Name and summary as shown: the author's override, else the package's (newest release that has them), else the
 * ones the listing was registered with. Icon, screenshots and description always come from the package. */
export function shown(l: { name: string; summary: string }, override: { name: string | null; summary: string | null } | null,
  meta: { name: string | null; summary: string | null } | null) {
  // The index takes names of at most 40 characters (index.schema.json); a longer package name (apps may have 80) is
  // passed over, never cut.
  const fit = (v: string | null | undefined, max: number) => (v && v.length <= max ? v : null);
  return {
    name: fit(override?.name, MAX_NAME) ?? fit(meta?.name, MAX_NAME) ?? l.name,
    summary: fit(override?.summary, 200) ?? fit(meta?.summary, 200) ?? l.summary,
  };
}

/** A picture as the store and the index show it: the CDN name is <sha256>.<png|webp>. */
export function pictureView(p: Picture) {
  return { sha256: p.sha256, mime: p.mime, w: p.w, h: p.h, size: p.size, file: `${p.sha256}.${p.mime === "image/png" ? "png" : "webp"}` };
}

interface ViewRelease extends ReleaseRow {
  signature: string | null; cert: string | null; flag_reason: string | null;
  fc_serial: string | null; fc_url: string | null; fc_checked_at: number | null; fc_verdict: string | null;
  m_name: string | null; m_summary: string | null; m_description: string | null; m_icon: string | null; m_screenshots: string | null;
}

export async function listingView(env: Env, l: ListingRow) {
  const rel = (await env.DB.prepare(
    `SELECT r.*, f.signature, f.cert, g.reason AS flag_reason,
       fc.serial AS fc_serial, fc.url AS fc_url, fc.checked_at AS fc_checked_at, fc.verdict AS fc_verdict,
       m.name AS m_name, m.summary AS m_summary, m.description AS m_description, m.icon AS m_icon, m.screenshots AS m_screenshots
     FROM releases r
     LEFT JOIN release_facts f ON f.listing_id = r.listing_id AND f.version = r.version
     LEFT JOIN release_flags g ON g.listing_id = r.listing_id AND g.version = r.version
     LEFT JOIN file_certificates fc ON fc.listing_id = r.listing_id AND fc.version = r.version
     LEFT JOIN release_meta m ON m.listing_id = r.listing_id AND m.version = r.version
     WHERE r.listing_id = ? ORDER BY r.first_seen DESC LIMIT 50`,
  ).bind(l.id).all<ViewRelease>()).results;
  const override = await env.DB.prepare("SELECT name, summary FROM listing_overrides WHERE listing_id = ?").bind(l.id)
    .first<{ name: string | null; summary: string | null }>();
  // The package's metadata of the newest release that passed or was flagged (else the newest that has any).
  const metaRel = rel.find((r) => ["pass", "flag"].includes(r.verdict) && r.yanked_at === null && (r.m_name || r.m_summary || r.m_description || r.m_icon || r.m_screenshots))
    ?? rel.find((r) => r.m_name || r.m_summary || r.m_description || r.m_icon || r.m_screenshots);
  const meta = metaRel ? { name: metaRel.m_name, summary: metaRel.m_summary } : null;
  return {
    id: l.id, kind: l.kind, host: l.host, ...shown(l, override, meta), license: l.license, status: l.status,
    registered: { name: l.name, summary: l.summary }, override: override ?? null,
    description: metaRel?.m_description ?? null,
    icon: ((p) => (p ? pictureView(p) : null))(parse<Picture>(metaRel?.m_icon ?? null)),
    screenshots: (parse<Picture[]>(metaRel?.m_screenshots ?? null) ?? []).map(pictureView),
    owner: { kind: l.owner_kind, github_id: l.owner_id, login: await ownerLogin(env, l.owner_kind, l.owner_id) },
    source: { repo: l.repo, repo_id: l.repo_id, asset: l.asset },
    created_at: l.created_at, updated_at: l.updated_at,
    releases: rel.map((r) => ({
      version: r.version, tag: r.tag, commit: r.commit_sha, asset: r.asset_name, url: r.asset_url, size: r.size,
      sha256: r.sha256, trust: indexTrust(r.signature, r.trust), cert: r.cert,
      verdict: r.flag_reason && r.verdict === "pass" ? "flag" : r.verdict, flag: r.flag_reason, prerelease: !!r.prerelease,
      first_seen: r.first_seen, checked_at: r.checked_at, yanked: r.yanked_at !== null,
      // The signed statement for this version (the file certificate), once the sign job made it.
      file_certificate: r.fc_serial ? { serial: r.fc_serial, url: r.fc_url, checked_at: r.fc_checked_at, verdict: r.fc_verdict } : null,
    })),
  };
}

export async function getListing(ctx: Ctx, id: string): Promise<Response> {
  if (!validId(id)) fail(404, "no-listing", "There is no listing with that id.");
  const l = await ctx.env.DB.prepare("SELECT * FROM listings WHERE id = ?").bind(id).first<ListingRow>();
  if (!l) fail(404, "no-listing", "There is no listing with that id.");
  return json(await listingView(ctx.env, l!), 200, { "cache-control": "public, max-age=30" });
}

export async function postListing(ctx: Ctx): Promise<Response> {
  sameOrigin(ctx.req, ctx.env);
  const s = await requireSession(ctx);
  await limit(ctx.env, RULES.writePerson, s.person.github_id);
  await requireCla(ctx.env, "person", s.person.github_id);
  await requireTerms(ctx.env, "publisher", s.person.github_id);
  const b = await readJson(ctx.req);

  const id = str(b.id, "id", MAX_ID).toLowerCase();
  if (!validId(id)) fail(400, "bad-id", `An id is two or more dot-separated parts of a-z, 0-9 and '-' (not at a part's start or end), at most ${MAX_ID} characters, like alice.notes.`);
  const kind = str(b.kind, "kind", 16) as Kind;
  if (!KINDS.includes(kind)) fail(400, "bad-kind", "kind is app, plugin or extension.");
  let host: string | null = null;
  if (kind === "extension") {
    host = str(b.host, "host", MAX_ID).toLowerCase();
    if (!validId(host)) fail(400, "bad-host", "An extension names the id of the app it extends in 'host'.");
  } else if (b.host !== undefined && b.host !== null) {
    fail(400, "bad-host", "Only extensions have a host app.");
  }
  const name = str(b.name, "name", MAX_NAME);
  const summary = str(b.summary, "summary", 200);
  const license = str(b.license, "license", 64);
  if (!LICENSE.test(license)) fail(400, "bad-license", "Give the licence as an SPDX expression, like GPL-2.0-or-later.");
  const asset = str(b.asset, "asset", 128);
  if (!ASSET.test(asset) || asset.split("*").length > 2) fail(400, "bad-asset", "The asset name may hold letters, digits, '._+-' and one '*'.");
  const suffix = SUFFIX[kind];
  if (!asset.endsWith(suffix)) fail(400, "bad-asset", `A ${kind} asset ends in ${suffix}.`);
  const repoName = str(b.repo, "repo", 140);

  // Owner: the person, or a linked organisation the person belongs to on GitHub right now.
  const ownerArg = b.owner === undefined || b.owner === "person" ? "person" : str(b.owner, "owner", 39);
  let ownerKind: "person" | "org", ownerId: number, ownerLoginNow: string, ghType: string;
  if (ownerArg === "person") {
    ownerKind = "person"; ownerId = s.person.github_id; ownerLoginNow = s.person.login; ghType = "User";
  } else {
    const org = await ctx.env.DB.prepare("SELECT github_org_id, login FROM orgs WHERE lower(login) = lower(?)")
      .bind(ownerArg).first<{ github_org_id: number; login: string }>();
    if (!org) fail(404, "org-not-linked", `${ownerArg} is not linked to the hub yet. An owner of it links it first.`);
    await requireCla(ctx.env, "org", org!.github_org_id);
    const role = await liveRole(ctx, s, org!);
    if (!role) fail(403, "not-a-member", `You are not a member of ${org!.login} on GitHub.`);
    ownerKind = "org"; ownerId = org!.github_org_id; ownerLoginNow = org!.login; ghType = "Organization";
  }
  if (id.startsWith(RESERVED)) fail(403, "reserved", "Ids under org.wolos. belong to WolOS.");
  if (!id.startsWith(namespaceOf(ownerLoginNow))) {
    fail(403, "wrong-namespace", `Ids you publish as ${ownerLoginNow} start with ${namespaceOf(ownerLoginNow)}`);
  }

  const db = ctx.env.DB;
  const count = await db.prepare("SELECT count(*) AS n FROM listings WHERE created_by = ?").bind(s.person.github_id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_LISTINGS_PER_PERSON) fail(429, "too-many-listings", `One person can register at most ${MAX_LISTINGS_PER_PERSON} listings.`);
  if (await db.prepare("SELECT 1 FROM listings WHERE id = ?").bind(id).first()) fail(409, "id-taken", `${id} is already registered.`);

  const repo = await getRepo(ctx.env, await s.token(), repoName);
  if (!repo) fail(404, "no-repo", `GitHub has no repository ${repoName} that you can see.`);
  if (repo!.private) fail(400, "private-repo", "The repository must be public: people download the files from its releases.");
  if (repo!.owner.id !== ownerId || repo!.owner.type !== ghType) {
    fail(403, "not-your-repo", `${repo!.full_name} is not owned by ${ownerLoginNow} on GitHub.`);
  }

  const t = now();
  const res = await db.batch([
    db.prepare(
      "INSERT OR IGNORE INTO listings (id, kind, host, owner_kind, owner_id, repo_id, repo, asset, name, summary, license, status, created_by, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)",
    ).bind(id, kind, host, ownerKind, ownerId, repo!.id, repo!.full_name, asset, name, summary, license, s.person.github_id, t, t),
    audit(db, "person", s.person.github_id, "listing.create", `listing:${id}`, { repo: repo!.full_name, owner: `${ownerKind}:${ownerId}` }),
  ]);
  if (!res[0].meta.changes) fail(409, "id-taken", `${id} is already registered.`);
  const row = await db.prepare("SELECT * FROM listings WHERE id = ?").bind(id).first<ListingRow>();
  return json(await listingView(ctx.env, row!), 201);
}

/** PATCH /api/listings/:id {name?, summary?}: the author's own name and summary (null clears one). Icon, screenshots
 * and description always come from the package. The owner, or a member of the owning organisation on GitHub now. */
export async function patchListing(ctx: Ctx, id: string): Promise<Response> {
  sameOrigin(ctx.req, ctx.env);
  const s = await requireSession(ctx);
  await limit(ctx.env, RULES.writePerson, s.person.github_id);
  if (!validId(id)) fail(404, "no-listing", "There is no listing with that id.");
  const db = ctx.env.DB;
  const l = await db.prepare("SELECT * FROM listings WHERE id = ?").bind(id).first<ListingRow>();
  if (!l) fail(404, "no-listing", "There is no listing with that id.");
  if (l!.owner_kind === "person") {
    if (l!.owner_id !== s.person.github_id) fail(403, "not-yours", "Only the listing's owner can change it.");
  } else if (l!.owner_kind === "org") {
    const org = await db.prepare("SELECT github_org_id, login FROM orgs WHERE github_org_id = ?").bind(l!.owner_id).first<{ github_org_id: number; login: string }>();
    if (!org || !(await liveRole(ctx, s, org))) fail(403, "not-yours", "Only members of the owning organisation can change it.");
  } else {
    fail(403, "not-yours", "WolOS's own listings are changed in their repository.");
  }
  const b = await readJson(ctx.req);
  for (const k of Object.keys(b)) if (k !== "name" && k !== "summary") fail(400, "bad-field", `'${k}' cannot be changed here: icon, screenshots and description come from the package.`);
  if (!("name" in b) && !("summary" in b)) fail(400, "bad-field", "Send name, summary or both (null goes back to the package's).");
  const cur = await db.prepare("SELECT name, summary FROM listing_overrides WHERE listing_id = ?").bind(id).first<{ name: string | null; summary: string | null }>();
  const pick = (k: "name" | "summary", max: number) => {
    if (!(k in b)) return cur?.[k] ?? null;
    if (b[k] === null || b[k] === "") return null;
    const v = str(b[k], k, max);
    if (/[\n\r\t]/.test(v)) fail(400, "bad-field", `'${k}' is one line.`);
    return v;
  };
  const name = pick("name", MAX_NAME), summary = pick("summary", 200);
  const t = now();
  await db.batch([
    db.prepare("INSERT INTO listing_overrides (listing_id, name, summary, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT (listing_id) DO UPDATE SET name = excluded.name, summary = excluded.summary, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
      .bind(id, name, summary, s.person.github_id, t),
    db.prepare("UPDATE listings SET updated_at = ? WHERE id = ?").bind(t, id),
    audit(db, "person", s.person.github_id, "listing.override", `listing:${id}`, { name, summary }),
  ]);
  const row = await db.prepare("SELECT * FROM listings WHERE id = ?").bind(id).first<ListingRow>();
  return json(await listingView(ctx.env, row!));
}
