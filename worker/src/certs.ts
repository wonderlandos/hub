// SPDX-License-Identifier: GPL-2.0-or-later
// Author certificates (ADR 0046), two tiers (lead 2026-11-04). A signed-in person with the CLA sends the request
// `wol cert request` made (woltrust request::Request); the hub checks its shape and the account with GitHub, never the
// proof's signature (`woltrust issue --proof` in the ca workflow does).
//  - origin: approved by policy, without a person, when every gate holds (originGates): the CLA, the Publisher
//    Agreement and the Trust Terms accepted, a GitHub account older than 30 days with two-factor authentication, no
//    open or refused request, no certificate revoked for cause, one origin request per subject per 7 days. A refused
//    request or a revocation for cause before sends it to the panel instead; a missing gate refuses it.
//  - trusted: needs the subject's live origin certificate (origin_cert) and a person's approval in the panel (admin.ts).
// The Worker then starts the ca workflow, the ca job fetches the request file here with its OIDC token and reports the
// certificate back, and the certificate is shown on the subject's page. Revocations come back here too.

import type { Ctx } from "./ctx";
import type { Env } from "./env";
import { now } from "./env";
import { hex, random, sha256hex, unb64url } from "./crypto";
import { fail, json, readJson, sameOrigin, str } from "./http";
import { requireSession } from "./session";
import { acceptedText, acceptTerms, claStatus, requireCla, termsStatus } from "./cla";
import { getOrgMembership, getUser, hubRole } from "./github";
import { namespaceOf, RESERVED } from "./listings";
import { pipelineAuth } from "./pipeline";
import { limit, RULES } from "./ratelimit";
import { audit } from "./audit";
import { log } from "./log";
import { dispatchCa } from "./ghapp";

export const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const TIERS = ["origin", "trusted"] as const;
export type Tier = (typeof TIERS)[number];
/** Origin policy (lead 2026-11-04). */
export const ORIGIN_MIN_ACCOUNT_AGE = 30 * 86400;
export const ORIGIN_REQUEST_EVERY = 7 * 86400;
/** decided_login of a request the policy approved. */
export const POLICY = "policy";
const LOGIN = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/;
const NAMESPACE = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.$/;
export const SERIAL = /^[0-9a-f]{16}$/;
const MAX_AGE = 30 * 86400;
/** Public key sizes in bytes (ADR 0046; schema/request.schema.json gives the base64url lengths). */
const KEY_BYTES = { ed25519: 32, "ml-dsa-65": 1952, x25519: 32, "ml-kem-768": 1184 } as const;
/** A .wolcert with its body and two signature halves stays well under this. */
export const CERT_LIMIT = 64 * 1024;

export interface RequestBody {
  format: 1; action: "issue"; kind: "person" | "org";
  subject: { github_id: number; login: string; name: string; org?: { github_id: number; login: string } };
  namespaces: string[];
  keys: Record<string, string>;
  proof: { ed25519: string; second: string };
  months: number; requested_at: number; level?: "verified";
}

export interface RequestRow {
  id: string; kind: "person" | "org"; subject_id: number; login: string; requested_by: number; ed25519: string;
  body: string; verified_at: number; status: "pending" | "approved" | "issued" | "refused";
  decided_by: number | null; decided_login: string | null; decided_at: number | null; reason: string | null;
  dispatched_at: number | null; dispatch_error: string | null; serial: string | null; created_at: number;
  tier: Tier; gates: string | null; origin_cert: string | null;
}

export interface CertRow {
  serial: string; request_id: string; kind: "person" | "org"; subject_id: number; login: string; not_before: number;
  not_after: number; cert: string; run_id: string | null; issued_at: number; tier: Tier; revoked_at: number | null;
  revoke_reason: string | null; origin_cert: string | null;
}

const bad = (sentence: string): never => fail(400, "bad-request", sentence);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function only(o: Record<string, unknown>, keys: string[], where: string): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) bad(`The request has '${where}${k}', which the hub does not take.`);
}

function b64(v: unknown, field: string, bytes?: number, chars?: [number, number]): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]+$/.test(v)) bad(`'${field}' must be base64url without padding.`);
  const s = v as string;
  if (chars && (s.length < chars[0] || s.length > chars[1])) bad(`'${field}' has the wrong length.`);
  if (bytes !== undefined) {
    let n = -1;
    try { n = unb64url(s).length; } catch { /* below */ }
    if (n !== bytes) bad(`'${field}' must be ${bytes} bytes.`);
  }
  return s;
}

function int(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) bad(`'${field}' must be a whole number from ${min} to ${max}.`);
  return v as number;
}

