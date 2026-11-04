// SPDX-License-Identifier: GPL-2.0-or-later
// I9: the hub-index pipeline calls these with a GitHub Actions OIDC token. No shared secret:
// the Worker checks the token's signature and its issuer, audience, repository, workflow_ref,
// ref, environment and runner. The check job fetches pending releases and posts verdicts;
// the sign job reads the export; the ca job reads approved certificate requests and reports
// the certificates it issued (certs.ts). The Worker never signs, downloads or hashes an artefact.

import type { Ctx } from "./ctx";
import type { Env } from "./env";
import { now, oidcIssuer } from "./env";
import { fromUtf8, unb64url, utf8 } from "./crypto";
import { fail, json, LIMITS, readJson, str } from "./http";
import { limit, RULES } from "./ratelimit";
import { buildIndex } from "./preview";
import { audit } from "./audit";
import { log } from "./log";

export type Job = "check" | "sign" | "ca";
export const SKEW = 60;
export const MAX_TOKEN_AGE = 15 * 60;

export interface Claims {
  iss: string; aud: string | string[]; sub: string; exp: number; iat: number; nbf?: number;
  repository: string; repository_id?: string; repository_owner?: string; workflow_ref: string; job_workflow_ref?: string;
  job_workflow_sha?: string; ref: string; environment?: string; event_name?: string; run_id?: string;
  run_attempt?: string; runner_environment?: string;
}

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }

const memJwks = new Map<string, { at: number; keys: Jwk[] }>();
export const resetJwksCache = () => memJwks.clear();

async function jwks(env: Env, force: boolean): Promise<Jwk[]> {
  const iss = oidcIssuer(env);
  const m = memJwks.get(iss);
  if (!force && m && now() - m.at < 600) return m.keys;
  const kvKey = `jwks:${iss}`;
  if (!force) {
    const cached = await env.KV.get(kvKey, "json") as { at: number; keys: Jwk[] } | null;
    if (cached && now() - cached.at < 3600) { memJwks.set(iss, cached); return cached.keys; }
  }
  const r = await fetch(`${iss}/.well-known/jwks`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) fail(503, "jwks-unavailable", "GitHub's token keys could not be fetched. Try again.");
  const body = (await r.json()) as { keys?: Jwk[] };
  const keys = (body.keys ?? []).filter((k) => k.kty === "RSA" && typeof k.kid === "string");
  const entry = { at: now(), keys };
  memJwks.set(iss, entry);
  await env.KV.put(kvKey, JSON.stringify(entry), { expirationTtl: 3600 }); // at most ~24 writes a day
  return keys;
}

const deny = (why: string): never => fail(401, "pipeline-token", `The pipeline token was refused: ${why}.`);

