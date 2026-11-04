// SPDX-License-Identifier: GPL-2.0-or-later
// The hub's accepted texts, from the repository's legal/ folder, each versioned and hashed (SHA-256 of exactly the
// bytes served; legal/README.md lists the same hashes, a test compares):
//   cla           the Contributor Licence Agreement, accepted at sign-in (legal/CLA.md; a person, or an org by an owner)
//   publisher     the Publisher Agreement, accepted before the first publish (legal/PUBLISHER-AGREEMENT.md)
//   trust         the Trust Terms, accepted with every certificate request (legal/TRUST-TERMS.md)
//   certificates  the Certificate Terms, accepted with every certificate request with the Trust Terms (legal/CERTIFICATE-TERMS.md)
// The files are bundled as text (wrangler.toml rules). A text's version is its "Version N, effective DATE." line;
// CLA_VERSION, when set, must name the CLA's. A new version must be accepted again.

import type { Ctx } from "./ctx";
import type { Env } from "./env";
import { now } from "./env";
import { sha256hex } from "./crypto";
import { fail, json, readJson, sameOrigin, str } from "./http";
import { requireSession } from "./session";
import { audit } from "./audit";
import CLA_TEXT from "../../legal/CLA.md" with { type: "text" };
import PUBLISHER_TEXT from "../../legal/PUBLISHER-AGREEMENT.md" with { type: "text" };
import TRUST_TEXT from "../../legal/TRUST-TERMS.md" with { type: "text" };
import CERTIFICATE_TEXT from "../../legal/CERTIFICATE-TERMS.md" with { type: "text" };

/** The version a text names on its "Version N, effective DATE." line. */
export const textVersion = (text: string) => text.match(/^Version ([0-9A-Za-z.-]{1,32}), /m)?.[1] ?? null;

export const DOCS = ["cla", "publisher", "trust", "certificates"] as const;
export type Doc = (typeof DOCS)[number];
export const DOC_NAMES: Record<Doc, string> = {
  cla: "Contributor Licence Agreement", publisher: "Publisher Agreement", trust: "Trust Terms", certificates: "Certificate Terms",
};

const byVersion = (text: string): Record<string, string> => ({ [textVersion(text) ?? "unversioned"]: text });
/** Known texts per document and version (tests add versions). */
export const TEXTS: Record<Doc, Record<string, string>> = {
  cla: byVersion(CLA_TEXT), publisher: byVersion(PUBLISHER_TEXT), trust: byVersion(TRUST_TEXT), certificates: byVersion(CERTIFICATE_TEXT),
};
export const CLAS = TEXTS.cla;
const CURRENT: Record<Doc, string> = {
  cla: textVersion(CLA_TEXT)!, publisher: textVersion(PUBLISHER_TEXT)!, trust: textVersion(TRUST_TEXT)!, certificates: textVersion(CERTIFICATE_TEXT)!,
};

export interface Text { doc: Doc; version: string; text: string; sha256: string }
export interface Cla { version: string; text: string; sha256: string }

export async function currentText(env: Env, doc: Doc, versionOver?: string): Promise<Text> {
  const version = versionOver ?? (doc === "cla" ? env.CLA_VERSION ?? CURRENT.cla : CURRENT[doc]);
  const text = TEXTS[doc][version];
  if (text === undefined) throw new Error(`no ${doc} text for version ${version}`);
  return { doc, version, text, sha256: await sha256hex(text) };
}

export async function currentCla(env: Env): Promise<Cla> {
  const { version, text, sha256 } = await currentText(env, "cla");
  return { version, text, sha256 };
}

export interface ClaStatus { current: string; accepted: string | null; accepted_at: number | null; ok: boolean }

export async function claStatus(env: Env, kind: "person" | "org", id: number): Promise<ClaStatus> {
  const cla = await currentCla(env);
  const row = await env.DB.prepare(
    "SELECT version, accepted_at FROM cla_acceptances WHERE subject_kind = ? AND subject_id = ? ORDER BY accepted_at DESC, id DESC LIMIT 1",
  ).bind(kind, id).first<{ version: string; accepted_at: number }>();
  return { current: cla.version, accepted: row?.version ?? null, accepted_at: row?.accepted_at ?? null, ok: row?.version === cla.version };
}

/** Throws unless the subject accepted the current CLA. */
export async function requireCla(env: Env, kind: "person" | "org", id: number): Promise<void> {
  const s = await claStatus(env, kind, id);
  if (!s.ok) {
    fail(403, kind === "person" ? "cla-needed" : "org-cla-needed",
      kind === "person"
        ? `Accept the contributor agreement (version ${s.current}) before you publish.`
        : `An owner of this organisation must accept the contributor agreement (version ${s.current}) first.`);
  }
}