/** The shape of a woltrust request (schema/request.schema.json, action issue, without the hub's fields). */
export function requestShape(b: Record<string, unknown>, t = now()): RequestBody {
  for (const k of ["id", "verified_at", "approved_by", "approved_at"]) {
    if (k in b) bad(`'${k}' is set by the hub, not by the request.`);
  }
  only(b, ["format", "action", "kind", "subject", "namespaces", "keys", "proof", "months", "requested_at", "level"], "");
  if (b.format !== 1) bad("'format' must be 1.");
  if (b.action !== "issue") bad("'action' must be issue.");
  if (b.kind !== "person" && b.kind !== "org") bad("'kind' is person or org.");
  if (!isObj(b.subject)) bad("'subject' must be an object.");
  const sj = b.subject as Record<string, unknown>;
  only(sj, ["github_id", "login", "name", "org"], "subject.");
  const subject: RequestBody["subject"] = {
    github_id: int(sj.github_id, "subject.github_id", 1, Number.MAX_SAFE_INTEGER),
    login: str(sj.login, "subject.login", 39),
    name: str(sj.name ?? sj.login, "subject.name", 80),
  };
  if (!LOGIN.test(subject.login)) bad("'subject.login' is not a GitHub login.");
  if (sj.org !== undefined) {
    if (b.kind !== "person") bad("Only a person's request names an organisation.");
    if (!isObj(sj.org)) bad("'subject.org' must be an object.");
    const o = sj.org as Record<string, unknown>;
    only(o, ["github_id", "login"], "subject.org.");
    const login = str(o.login, "subject.org.login", 39);
    if (!LOGIN.test(login)) bad("'subject.org.login' is not a GitHub login.");
    subject.org = { github_id: o.github_id === undefined ? 0 : int(o.github_id, "subject.org.github_id", 1, Number.MAX_SAFE_INTEGER), login };
  }
  if (!Array.isArray(b.namespaces) || b.namespaces.length < 1 || b.namespaces.length > 8) bad("'namespaces' is a list of 1 to 8 prefixes.");
  const namespaces = (b.namespaces as unknown[]).map((n) => {
    if (typeof n !== "string" || n.length > 128 || !NAMESPACE.test(n)) bad("A namespace is lower-case parts ending in a dot, like alice.");
    return n as string;
  });
  if (new Set(namespaces).size !== namespaces.length) bad("A namespace is listed twice.");
  if (!isObj(b.keys)) bad("'keys' must be an object.");
  const k = b.keys as Record<string, unknown>;
  only(k, Object.keys(KEY_BYTES), "keys.");
  const keys: Record<string, string> = {
    ed25519: b64(k.ed25519, "keys.ed25519", KEY_BYTES.ed25519),
    "ml-dsa-65": b64(k["ml-dsa-65"], "keys.ml-dsa-65", KEY_BYTES["ml-dsa-65"]),
  };
  if ((k.x25519 === undefined) !== (k["ml-kem-768"] === undefined)) bad("The encryption keys x25519 and ml-kem-768 come both or not at all.");
  if (k.x25519 !== undefined) {
    keys.x25519 = b64(k.x25519, "keys.x25519", KEY_BYTES.x25519);
    keys["ml-kem-768"] = b64(k["ml-kem-768"], "keys.ml-kem-768", KEY_BYTES["ml-kem-768"]);
  }
  if (!isObj(b.proof)) bad("'proof' must be an object (the proof of possession).");
  const p = b.proof as Record<string, unknown>;
  only(p, ["ed25519", "second"], "proof.");
  const proof = { ed25519: b64(p.ed25519, "proof.ed25519", 64), second: b64(p.second, "proof.second", undefined, [100, 6000]) };
  const months = b.months === undefined ? 12 : int(b.months, "months", 1, 24);
  const requestedAt = int(b.requested_at, "requested_at", t - MAX_AGE, t + 600);
  if (b.level !== undefined && b.level !== "verified") bad("'level' can only be verified.");
  return {
    format: 1, action: "issue", kind: b.kind as "person" | "org", subject, namespaces, keys, proof, months, requested_at: requestedAt,
    ...(b.level ? { level: "verified" as const } : {}),
  };
}

/** 16 hex digits naming an Ed25519 key, as woltrust request::key_id does. */
export async function keyId(ed25519: string): Promise<string> {
  return (await sha256hex(unb64url(ed25519))).slice(0, 16);
}

