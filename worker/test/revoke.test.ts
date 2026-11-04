// SPDX-License-Identifier: GPL-2.0-or-later
// Revocations and downgrades from the panel: revoke (key-compromise, abuse) kills every certificate of the subject;
// downgrade revokes a trusted one as superseded and keeps origin; the ca job gets revoke files and reports them done.
import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  acceptCla, alice, appKey, bob, carol, claims, dave, FakeGitHub, type FakeUser, install, jwt, makeEnv, oidcKey, req, shiftClock, signIn, t0, termsAnswer, woltrustRequest,
} from "./harness";
import { b64url } from "../src/crypto";

let gh: FakeGitHub, undo: () => void, env: ReturnType<typeof makeEnv>, key: Awaited<ReturnType<typeof oidcKey>>;
beforeEach(async () => {
  gh = new FakeGitHub(); undo = install(gh);
  key = await oidcKey(gh);
  env = makeEnv({ GITHUB_PIPELINE_APP_PRIVATE_KEY: await appKey(gh) });
});
afterEach(() => undo());

const ORIGIN = "1111222233334444", TRUSTED = "0123456789abcdef";
const ca = async () => ({ authorization: `Bearer ${await jwt(key, claims("ca"))}` });
const sig = b64url(new Uint8Array(64).fill(7));
function wolcert(file: any, serial: string, over: Record<string, unknown> = {}) {
  const body = { serial, kind: file.kind, subject: file.subject, namespaces: file.namespaces, keys: file.keys, not_before: t0(), not_after: t0() + 365 * 86400, ...over };
  return JSON.stringify({ format: 1, body: b64url(new TextEncoder().encode(JSON.stringify(body))), sig: { ed25519: sig, second: sig } });
}
async function issue(cookie: string, tier: "origin" | "trusted", serial: string, approver?: string, who: FakeUser = alice) {
  const r = await req(env, "POST", "/api/cert/request", { cookie, body: { ...woltrustRequest({}, who), trust_terms: await termsAnswer(env, "trust"), certificate_terms: await termsAnswer(env, "certificates"), tier } });
  const id = ((await r.json()) as any).request.id;
  if (approver) await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: approver });
  const file = (await (await req(env, "GET", `/api/pipeline/requests/${id}`, { headers: await ca() })).json()) as any;
  const s = await req(env, "POST", "/api/pipeline/certs", { origin: null, headers: await ca(), body: { request_id: id, serial, cert: wolcert(file, serial) } });
  if (s.status !== 200) throw new Error("not issued: " + (await s.text()));
}
/** alice with an origin and a trusted certificate; carol and dave are owners. */
async function setup() {
  const c = await signIn(env, gh, alice);
  await acceptCla(env, c);
  const a = await signIn(env, gh, carol);
  await issue(c, "origin", ORIGIN);
  await issue(c, "trusted", TRUSTED, a);
  return { c, a };
}
const me = async (c: string) => ((await (await req(env, "GET", "/api/me", { cookie: c })).json()) as any).certs;
const revFile = async (id: string) => req(env, "GET", `/api/pipeline/requests/${id}`, { headers: await ca() });
const done = async (request_id: string, serial: string) => req(env, "POST", "/api/pipeline/revocations", { origin: null, headers: await ca(), body: { request_id, serial } });