/** Publisher Agreement and Trust Terms: what the person accepted last. */
export async function termsStatus(env: Env, doc: "publisher" | "trust", githubId: number): Promise<ClaStatus> {
  const cur = await currentText(env, doc);
  const row = await env.DB.prepare(
    "SELECT version, accepted_at FROM terms_acceptances WHERE doc = ? AND github_id = ? ORDER BY accepted_at DESC, id DESC LIMIT 1",
  ).bind(doc, githubId).first<{ version: string; accepted_at: number }>();
  return { current: cur.version, accepted: row?.version ?? null, accepted_at: row?.accepted_at ?? null, ok: row?.version === cur.version };
}

export async function requireTerms(env: Env, doc: "publisher" | "trust", githubId: number): Promise<void> {
  const s = await termsStatus(env, doc, githubId);
  if (!s.ok) fail(403, `${doc}-terms-needed`, `Accept the ${DOC_NAMES[doc]} (version ${s.current}) first.`);
}

/** Checks that a body names the current version of a text and the hash of exactly that text. */
export async function acceptedText(env: Env, doc: Doc, body: Record<string, unknown>): Promise<Text> {
  const cur = await currentText(env, doc);
  const v = str(body.cla_version ?? body.version, "version", 64);
  const h = str(body.cla_sha256 ?? body.sha256, "sha256", 64);
  if (v !== cur.version || h !== cur.sha256) {
    fail(409, doc === "cla" ? "cla-changed" : "terms-changed", `The ${DOC_NAMES[doc]} changed. Read the current version and accept it again.`);
  }
  return cur;
}

export const acceptedBody = (env: Env, body: Record<string, unknown>): Promise<Cla> => acceptedText(env, "cla", body);

/** The statements that record a person's acceptance of the Publisher Agreement or the Trust Terms. */
export function acceptTerms(db: D1Database, doc: "publisher" | "trust", githubId: number, t: Text): D1PreparedStatement[] {
  return [
    db.prepare("INSERT OR IGNORE INTO terms_acceptances (doc, github_id, version, sha256, accepted_at) VALUES (?, ?, ?, ?, ?)")
      .bind(doc, githubId, t.version, t.sha256, now()),
    audit(db, "person", githubId, `${doc}.accept`, `person:${githubId}`, { version: t.version }),
  ];
}

export async function getCla(ctx: Ctx): Promise<Response> {
  const cla = await currentCla(ctx.env);
  return json(cla, 200, { "cache-control": "public, max-age=300" });
}

export async function postCla(ctx: Ctx): Promise<Response> {
  sameOrigin(ctx.req, ctx.env);
  const s = await requireSession(ctx);
  const cla = await acceptedBody(ctx.env, await readJson(ctx.req));
  const db = ctx.env.DB;
  await db.batch([
    db.prepare(
      "INSERT OR IGNORE INTO cla_acceptances (subject_kind, subject_id, version, sha256, accepted_by, accepted_at) VALUES ('person', ?, ?, ?, ?, ?)",
    ).bind(s.person.github_id, cla.version, cla.sha256, s.person.github_id, now()),
    audit(db, "person", s.person.github_id, "cla.accept", `person:${s.person.github_id}`, { version: cla.version }),
  ]);
  return json({ cla: await claStatus(ctx.env, "person", s.person.github_id) });
}

const docOf = (name: string): Doc => {
  if (!DOCS.includes(name as Doc)) fail(404, "no-terms", "There is no such text. Ask for cla, publisher, trust or certificates.");
  return name as Doc;
};

/** GET /api/terms/<cla|publisher|trust|certificates>: {doc, version, text, sha256}. */
export async function getTerms(ctx: Ctx, name: string): Promise<Response> {
  return json(await currentText(ctx.env, docOf(name)), 200, { "cache-control": "public, max-age=300" });
}

/** POST /api/terms/<cla|publisher|trust> {version, sha256}: accept the current text. */
export async function postTerms(ctx: Ctx, name: string): Promise<Response> {
  const doc = docOf(name);
  if (doc === "cla") return postCla(ctx);
  if (doc === "certificates") return fail(400, "with-the-request", "The Certificate Terms are accepted with each certificate request (certificate_terms), not on their own.");
  sameOrigin(ctx.req, ctx.env);
  const s = await requireSession(ctx);
  const t = await acceptedText(ctx.env, doc, await readJson(ctx.req));
  await ctx.env.DB.batch(acceptTerms(ctx.env.DB, doc, s.person.github_id, t));
  return json({ terms: { [doc]: await termsStatus(ctx.env, doc, s.person.github_id) } });
}