/** The namespaces a subject may ask for: its own "<login>." and prefixes under it, never WolOS's. */
function checkNamespaces(namespaces: string[], login: string): void {
  const own = namespaceOf(login);
  if (!namespaces.includes(own)) fail(403, "wrong-namespace", `A certificate for ${login} includes the namespace ${own}`);
  for (const n of namespaces) {
    if (!n.startsWith(own)) fail(403, "wrong-namespace", `${n} is not under ${own}, so ${login} cannot ask for it.`);
    if (n.startsWith(RESERVED) || RESERVED.startsWith(n)) fail(403, "reserved", "Namespaces under org.wolos. belong to WolOS.");
  }
}

/** The subject's live certificate of a tier: issued, not revoked, not expired. */
export async function liveCert(env: Env, kind: string, subjectId: number, tier: Tier, t = now()): Promise<CertRow | null> {
  return env.DB.prepare(
    "SELECT * FROM certs WHERE kind = ? AND subject_id = ? AND tier = ? AND revoked_at IS NULL AND not_after > ? ORDER BY issued_at DESC LIMIT 1",
  ).bind(kind, subjectId, tier, t).first<CertRow>();
}

export type TierState = "none" | "pending" | "issued" | "revoked";

/** Per tier: none, pending (a request is being handled), issued (a live certificate), revoked (the last one was). */
export async function tierStates(env: Env, kind: string, subjectId: number): Promise<Record<Tier, TierState>> {
  const out = { origin: "none", trusted: "none" } as Record<Tier, TierState>;
  const t = now();
  for (const tier of TIERS) {
    if (await liveCert(env, kind, subjectId, tier, t)) { out[tier] = "issued"; continue; }
    const open = await env.DB.prepare("SELECT 1 FROM cert_requests WHERE kind = ? AND subject_id = ? AND tier = ? AND status IN ('pending','approved')")
      .bind(kind, subjectId, tier).first();
    if (open) { out[tier] = "pending"; continue; }
    const revoked = await env.DB.prepare("SELECT 1 FROM certs WHERE kind = ? AND subject_id = ? AND tier = ? AND revoked_at IS NOT NULL")
      .bind(kind, subjectId, tier).first();
    if (revoked) out[tier] = "revoked";
  }
  return out;
}

export interface OriginGates {
  cla: boolean; publisher: boolean; trust_terms: string; account_created: number | null; account_age_days: number | null;
  two_factor: boolean | null; open_request: string | null; refused_before: boolean; revoked_for_cause: boolean;
  last_origin_request: number | null;
}

/** Starts ca.yml for an approved request or revocation and records the outcome. */
export async function startCa(env: Env, table: "cert_requests" | "revocations", id: string, actor: [ "person" | "system", string | number ]): Promise<{ dispatched: boolean; error: string | null }> {
  let dispatched = true, error: string | null = null;
  try {
    await dispatchCa(env, id);
  } catch (e) {
    dispatched = false;
    error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    log("cert.dispatch-failed", { request: id, message: error });
  }
  const db = env.DB;
  const target = table === "cert_requests" ? `request:${id}` : `revocation:${id}`;
  await db.batch([
    dispatched
      ? db.prepare(`UPDATE ${table} SET dispatched_at = ?, dispatch_error = NULL WHERE id = ?`).bind(now(), id)
      : db.prepare(`UPDATE ${table} SET dispatch_error = ? WHERE id = ?`).bind(error, id),
    audit(db, actor[0], actor[1], dispatched ? "cert.dispatch" : "cert.dispatch-failed", target, error ? { error } : {}),
  ]);
  return { dispatched, error };
}