/** Verifies a GitHub Actions OIDC token for one job of the hub-index pipeline. */
export async function verifyPipelineToken(env: Env, token: string, job: Job): Promise<Claims> {
  const parts = token.split(".");
  if (parts.length !== 3 || token.length > 8192) deny("not a token");
  let header: { alg: string; kid: string; typ?: string }, claims: Claims;
  try {
    header = JSON.parse(fromUtf8(unb64url(parts[0])));
    claims = JSON.parse(fromUtf8(unb64url(parts[1])));
  } catch {
    return deny("not a token");
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") deny("wrong algorithm");
  let key = (await jwks(env, false)).find((k) => k.kid === header.kid);
  if (!key) key = (await jwks(env, true)).find((k) => k.kid === header.kid);
  if (!key) deny("unknown key");
  const ck = await crypto.subtle.importKey("jwk", { kty: "RSA", n: key!.n, e: key!.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", ck, unb64url(parts[2]), utf8(parts[0] + "." + parts[1]));
  if (!ok) deny("bad signature");

  const t = now();
  if (claims!.iss !== oidcIssuer(env)) deny("wrong issuer");
  const aud = Array.isArray(claims!.aud) ? claims!.aud : [claims!.aud];
  if (!aud.includes(env.OIDC_AUDIENCE)) deny("wrong audience");
  if (typeof claims!.exp !== "number" || claims!.exp < t - SKEW) deny("expired");
  if (typeof claims!.iat !== "number" || claims!.iat > t + SKEW || claims!.iat < t - MAX_TOKEN_AGE) deny("issued at a wrong time");
  if (claims!.nbf !== undefined && claims!.nbf > t + SKEW) deny("not valid yet");
  if (claims!.repository !== env.PIPELINE_REPOSITORY) deny("wrong repository");
  const wf = { check: env.PIPELINE_CHECK_WORKFLOW, sign: env.PIPELINE_SIGN_WORKFLOW, ca: env.PIPELINE_CA_WORKFLOW }[job];
  const envName = { check: env.PIPELINE_CHECK_ENVIRONMENT, sign: env.PIPELINE_SIGN_ENVIRONMENT, ca: env.PIPELINE_CA_ENVIRONMENT }[job];
  if (!wf || !envName) deny("this job is not set up");
  if (claims!.workflow_ref !== wf) deny("wrong workflow");
  if (claims!.ref !== "refs/heads/main") deny("wrong branch");
  if (claims!.environment !== envName) deny("wrong environment");
  if (claims!.event_name && claims!.event_name.startsWith("pull_request")) deny("pull requests may not report");
  if (claims!.runner_environment !== "github-hosted") deny("not a GitHub-hosted runner");
  return claims!;
}

export async function pipelineAuth(ctx: Ctx, job: Job): Promise<Claims> {
  const h = ctx.req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer ")) deny("missing");
  const c = await verifyPipelineToken(ctx.env, h.slice(7).trim(), job);
  await limit(ctx.env, RULES.pipeline, `${job}:${c.run_id ?? "?"}`);
  return c;
}

export async function pending(ctx: Ctx): Promise<Response> {
  await pipelineAuth(ctx, "check");
  const rows = (await ctx.env.DB.prepare(
    `SELECT r.listing_id, r.version, r.tag, r.asset_name, r.asset_url, r.size, r.first_seen,
       l.kind, l.host, l.repo, l.repo_id, l.owner_kind, l.owner_id,
       (SELECT p.version FROM releases p WHERE p.listing_id = r.listing_id AND p.verdict IN ('pass','flag')
          AND p.yanked_at IS NULL ORDER BY p.first_seen DESC LIMIT 1) AS previous
     FROM releases r JOIN listings l ON l.id = r.listing_id
     WHERE r.verdict = 'pending' AND r.yanked_at IS NULL AND l.status != 'withdrawn'
     ORDER BY r.first_seen LIMIT 200`,
  ).all()).results;
  return json({ releases: rows });
}

const VERDICTS = ["pass", "flag", "block", "not-checked"] as const;
const HEX64 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;

interface Finding { rule: string; sentence: string; evidence: string }

/** What hubcheck reports about the signature (I7). wolos, verified and community are index trust levels;
 * withdrawn and invalid are kept in release_facts and the release stays community, without a cert. */
export const SIG_TRUST = ["wolos", "verified", "community", "withdrawn", "invalid"] as const;
const INDEX_TRUST = new Set(["wolos", "verified", "community"]);
const SERIAL = /^[0-9a-f]{16}$/;
const WORD = /^[\x21-\x7e]{1,64}$/;
const MIN_WOLOS = /^([0-9]{1,4}\.[0-9]{1,4}(\.[0-9]{1,4})?)?$/;

/** A list of at most 16 short printable words (plugin kinds, permissions), or null when absent. */
function words(v: unknown, field: string): string[] | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || v.length > 16 || v.some((w) => typeof w !== "string" || !WORD.test(w))) {
    fail(400, "bad-field", `'${field}' is a list of at most 16 words of printable characters.`);
  }
  return [...new Set(v as string[])];
}

export interface Facts { kinds: string[] | null; permissions: string[] | null; min_wolos: string | null; trust: string | null; cert: string | null }

/** The optional facts a verdict carries about the file (from hubcheck's report). */
export function factsOf(raw: Record<string, unknown>): Facts {
  const kinds = words(raw.kinds, "kinds");
  const permissions = words(raw.permissions, "permissions");
  let min: string | null = null;
  if (raw.min_wolos !== undefined && raw.min_wolos !== null) {
    if (typeof raw.min_wolos !== "string" || !MIN_WOLOS.test(raw.min_wolos)) fail(400, "bad-field", "'min_wolos' is a version like 0.13 or 0.13.1.");
    min = (raw.min_wolos as string) || null;
  }
  let trust: string | null = null;
  if (raw.trust !== undefined && raw.trust !== null) {
    if (!SIG_TRUST.includes(raw.trust as never)) fail(400, "bad-field", `'trust' is one of ${SIG_TRUST.join(", ")}.`);
    trust = raw.trust as string;
  }
  let cert: string | null = null;
  if (raw.cert !== undefined && raw.cert !== null) {
    if (typeof raw.cert !== "string" || !SERIAL.test(raw.cert)) fail(400, "bad-field", "'cert' is a certificate serial, 16 hex digits.");
    cert = raw.cert as string;
  }
  return { kinds, permissions, min_wolos: min, trust, cert };
}

export async function postVerdicts(ctx: Ctx): Promise<Response> {
  const c = await pipelineAuth(ctx, "check");
  const b = await readJson<{ verdicts?: unknown }>(ctx.req, LIMITS.verdicts);
  if (!Array.isArray(b.verdicts) || b.verdicts.length < 1 || b.verdicts.length > 100) {
    fail(400, "bad-verdicts", "Send 'verdicts' as a list of 1 to 100 entries.");
  }
  const db = ctx.env.DB;
  const results: { listing_id: string; version: string; stored: string }[] = [];
  const run = `${c.run_id ?? "?"}.${c.run_attempt ?? "1"}`;
  for (const raw of b.verdicts as Record<string, unknown>[]) {
    const listing = str(raw?.listing_id, "listing_id", 128);
    const version = str(raw?.version, "version", 64);
    let verdict = str(raw?.verdict, "verdict", 16) as (typeof VERDICTS)[number];
    if (!VERDICTS.includes(verdict)) fail(400, "bad-verdict", "verdict is pass, flag, block or not-checked.");
    const sha = raw.sha256 === undefined || raw.sha256 === null ? null : str(raw.sha256, "sha256", 64).toLowerCase();
    if (sha !== null && !HEX64.test(sha)) fail(400, "bad-sha256", "sha256 is 64 hex digits.");
    if (sha === null && verdict !== "not-checked") fail(400, "bad-sha256", "Only a not-checked verdict may come without sha256.");
    const size = raw.size === undefined || raw.size === null ? null : Number(raw.size);
    if (size !== null && (!Number.isSafeInteger(size) || size < 0)) fail(400, "bad-size", "size is a whole number of bytes.");
    const commit = raw.commit === undefined || raw.commit === null ? null : str(raw.commit, "commit", 40).toLowerCase();
    if (commit !== null && !SHA1.test(commit)) fail(400, "bad-commit", "commit is a 40-digit hex id.");
    const fl = raw.findings === undefined ? [] : raw.findings;
    if (!Array.isArray(fl) || fl.length > 200) fail(400, "bad-findings", "findings is a list of at most 200 entries.");
    const findings: Finding[] = (fl as Record<string, unknown>[]).map((f) => ({
      rule: str(f?.rule, "findings.rule", 64), sentence: str(f?.sentence, "findings.sentence", 500),
      evidence: f?.evidence === undefined ? "" : str(f.evidence, "findings.evidence", 1000, 0),
    }));
    const facts = factsOf(raw);

    const rel = await db.prepare("SELECT sha256, yanked_at FROM releases WHERE listing_id = ? AND version = ?")
      .bind(listing, version).first<{ sha256: string | null; yanked_at: number | null }>();
    if (!rel) { results.push({ listing_id: listing, version, stored: "unknown-release" }); continue; }
    if (rel.sha256 && sha && rel.sha256 !== sha) {
      // The file behind the same tag changed: the pinned hash wins and the release is blocked.
      verdict = "block";
      findings.unshift({ rule: "asset-changed", sentence: "The release file changed after it was first checked.", evidence: `${rel.sha256} -> ${sha}` });
    }
    const t = now();
    const keepSha = rel.sha256 ?? sha;
    // The trust the index shows: the signature's, when it is one the index knows; otherwise community.
    const indexTrust = facts.trust === null ? null : INDEX_TRUST.has(facts.trust) ? facts.trust : "community";
    const hasFacts = facts.kinds || facts.permissions || facts.min_wolos || facts.trust || facts.cert;
    await db.batch([
      db.prepare(
        "INSERT OR IGNORE INTO verdicts (listing_id, version, verdict, sha256, size, findings, run_id, workflow_sha, posted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(listing, version, verdict, sha, size, JSON.stringify(findings), run, c.job_workflow_sha ?? null, t),
      db.prepare(
        "UPDATE releases SET verdict = ?, sha256 = ?, size = coalesce(?, size), commit_sha = coalesce(?, commit_sha), checked_at = ?, trust = coalesce(?, trust) WHERE listing_id = ? AND version = ?",
      ).bind(verdict, keepSha, size, commit, t, indexTrust, listing, version),
      ...(hasFacts ? [db.prepare(
        "INSERT INTO release_facts (listing_id, version, kinds, permissions, min_wolos, signature, cert, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT (listing_id, version) DO UPDATE SET kinds = excluded.kinds, permissions = excluded.permissions, min_wolos = excluded.min_wolos, " +
        "signature = excluded.signature, cert = excluded.cert, updated_at = excluded.updated_at",
      ).bind(listing, version, facts.kinds && JSON.stringify(facts.kinds), facts.permissions && JSON.stringify(facts.permissions),
        facts.min_wolos, facts.trust, facts.cert, t)] : []),
      db.prepare(
        `UPDATE listings SET updated_at = ?, status = CASE
           WHEN EXISTS (SELECT 1 FROM releases r WHERE r.listing_id = listings.id AND r.verdict IN ('pass','flag') AND r.yanked_at IS NULL) THEN 'listed'
           WHEN EXISTS (SELECT 1 FROM releases r WHERE r.listing_id = listings.id AND r.verdict = 'pending') THEN 'checking'
           ELSE 'draft' END
         WHERE id = ? AND status != 'withdrawn'`,
      ).bind(t, listing),
      audit(db, "pipeline", run, `verdict.${verdict}`, `listing:${listing}`, { version, sha256: sha, findings: findings.length, ...(facts.trust ? { trust: facts.trust } : {}), ...(facts.cert ? { cert: facts.cert } : {}) }),
    ]);
    results.push({ listing_id: listing, version, stored: verdict });
  }
  log("pipeline.verdicts", { run, count: results.length });
  return json({ results });
}

export async function exportIndex(ctx: Ctx): Promise<Response> {
  await pipelineAuth(ctx, "sign");
  const idx = await buildIndex(ctx.env);
  return json({ ...idx, preview: false });
}
