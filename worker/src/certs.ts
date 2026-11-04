// SPDX-License-Identifier: GPL-2.0-or-later
// Author certificates (ADR 0046). A signed-in person with the CLA sends the request `wol cert request`
// made (woltrust request::Request); the hub checks its shape and the account with GitHub, never the
// proof's signature (`woltrust issue --proof` in the ca workflow does). A hub admin approves it
// (admin.ts), the Worker starts the ca workflow, the ca job fetches the request file here with its
// OIDC token and reports the certificate back, and the certificate is shown on the subject's page.

import type { Ctx } from "./ctx";
import type { Env } from "./env";
import { now } from "./env";
import { hex, random, sha256hex, unb64url } from "./crypto";
import { fail, json, readJson, sameOrigin, str } from "./http";
import { requireSession } from "./session";
import { requireCla } from "./cla";
import { getOrgMembership, getUser, hubRole } from "./github";
import { namespaceOf, RESERVED } from "./listings";
import { pipelineAuth } from "./pipeline";
import { limit, RULES } from "./ratelimit";
import { audit } from "./audit";
import { log } from "./log";

export const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const LOGIN = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/;
const NAMESPACE = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*\.$/;
const SERIAL = /^[0-9a-f]{16}$/;
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

export async function postCertRequest(ctx: Ctx): Promise<Response> {
  sameOrigin(ctx.req, ctx.env);
  const s = await requireSession(ctx);
  await limit(ctx.env, RULES.writePerson, s.person.github_id);
  await requireCla(ctx.env, "person", s.person.github_id);
  const r = requestShape(await readJson(ctx.req));
  await limit(ctx.env, RULES.certRequests, s.person.github_id);
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
  const id = `r-${hex(random(8))}`;
  const t = now();
  await db.batch([
    db.prepare(
      "INSERT INTO cert_requests (id, kind, subject_id, login, requested_by, ed25519, body, verified_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
    ).bind(id, r.kind, r.subject.github_id, r.subject.login, s.person.github_id, r.keys.ed25519, JSON.stringify(r), t, t),
    audit(db, "person", s.person.github_id, "cert.request", `request:${id}`, { kind: r.kind, subject: r.subject.github_id, key: await keyId(r.keys.ed25519) }),
  ]);
  const row = await db.prepare("SELECT * FROM cert_requests WHERE id = ?").bind(id).first<RequestRow>();
  return json({ request: await requestView(ctx.env, row!) }, 201);
}

/** What the requester and the admins see of a request. */
export async function requestView(env: Env, row: RequestRow, admin = false) {
  const b = JSON.parse(row.body) as RequestBody;
  const cert = row.status === "issued" && row.serial
    ? await env.DB.prepare("SELECT cert FROM certs WHERE serial = ?").bind(row.serial).first<{ cert: string }>()
    : null;
  return {
    id: row.id, kind: row.kind, subject: b.subject, namespaces: b.namespaces, key_id: await keyId(row.ed25519),
    encryption: !!b.keys.x25519, months: b.months, requested_at: b.requested_at, verified_at: row.verified_at,
    status: row.status, created_at: row.created_at, decided_at: row.decided_at, approved_by: row.status === "refused" ? null : row.decided_login,
    reason: row.reason, serial: row.serial, cert: cert?.cert ?? null,
    ...(admin ? { requested_by: row.requested_by, dispatched_at: row.dispatched_at, dispatch_error: row.dispatch_error } : {}),
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
    "SELECT serial, kind, login, not_before, not_after, issued_at, cert FROM certs WHERE lower(login) = lower(?) ORDER BY issued_at DESC, serial LIMIT 20",
  ).bind(login).all()).results;
  return json({ login, certs: rows }, 200, { "cache-control": "public, max-age=60" });
}

/** ca job: the request file of an approved request that has no certificate yet. */
export async function pipelineRequest(ctx: Ctx, id: string): Promise<Response> {
  const c = await pipelineAuth(ctx, "ca");
  const row = REQUEST_ID.test(id)
    ? await ctx.env.DB.prepare("SELECT * FROM cert_requests WHERE id = ?").bind(id).first<RequestRow>() : null;
  if (!row || row.status !== "approved" || !row.decided_login || !row.decided_at) {
    fail(404, "no-request", "There is no approved request with this id that waits for a certificate.");
  }
  const b = JSON.parse(row!.body) as RequestBody;
  log("pipeline.request", { request: id, run: c.run_id ?? "?" });
  // The request file of hub-index schema/request.schema.json, in its order.
  return json({
    format: 1, action: "issue", id: row!.id, kind: b.kind, subject: b.subject, namespaces: b.namespaces, keys: b.keys, proof: b.proof,
    ...(b.level ? { level: b.level } : {}), months: b.months, requested_at: b.requested_at,
    verified_at: row!.verified_at, approved_by: [row!.decided_login], approved_at: row!.decided_at,
  });
}

interface CertBody {
  serial?: unknown; kind?: unknown; subject?: { github_id?: unknown }; namespaces?: unknown;
  keys?: { ed25519?: unknown }; not_before?: unknown; not_after?: unknown;
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
  const text = b.cert as string;
  const db = ctx.env.DB;
  const row = await db.prepare("SELECT * FROM cert_requests WHERE id = ?").bind(id).first<RequestRow>();
  if (!row) fail(404, "no-request", "There is no request with this id.");
  if (row!.status === "issued") {
    if (row!.serial === serial) return json({ stored: true, duplicate: true });
    fail(409, "already-issued", `Request ${id} already has the certificate ${row!.serial}.`);
  }
  if (row!.status !== "approved") fail(409, "not-approved", `Request ${id} is ${row!.status}, not approved.`);
  // The certificate must be the one asked for: same serial, kind, subject, namespaces and signing key.
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
    : !Number.isSafeInteger(body.not_before) || !Number.isSafeInteger(body.not_after) ? "validity" : null;
  if (mismatch) fail(409, "cert-mismatch", `The certificate does not match request ${id} (${mismatch}).`);
  if (await db.prepare("SELECT 1 FROM certs WHERE serial = ?").bind(serial).first()) fail(409, "serial-taken", `Serial ${serial} is already known.`);
  const t = now();
  const run = `${c.run_id ?? "?"}.${c.run_attempt ?? "1"}`;
  const res = await db.batch([
    db.prepare("UPDATE cert_requests SET status = 'issued', serial = ? WHERE id = ? AND status = 'approved'").bind(serial, id),
    db.prepare(
      "INSERT INTO certs (serial, request_id, kind, subject_id, login, not_before, not_after, cert, run_id, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(serial, id, row!.kind, row!.subject_id, row!.login, body.not_before as number, body.not_after as number, text, run, t),
    audit(db, "pipeline", run, "cert.issued", `request:${id}`, { serial, subject: row!.subject_id }),
  ]);
  if (!res[0].meta.changes) fail(409, "not-approved", `Request ${id} changed while the certificate was stored.`);
  log("pipeline.cert", { request: id, serial });
  return json({ stored: true });
}