test("revoke for key-compromise kills everything: both certificates get a revocation at once, the ca job reads and reports them", async () => {
  const { c, a } = await setup();
  expect(await me(c)).toEqual({ origin: "issued", trusted: "issued" });
  const before = gh.dispatches.length;
  expect((await req(env, "POST", `/api/admin/certs/${ORIGIN}/revoke`, { cookie: a, body: { reason: "superseded" } })).status).toBe(400);
  const r = await req(env, "POST", `/api/admin/certs/${ORIGIN}/revoke`, { cookie: a, body: { reason: "key-compromise", note: "Key on a public paste site." } });
  expect(r.status).toBe(200);
  const b = (await r.json()) as any;
  expect(b.group).toMatch(/^g-[0-9a-f]{16}$/);
  const rows = b.revocations.map((x: any) => [x.serial, x.action, x.reason, x.status, x.approved_by]).sort((x: any, y: any) => x[0].localeCompare(y[0]));
  expect(rows).toEqual([[TRUSTED, "revoke", "key-compromise", "approved", ["carol-ca"]], [ORIGIN, "revoke", "key-compromise", "approved", ["carol-ca"]]]);
  // one dispatch per revocation, the id is the request_id input
  const ids = b.revocations.map((x: any) => x.id);
  expect(gh.dispatches.slice(before).map((x) => (x.body.inputs as any).request_id)).toEqual(ids);
  // the revoke request file (hub-index request.schema.json action revoke)
  const origRev = b.revocations.find((x: any) => x.serial === ORIGIN);
  const f = (await (await revFile(origRev.id)).json()) as any;
  expect(f).toEqual({ format: 1, action: "revoke", id: origRev.id, serial: ORIGIN, reason: "key-compromise", approved_by: ["carol-ca"], note: "Key on a public paste site." });
  // still issued until the ca job says the revocation is on the list
  expect(await me(c)).toEqual({ origin: "issued", trusted: "issued" });
  expect((await done(origRev.id, TRUSTED)).status).toBe(409);
  expect((await done(origRev.id, ORIGIN)).status).toBe(200);
  // revoking origin for cause marks the trusted one built on it revoked too
  expect(await me(c)).toEqual({ origin: "revoked", trusted: "revoked" });
  const certs = (await (await req(env, "GET", "/api/certs/alice")).json()) as any;
  expect(certs.certs.every((x: any) => x.revoke_reason === "key-compromise" && x.revoked_at > 0)).toBe(true);
  expect(((await (await done(origRev.id, ORIGIN)).json()) as any).duplicate).toBe(true);
  expect((await revFile(origRev.id)).status).toBe(404); // done
  // the trusted one's own revocation is still fetched and reported
  const trustRev = b.revocations.find((x: any) => x.serial === TRUSTED);
  expect((await revFile(trustRev.id)).status).toBe(200);
  expect((await done(trustRev.id, TRUSTED)).status).toBe(200);
  // a second revoke finds nothing live
  expect((await req(env, "POST", `/api/admin/certs/${TRUSTED}/revoke`, { cookie: a, body: { reason: "abuse" } })).status).toBe(409);
  const log = env.DB.sqlite.query("SELECT action, detail FROM audit_log WHERE action IN ('cert.revoke','cert.revoked') ORDER BY id").all() as any[];
  expect(log.map((x) => x.action)).toEqual(["cert.revoke", "cert.revoked", "cert.revoked"]);
  expect(JSON.parse(log[0].detail)).toMatchObject({ actor: "carol-ca", role: "owner", reason: "key-compromise", note: "Key on a public paste site.", ip_class: "v4", waits_for_second: false });
});

test("after a revocation for cause the next origin request goes to a person, not the policy", async () => {
  const { a } = await setup();
  const r = (await (await req(env, "POST", `/api/admin/certs/${ORIGIN}/revoke`, { cookie: a, body: { reason: "key-compromise" } })).json()) as any;
  for (const x of r.revocations) await done(x.id, x.serial);
  const back = shiftClock(8 * 86400);
  try {
    const c = await signIn(env, gh, alice);
    const n = await req(env, "POST", "/api/cert/request", { cookie: c, body: { ...woltrustRequest(), trust_terms: await termsAnswer(env, "trust"), certificate_terms: await termsAnswer(env, "certificates"), tier: "origin" } });
    expect(((await n.json()) as any)).toMatchObject({ auto: false, request: { status: "pending", tier: "origin" } });
  } finally { back(); }
});