export async function postCertRequest(ctx: Ctx): Promise<Response> {
  sameOrigin(ctx.req, ctx.env);
  const s = await requireSession(ctx);
  await limit(ctx.env, RULES.writePerson, s.person.github_id);
  await requireCla(ctx.env, "person", s.person.github_id);
  // The body is the woltrust request plus trust_terms: {version, sha256} of the Trust Terms accepted with it, and the
  // tier asked for (origin when absent: the lesser one).
  const { trust_terms: tt, tier: rawTier, ...raw } = await readJson(ctx.req);
  if (!tt || typeof tt !== "object" || Array.isArray(tt)) fail(403, "trust-terms-needed", "Accept the Trust Terms with the request: send trust_terms {version, sha256}.");
  const tier: Tier = rawTier === undefined || rawTier === null ? "origin" : (TIERS as readonly unknown[]).includes(rawTier) ? rawTier as Tier : bad("'tier' is origin or trusted.");
  const terms = await acceptedText(ctx.env, "trust", tt as Record<string, unknown>);
  const r = requestShape(raw);
  const db = ctx.env.DB;
  const token = await s.token();
  // The account, checked with GitHub at this moment: this is the certificate's verified_at.
  const u = await getUser(ctx.env, token);
  if (u.id !== s.person.github_id) fail(401, "signed-out", "GitHub says you are someone else now. Sign in again.");
  if (r.kind === "person") {
    if (r.subject.github_id !== u.id) {
      fail(403, "not-you", `This request was made for GitHub account ${r.subject.github_id}; you are signed in as ${u.login} (${u.id}). Run wol cert request again as yourself.`);
    }
    r.subject.login = u.login;
    if (r.subject.org) {
      const m = await getOrgMembership(ctx.env, token, r.subject.org.login);
      if (!m) fail(403, "not-a-member", `GitHub does not show you as a member of ${r.subject.org.login}.`);
      if (r.subject.org.github_id && r.subject.org.github_id !== m!.organization.id) bad(`${r.subject.org.login} has a different GitHub id.`);
      r.subject.org = { github_id: m!.organization.id, login: m!.organization.login };
    }
  } else {
    const m = await getOrgMembership(ctx.env, token, r.subject.login);
    if (!m || m.organization.id !== r.subject.github_id) fail(403, "not-a-member", `You are not a member of ${r.subject.login} on GitHub.`);
    if (hubRole(m!.role) !== "owner") fail(403, "not-owner", `Only an owner of ${r.subject.login} can ask for its certificate.`);
    if (!(await db.prepare("SELECT 1 FROM orgs WHERE github_org_id = ?").bind(m!.organization.id).first())) {
      fail(404, "org-not-linked", `${m!.organization.login} is not linked to the hub yet. Link it first.`);
    }
    await requireCla(ctx.env, "org", m!.organization.id);
    r.subject.login = m!.organization.login;
  }
  checkNamespaces(r.namespaces, r.subject.login);
  const open = await db.prepare("SELECT id FROM cert_requests WHERE kind = ? AND subject_id = ? AND status IN ('pending','approved')")
    .bind(r.kind, r.subject.github_id).first<{ id: string }>();
  if (open) fail(409, "request-open", `Request ${open.id} for ${r.subject.login} is still being handled.`);
  const t = now();
  const live = await liveCert(ctx.env, r.kind, r.subject.github_id, tier, t);
  if (live) fail(409, "cert-active", `${r.subject.login} already has the ${tier} certificate ${live.serial}. An admin revokes it (superseded) before a new one.`);

  let originCert: string | null = null;
  let gates: OriginGates | null = null;
  let auto = false;
  if (tier === "trusted") {
    const origin = await liveCert(ctx.env, r.kind, r.subject.github_id, "origin", t);
    if (!origin) fail(409, "origin-first", `A trusted certificate builds on an origin certificate. Ask for ${r.subject.login}'s origin certificate first.`);
    originCert = origin!.serial;
  } else {
    gates = await originGates(ctx.env, r, s.person.github_id, u, terms.version, t);
    const refuse = (status: number, code: string, sentence: string, headers: Record<string, string> = {}) =>
      db.batch([audit(db, "system", POLICY, "cert.origin-refused", `person:${s.person.github_id}`, { code, subject: r.subject.github_id, gates })])
        .then(() => fail(status, code, sentence, headers));
    if (!gates.publisher) await refuse(403, "publisher-terms-needed", "Accept the Publisher Agreement before you ask for an origin certificate.");
    if (gates.two_factor !== true) {
      await refuse(403, "two-factor-needed", "Turn on two-factor authentication for your GitHub account, then ask again. The hub issues origin certificates only to accounts with it.");
    }
    if (gates.account_age_days === null || gates.account_created === null || t - gates.account_created < ORIGIN_MIN_ACCOUNT_AGE) {
      await refuse(403, "account-too-new", "Your GitHub account is younger than 30 days. Ask again once it is 30 days old.");
    }
    if (gates.last_origin_request !== null && t - gates.last_origin_request < ORIGIN_REQUEST_EVERY) {
      const retry = gates.last_origin_request + ORIGIN_REQUEST_EVERY - t;
      await refuse(429, "origin-weekly", `One origin request per week. Try again in ${Math.ceil(retry / 3600)} hours.`, { "retry-after": String(retry) });
    }
    // A refusal or a revocation for cause before: a person looks at it in the panel.
    auto = !gates.refused_before && !gates.revoked_for_cause;
  }
  await limit(ctx.env, RULES.certRequests, s.person.github_id); // counts requests that would be stored
  const id = `r-${hex(random(8))}`;
  const keyRef = await keyId(r.keys.ed25519);
  await db.batch([
    db.prepare(
      "INSERT INTO cert_requests (id, kind, subject_id, login, requested_by, ed25519, body, verified_at, status, created_at, tier, gates, origin_cert, decided_login, decided_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, r.kind, r.subject.github_id, r.subject.login, s.person.github_id, r.keys.ed25519, JSON.stringify(r), t,
      auto ? "approved" : "pending", t, tier, gates ? JSON.stringify(gates) : null, originCert, auto ? POLICY : null, auto ? t : null),
    audit(db, "person", s.person.github_id, "cert.request", `request:${id}`, { kind: r.kind, tier, subject: r.subject.github_id, key: keyRef, trust_terms: terms.version, ...(originCert ? { origin_cert: originCert } : {}) }),
    ...(gates ? [audit(db, "system", POLICY, auto ? "cert.approve" : "cert.review", `request:${id}`, { approved_by: auto ? POLICY : null, gates })] : []),
    ...acceptTerms(db, "trust", s.person.github_id, terms),
  ]);
  let dispatch: { dispatched: boolean; error: string | null } | null = null;
  if (auto) dispatch = await startCa(ctx.env, "cert_requests", id, ["system", POLICY]);
  const row = await db.prepare("SELECT * FROM cert_requests WHERE id = ?").bind(id).first<RequestRow>();
  return json({
    request: await requestView(ctx.env, row!), auto, ...(dispatch ? { dispatched: dispatch.dispatched } : {}),
    sentence: auto
      ? dispatch!.dispatched ? "Approved by the hub's rules. Your origin certificate is being issued now." : "Approved by the hub's rules; issuing starts as soon as the workflow can be reached."
      : tier === "trusted" ? "Sent. A hub reviewer looks at trusted requests." : "Sent. Because of an earlier decision, a hub reviewer looks at this request.",
  }, 201);
}

/** Every gate of the origin policy, with its value, as recorded with the request. */
async function originGates(env: Env, r: RequestBody, person: number, u: { created_at?: string; two_factor_authentication?: boolean }, trustTerms: string, t: number): Promise<OriginGates> {
  const db = env.DB;
  const created = u.created_at ? Math.floor(Date.parse(u.created_at) / 1000) : NaN;
  const refused = await db.prepare("SELECT 1 FROM cert_requests WHERE kind = ? AND subject_id = ? AND status = 'refused' LIMIT 1").bind(r.kind, r.subject.github_id).first();
  const cause = await db.prepare("SELECT 1 FROM certs WHERE kind = ? AND subject_id = ? AND revoke_reason IN ('key-compromise','abuse') LIMIT 1").bind(r.kind, r.subject.github_id).first()
    ?? await db.prepare("SELECT 1 FROM revocations v JOIN certs c ON c.serial = v.serial WHERE c.kind = ? AND c.subject_id = ? AND v.reason IN ('key-compromise','abuse') LIMIT 1").bind(r.kind, r.subject.github_id).first();
  const last = await db.prepare("SELECT max(created_at) AS at FROM cert_requests WHERE kind = ? AND subject_id = ? AND tier = 'origin'").bind(r.kind, r.subject.github_id).first<{ at: number | null }>();
  return {
    cla: true, // requireCla passed (person; and the organisation's for an organisation)
    publisher: (await termsStatus(env, "publisher", person)).ok,
    trust_terms: trustTerms,
    account_created: Number.isFinite(created) ? created : null,
    account_age_days: Number.isFinite(created) ? Math.floor((t - created) / 86400) : null,
    two_factor: u.two_factor_authentication === undefined ? null : u.two_factor_authentication === true,
    open_request: null, // an open request was refused above (409)
    refused_before: !!refused,
    revoked_for_cause: !!cause,
    last_origin_request: last?.at ?? null,
  };
}

/** What the requester and the admins see of a request. */
export async function requestView(env: Env, row: RequestRow, admin = false) {
  const b = JSON.parse(row.body) as RequestBody;
  const cert = row.status === "issued" && row.serial
    ? await env.DB.prepare("SELECT cert FROM certs WHERE serial = ?").bind(row.serial).first<{ cert: string }>()
    : null;
  return {
    id: row.id, kind: row.kind, tier: row.tier, subject: b.subject, namespaces: b.namespaces, key_id: await keyId(row.ed25519),
    encryption: !!b.keys.x25519, months: b.months, requested_at: b.requested_at, verified_at: row.verified_at,
    status: row.status, created_at: row.created_at, decided_at: row.decided_at, approved_by: row.status === "refused" ? null : row.decided_login,
    auto: row.decided_login === POLICY, origin_cert: row.origin_cert,
    reason: row.reason, serial: row.serial, cert: cert?.cert ?? null,
    ...(admin ? { requested_by: row.requested_by, dispatched_at: row.dispatched_at, dispatch_error: row.dispatch_error, gates: row.gates ? JSON.parse(row.gates) : null } : {}),
  };
}