test("revoke for abuse waits for a second, different admin; nobody revokes their own certificate", async () => {
  const { a } = await setup();
  const before = gh.dispatches.length;
  const r = await req(env, "POST", `/api/admin/certs/${TRUSTED}/revoke`, { cookie: a, body: { reason: "abuse" } });
  expect(r.status).toBe(202);
  const b = (await r.json()) as any;
  expect(b.revocations.map((x: any) => x.status)).toEqual(["pending", "pending"]);
  expect(gh.dispatches.length).toBe(before);
  for (const x of b.revocations) expect((await revFile(x.id)).status).toBe(404); // not approved yet
  // the same admin again: refused
  expect(((await (await req(env, "POST", `/api/admin/revocations/${b.group}/approve`, { cookie: a })).json()) as any).error).toBe("second-admin");
  // the subject cannot revoke or approve for themselves
  const d = await signIn(env, gh, dave);
  const q = (await (await req(env, "GET", "/api/admin/queue", { cookie: d })).json()) as any;
  expect(q.revocations.map((x: any) => x.group)).toEqual([b.group, b.group]);
  const ok = await req(env, "POST", `/api/admin/revocations/${b.group}/approve`, { cookie: d });
  expect(ok.status).toBe(200);
  const ob = (await ok.json()) as any;
  expect(ob.revocations.map((x: any) => [x.status, x.approved_by])).toEqual([["approved", ["carol-ca", "Dave"]], ["approved", ["carol-ca", "Dave"]]]);
  expect(gh.dispatches.length).toBe(before + 2);
  const f = (await (await revFile(ob.revocations[0].id)).json()) as any;
  expect(f.approved_by).toEqual(["carol-ca", "Dave"]);
  // own certificate
  const cc = await signIn(env, gh, carol);
  await acceptCla(env, cc);
  await issue(cc, "origin", "5555666677778888", undefined, carol);
  const own = await req(env, "POST", "/api/admin/certs/5555666677778888/revoke", { cookie: cc, body: { reason: "key-compromise" } });
  expect([own.status, ((await own.json()) as any).error]).toEqual([403, "own-cert"]);
});

test("downgrade: a trusted certificate revoked as superseded; origin stays issued", async () => {
  const { c, a } = await setup();
  expect(((await (await req(env, "POST", `/api/admin/certs/${ORIGIN}/downgrade`, { cookie: a, body: { note: "x" } })).json()) as any).error).toBe("not-trusted");
  expect((await req(env, "POST", `/api/admin/certs/${TRUSTED}/downgrade`, { cookie: a })).status).toBe(400); // a note is required
  const r = await req(env, "POST", `/api/admin/certs/${TRUSTED}/downgrade`, { cookie: a, body: { note: "No longer maintained by a vetted team." } });
  expect(r.status).toBe(200);
  const b = (await r.json()) as any;
  expect(b.revocations.map((x: any) => [x.serial, x.action, x.reason, x.status])).toEqual([[TRUSTED, "downgrade", "superseded", "approved"]]);
  const f = (await (await revFile(b.revocations[0].id)).json()) as any;
  expect(f).toMatchObject({ action: "revoke", serial: TRUSTED, reason: "superseded" });
  expect((await req(env, "POST", `/api/admin/certs/${TRUSTED}/downgrade`, { cookie: a, body: { note: "again" } })).status).toBe(409);
  expect((await done(b.revocations[0].id, TRUSTED)).status).toBe(200);
  expect(await me(c)).toEqual({ origin: "issued", trusted: "revoked" });
  // a reviewer cannot downgrade or revoke
  const bb = await signIn(env, gh, bob);
  await req(env, "POST", "/api/admin/roles", { cookie: a, body: { login: "bob", role: "reviewer", reason: "r" } });
  expect((await req(env, "POST", `/api/admin/certs/${ORIGIN}/revoke`, { cookie: bb, body: { reason: "abuse" } })).status).toBe(403);
});

test("the ca job's revocation endpoints need its OIDC token and real ids", async () => {
  await setup();
  expect((await req(env, "GET", "/api/pipeline/requests/v-0000000000000000", { headers: { authorization: `Bearer ${await jwt(key, claims("sign"))}` } })).status).toBe(401);
  expect((await revFile("v-0000000000000000")).status).toBe(404);
  expect((await req(env, "POST", "/api/pipeline/revocations", { origin: null, body: { request_id: "v-1", serial: ORIGIN } })).status).toBe(401);
  expect((await done("r-0000000000000000", ORIGIN)).status).toBe(400);
  expect((await done("v-0000000000000000", ORIGIN)).status).toBe(404);
});