export async function getMyCertRequests(ctx: Ctx): Promise<Response> {
  const s = await requireSession(ctx);
  const rows = (await ctx.env.DB.prepare("SELECT * FROM cert_requests WHERE requested_by = ? ORDER BY created_at DESC, id LIMIT 20")
    .bind(s.person.github_id).all<RequestRow>()).results;
  return json({ requests: await Promise.all(rows.map((r) => requestView(ctx.env, r))) });
}

/** Public: the certificates issued to a GitHub login (person or organisation), for its page on the hub. */
export async function getCerts(ctx: Ctx, login: string): Promise<Response> {
  if (!LOGIN.test(login) || login.length > 39) fail(404, "no-account", "There is no account with that name.");
  const rows = (await ctx.env.DB.prepare(
    "SELECT serial, kind, tier, login, not_before, not_after, issued_at, revoked_at, revoke_reason, origin_cert, cert FROM certs WHERE lower(login) = lower(?) ORDER BY issued_at DESC, serial LIMIT 20",
  ).bind(login).all()).results;
  return json({ login, certs: rows }, 200, { "cache-control": "public, max-age=60" });
}

export interface RevocationRow {
  id: string; grp: string; serial: string; action: "revoke" | "downgrade"; reason: "key-compromise" | "abuse" | "superseded";
  note: string | null; status: "pending" | "approved" | "done"; requested_by: number; approvers: string; approved_at: number | null;
  dispatched_at: number | null; dispatch_error: string | null; done_at: number | null; created_at: number;
}

/** ca job: the request file of an approved request that has no certificate yet (r-...), or of an approved revocation
 * that is not done yet (v-...: hub-index request.schema.json action revoke). */
export async function pipelineRequest(ctx: Ctx, id: string): Promise<Response> {
  const c = await pipelineAuth(ctx, "ca");
  if (id.startsWith("v-")) return revocationFile(ctx, id, c.run_id);
  const row = REQUEST_ID.test(id)
    ? await ctx.env.DB.prepare("SELECT * FROM cert_requests WHERE id = ?").bind(id).first<RequestRow>() : null;
  if (!row || row.status !== "approved" || !row.decided_login || !row.decided_at) {
    fail(404, "no-request", "There is no approved request with this id that waits for a certificate.");
  }
  const b = JSON.parse(row!.body) as RequestBody;
  log("pipeline.request", { request: id, run: c.run_id ?? "?" });
  // The request file of hub-index schema/request.schema.json, in its order. origin: cla_accepted_at and no approval
  // (the policy approved it); trusted: the person who approved, and the origin certificate it builds on.
  const common = {
    format: 1, action: "issue", id: row!.id, tier: row!.tier, kind: b.kind, subject: b.subject, namespaces: b.namespaces, keys: b.keys, proof: b.proof,
    ...(b.level ? { level: b.level } : {}), months: b.months, requested_at: b.requested_at, verified_at: row!.verified_at,
  };
  if (row!.tier === "origin") {
    const cla = await claStatus(ctx.env, row!.kind, row!.subject_id);
    if (!cla.accepted_at) fail(404, "no-request", "The subject of this request has no CLA on record.");
    return json({ ...common, cla_accepted_at: cla.accepted_at });
  }
  if (!row!.origin_cert || row!.decided_login === POLICY) fail(404, "no-request", "This trusted request has no origin certificate or no person's approval.");
  return json({ ...common, approved_by: [row!.decided_login], approved_at: row!.decided_at, origin_cert: row!.origin_cert });
}

async function revocationFile(ctx: Ctx, id: string, run: string | undefined): Promise<Response> {
  const row = REQUEST_ID.test(id)
    ? await ctx.env.DB.prepare("SELECT * FROM revocations WHERE id = ?").bind(id).first<RevocationRow>() : null;
  if (!row || row.status !== "approved") fail(404, "no-request", "There is no approved revocation with this id that waits for the ca job.");
  log("pipeline.revocation", { request: id, run: run ?? "?" });
  return json({
    format: 1, action: "revoke", id: row!.id, serial: row!.serial, reason: row!.reason,
    approved_by: JSON.parse(row!.approvers) as string[], ...(row!.note ? { note: row!.note } : {}),
  });
}

interface CertBody {
  serial?: unknown; kind?: unknown; subject?: { github_id?: unknown }; namespaces?: unknown;
  keys?: { ed25519?: unknown }; not_before?: unknown; not_after?: unknown; class?: unknown; origin_cert?: unknown;
}

/** ca job: the certificate it issued for a request. Stored, shown on the subject's page, the request marked issued. */
export async function pipelineCerts(ctx: Ctx): Promise<Response> {
  const c = await pipelineAuth(ctx, "ca");
  const b = await readJson(ctx.req, CERT_LIMIT);
  const id = str(b.request_id, "request_id", 64);
  if (!REQUEST_ID.test(id)) bad("'request_id' is not a request id.");
  const serial = str(b.serial, "serial", 16);
  if (!SERIAL.test(serial)) bad("'serial' is 16 lower-case hex digits.");
  if (typeof b.cert !== "string" || b.cert.length > CERT_LIMIT) bad("'cert' is the .wolcert text.");
  if (b.tier !== undefined && !(TIERS as readonly unknown[]).includes(b.tier)) bad("'tier' is origin or trusted.");
  const text = b.cert as string;
  const db = ctx.env.DB;
  const row = await db.prepare("SELECT * FROM cert_requests WHERE id = ?").bind(id).first<RequestRow>();
  if (!row) fail(404, "no-request", "There is no request with this id.");
  if (row!.status === "issued") {
    if (row!.serial === serial) return json({ stored: true, duplicate: true });
    fail(409, "already-issued", `Request ${id} already has the certificate ${row!.serial}.`);
  }
  if (row!.status !== "approved") fail(409, "not-approved", `Request ${id} is ${row!.status}, not approved.`);
  // The certificate must be the one asked for: same serial, kind, subject, namespaces, signing key and tier.
  let body: CertBody;
  try {
    const w = JSON.parse(text) as { format?: unknown; body?: unknown; sig?: { ed25519?: unknown; second?: unknown } };
    if (w.format !== 1 || typeof w.body !== "string" || typeof w.sig?.ed25519 !== "string" || typeof w.sig?.second !== "string") throw new Error();
    body = JSON.parse(new TextDecoder().decode(unb64url(w.body))) as CertBody;
  } catch {
    return bad("'cert' is not a .wolcert (format 1, body, sig).");
  }
  const want = JSON.parse(row!.body) as RequestBody;
  const mismatch = body.serial !== serial ? "serial" : body.kind !== row!.kind ? "kind"
    : body.subject?.github_id !== row!.subject_id ? "subject" : body.keys?.ed25519 !== row!.ed25519 ? "key"
    : JSON.stringify(body.namespaces) !== JSON.stringify(want.namespaces) ? "namespaces"
    : !Number.isSafeInteger(body.not_before) || !Number.isSafeInteger(body.not_after) ? "validity"
    : b.tier !== undefined && b.tier !== row!.tier ? "tier"
    // In the signed body (TRUST-core-4): class absent means origin; a trusted one names its origin certificate.
    : body.class !== undefined && body.class !== row!.tier ? "class"
    : body.class === "trusted" && body.origin_cert !== row!.origin_cert ? "origin_cert" : null;
  if (mismatch) fail(409, "cert-mismatch", `The certificate does not match request ${id} (${mismatch}).`);
  if (await db.prepare("SELECT 1 FROM certs WHERE serial = ?").bind(serial).first()) fail(409, "serial-taken", `Serial ${serial} is already known.`);
  const t = now();
  const run = `${c.run_id ?? "?"}.${c.run_attempt ?? "1"}`;
  const res = await db.batch([
    db.prepare("UPDATE cert_requests SET status = 'issued', serial = ? WHERE id = ? AND status = 'approved'").bind(serial, id),
    db.prepare(
      "INSERT INTO certs (serial, request_id, kind, subject_id, login, not_before, not_after, cert, run_id, issued_at, tier, origin_cert) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(serial, id, row!.kind, row!.subject_id, row!.login, body.not_before as number, body.not_after as number, text, run, t, row!.tier, row!.origin_cert),
    audit(db, "pipeline", run, "cert.issued", `request:${id}`, { serial, subject: row!.subject_id, tier: row!.tier }),
  ]);
  if (!res[0].meta.changes) fail(409, "not-approved", `Request ${id} changed while the certificate was stored.`);
  log("pipeline.cert", { request: id, serial });
  return json({ stored: true });
}

/** ca job: a revocation is on revocations.json now. The certificate is marked revoked; revoking an origin certificate
 * for key-compromise or abuse marks the trusted certificates built on it revoked too (woltrust withdraws them through
 * origin_cert). A downgrade (superseded) leaves the origin certificate alone. */
export async function pipelineRevocations(ctx: Ctx): Promise<Response> {
  const c = await pipelineAuth(ctx, "ca");
  const b = await readJson(ctx.req);
  const id = str(b.request_id, "request_id", 64);
  if (!REQUEST_ID.test(id) || !id.startsWith("v-")) bad("'request_id' is not a revocation id.");
  const serial = str(b.serial, "serial", 16);
  if (!SERIAL.test(serial)) bad("'serial' is 16 lower-case hex digits.");
  const db = ctx.env.DB;
  const row = await db.prepare("SELECT * FROM revocations WHERE id = ?").bind(id).first<RevocationRow>();
  if (!row) fail(404, "no-request", "There is no revocation with this id.");
  if (row!.serial !== serial) fail(409, "serial-mismatch", `Revocation ${id} is for ${row!.serial}.`);
  if (row!.status === "done") return json({ stored: true, duplicate: true });
  if (row!.status !== "approved") fail(409, "not-approved", `Revocation ${id} is ${row!.status}, not approved.`);
  const cert = await db.prepare("SELECT * FROM certs WHERE serial = ?").bind(serial).first<CertRow>();
  const t = now();
  const run = `${c.run_id ?? "?"}.${c.run_attempt ?? "1"}`;
  const cause = row!.reason === "key-compromise" || row!.reason === "abuse";
  await db.batch([
    db.prepare("UPDATE revocations SET status = 'done', done_at = ? WHERE id = ? AND status = 'approved'").bind(t, id),
    db.prepare("UPDATE certs SET revoked_at = ?, revoke_reason = ? WHERE serial = ? AND revoked_at IS NULL").bind(t, row!.reason, serial),
    ...(cause && cert?.tier === "origin"
      ? [db.prepare("UPDATE certs SET revoked_at = ?, revoke_reason = ? WHERE origin_cert = ? AND revoked_at IS NULL").bind(t, row!.reason, serial)] : []),
    audit(db, "pipeline", run, "cert.revoked", `revocation:${id}`, { serial, reason: row!.reason, action: row!.action }),
  ]);
  log("pipeline.revoked", { request: id, serial });
  return json({ stored: true });
}

const STATEMENT_URL = /^https:\/\/[^\s/]+\/\S{1,500}\.wsig$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._,+~-]{0,63}$/;

/** sign job: the file certificate it made for each listed version (the signed release statement). Shown on the release. */
export async function pipelineFileCertificates(ctx: Ctx): Promise<Response> {
  const c = await pipelineAuth(ctx, "sign");
  const b = await readJson<{ file_certificates?: unknown }>(ctx.req, 256 * 1024);
  const list = b.file_certificates;
  if (!Array.isArray(list) || list.length < 1 || list.length > 1000) bad("Send 'file_certificates' as a list of 1 to 1000 entries.");
  const db = ctx.env.DB;
  const t = now();
  const run = `${c.run_id ?? "?"}.${c.run_attempt ?? "1"}`;
  const results: { listing_id: string; version: string; stored: string }[] = [];
  const stmts: D1PreparedStatement[] = [];
  for (const raw of list as Record<string, unknown>[]) {
    const listing = str(raw?.listing_id, "listing_id", 64);
    const version = str(raw?.version, "version", 64);
    if (!VERSION.test(version)) bad("'version' is not a version.");
    const serial = str(raw.serial, "serial", 16);
    if (!SERIAL.test(serial)) bad("'serial' is 16 lower-case hex digits.");
    const url = str(raw.url, "url", 512);
    if (!STATEMENT_URL.test(url)) bad("'url' is the https address of the statement's .wsig.");
    const checked = int(raw.checked_at, "checked_at", 1, Number.MAX_SAFE_INTEGER);
    if (raw.verdict !== "pass" && raw.verdict !== "flag") bad("'verdict' is pass or flag.");
    if (!(await db.prepare("SELECT 1 FROM releases WHERE listing_id = ? AND version = ?").bind(listing, version).first())) {
      results.push({ listing_id: listing, version, stored: "unknown-release" }); continue;
    }
    stmts.push(db.prepare(
      "INSERT INTO file_certificates (listing_id, version, serial, url, checked_at, verdict, run_id, stored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT (listing_id, version) DO UPDATE SET serial = excluded.serial, url = excluded.url, checked_at = excluded.checked_at, " +
      "verdict = excluded.verdict, run_id = excluded.run_id, stored_at = excluded.stored_at",
    ).bind(listing, version, serial, url, checked, raw.verdict as string, run, t));
    results.push({ listing_id: listing, version, stored: "stored" });
  }
  if (stmts.length) {
    stmts.push(audit(db, "pipeline", run, "file-certificates", null, { count: stmts.length }));
    await db.batch(stmts);
  }
  return json({ results });
}
