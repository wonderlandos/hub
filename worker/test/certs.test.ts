// SPDX-License-Identifier: GPL-2.0-or-later
// Certificate requests, two tiers: origin approved by policy (every gate tested), trusted approved by a person and
// built on a live origin certificate; shape, account checks, the ca dispatch, the ca job's endpoints.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  acceptCla, alice, appKey, bytes, t0, termsAnswer, woltrustRequest, bob, carol, claims, dave, FakeGitHub, type FakeUser, install, jwt, makeEnv, oidcKey, req, shiftClock, signIn,
} from "./harness";
import { b64url } from "../src/crypto";
import { keyId, requestShape } from "../src/certs";
import { pkcs8Der } from "../src/ghapp";

let gh: FakeGitHub, undo: () => void, env: ReturnType<typeof makeEnv>, key: Awaited<ReturnType<typeof oidcKey>>;
beforeEach(async () => {
  gh = new FakeGitHub(); undo = install(gh);
  key = await oidcKey(gh);
  env = makeEnv({ GITHUB_PIPELINE_APP_PRIVATE_KEY: await appKey(gh) });
});
afterEach(() => undo());

/** What the site sends: the woltrust request and the Trust Terms accepted with it. */
const withTerms = async (r: Record<string, unknown>) => ({ ...r, trust_terms: await termsAnswer(env, "trust") });
const ca = async (over: Record<string, unknown> = {}) => ({ authorization: `Bearer ${await jwt(key, claims("ca", over))}` });

async function asPerson(u = alice) {
  const c = await signIn(env, gh, u);
  await acceptCla(env, c);
  return c;
}
async function send(c: string, over: Record<string, unknown> = {}, u = alice, tier?: "origin" | "trusted") {
  const r = await req(env, "POST", "/api/cert/request", { cookie: c, body: { ...(await withTerms(woltrustRequest(over, u))), ...(tier ? { tier } : {}) } });
  return { r, body: (await r.json()) as any };
}
async function requestAs(u = alice, over: Record<string, unknown> = {}, tier?: "origin" | "trusted") {
  const c = await asPerson(u);
  return { c, ...(await send(c, over, u, tier)) };
}
/** A .wolcert as woltrust issue prints it, for the request: only its body matters to the Worker. */
function wolcert(file: any, serial = "0123456789abcdef", over: Record<string, unknown> = {}) {
  const body = {
    serial, kind: file.kind, subject: { github_id: file.subject.github_id, login: file.subject.login, name: file.subject.name },
    namespaces: file.namespaces, usage: ["sign-package"], keys: file.keys, issuer: "fedcba9876543210",
    not_before: t0(), not_after: t0() + 365 * 86400, level: "verified", verified_at: file.verified_at, ...over,
  };
  return JSON.stringify({ format: 1, body: b64url(new TextEncoder().encode(JSON.stringify(body))), sig: { ed25519: bytes(64), second: bytes(3309) } });
}

const ORIGIN_SERIAL = "1111222233334444";
const TRUSTED_SERIAL = "0123456789abcdef";
const fetchFile = async (id: string) => req(env, "GET", `/api/pipeline/requests/${id}`, { headers: await ca() });
const postCert = async (b: unknown) => req(env, "POST", "/api/pipeline/certs", { origin: null, headers: await ca(), body: b });

/** The whole origin path for a person: request (approved by policy), the ca job fetches it and reports the certificate. */
async function withOrigin(u: FakeUser = alice, serial = ORIGIN_SERIAL) {
  const { c, r, body } = await requestAs(u, {}, "origin");
  if (r.status !== 201 || !body.auto) throw new Error("origin request not auto-approved: " + JSON.stringify(body));
  const file = (await (await fetchFile(body.request.id)).json()) as any;
  const stored = await postCert({ request_id: body.request.id, serial, tier: "origin", cert: wolcert(file, serial) });
  if (stored.status !== 200) throw new Error("origin cert not stored: " + (await stored.text()));
  return { c, id: body.request.id as string, file };
}
/** A trusted request on top of a live origin certificate. */
async function trustedAs(u: FakeUser = alice, over: Record<string, unknown> = {}) {
  const { c } = await withOrigin(u);
  const { r, body } = await send(c, over, u, "trusted");
  return { c, r, body };
}
const auditOf = (target: string) => env.DB.sqlite.query("SELECT actor_kind, actor_id, action, detail FROM audit_log WHERE target = ? ORDER BY id").all(target) as any[];

test("origin: every gate holds, so the policy approves it, starts ca.yml, and the file carries cla_accepted_at, no approval", async () => {
  const { c, r, body } = await requestAs(alice, {}, "origin");
  expect(r.status).toBe(201);
  const id = body.request.id as string;
  expect(id).toMatch(/^r-[0-9a-f]{16}$/);
  expect(body).toMatchObject({ auto: true, dispatched: true, request: { tier: "origin", status: "approved", approved_by: "policy", auto: true, origin_cert: null } });
  expect(body.request.key_id).toBe(await keyId(woltrustRequest().keys.ed25519));
  // the dispatch: the pipeline App's token, one repository, actions: write; ca.yml on main with the id
  expect(gh.installTokenBodies).toEqual([{ repositories: ["hub-index"], permissions: { actions: "write" } }]);
  expect(gh.dispatches).toEqual([{ path: "/repos/wonderlandos/hub-index/actions/workflows/ca.yml/dispatches", token: "ghs_installationtoken000000000",
    body: { ref: "main", inputs: { request_id: id, dry_run: "false" } } }]);
  // every gate and its value is in audit_log with the policy's approval
  const log = auditOf(`request:${id}`);
  expect(log.map((x) => [x.actor_kind, x.actor_id, x.action])).toEqual([["person", "1001", "cert.request"], ["system", "policy", "cert.approve"], ["system", "policy", "cert.dispatch"]]);
  const gates = JSON.parse(log[1].detail);
  expect(gates.approved_by).toBe("policy");
  expect(gates.gates).toMatchObject({ cla: true, publisher: true, trust_terms: "1", two_factor: true, open_request: null, refused_before: false, revoked_for_cause: false, last_origin_request: null });
  expect(gates.gates.account_age_days).toBeGreaterThan(30);
  // only the ca job reads the file; origin: cla_accepted_at, no approved_by
  expect((await req(env, "GET", `/api/pipeline/requests/${id}`, { headers: { authorization: `Bearer ${await jwt(key, claims("check"))}` } })).status).toBe(401);
  expect((await req(env, "GET", `/api/pipeline/requests/${id}`, { headers: await ca({ environment: "sign" }) })).status).toBe(401);
  const file = (await (await fetchFile(id)).json()) as any;
  expect(Object.keys(file)).toEqual(["format", "action", "id", "tier", "kind", "subject", "namespaces", "keys", "proof", "months", "requested_at", "verified_at", "cla_accepted_at"]);
  const sent = woltrustRequest();
  expect(file).toMatchObject({ format: 1, action: "issue", id, tier: "origin", kind: "person", subject: { github_id: 1001, login: "Alice", name: "Alice Doe" },
    namespaces: ["alice."], keys: sent.keys, proof: sent.proof, months: 12 });
  expect(file.cla_accepted_at).toBeGreaterThan(0);
  // the certificate comes back; the request is issued; the person's page shows it with its tier
  const cert = wolcert(file, ORIGIN_SERIAL);
  expect([(await postCert({ request_id: id, serial: ORIGIN_SERIAL, tier: "origin", cert })).status]).toEqual([200]);
  expect(((await (await postCert({ request_id: id, serial: ORIGIN_SERIAL, cert })).json()) as any).duplicate).toBe(true);
  expect((await fetchFile(id)).status).toBe(404);
  const mine = (await (await req(env, "GET", "/api/cert/requests", { cookie: c })).json()) as any;
  expect(mine.requests[0]).toMatchObject({ status: "issued", tier: "origin", serial: ORIGIN_SERIAL, cert });
  const pub = (await (await req(env, "GET", "/api/certs/alice")).json()) as any;
  expect(pub.certs[0]).toMatchObject({ serial: ORIGIN_SERIAL, tier: "origin", revoked_at: null, origin_cert: null });
  expect(((await (await req(env, "GET", "/api/me", { cookie: c })).json()) as any).certs).toEqual({ origin: "issued", trusted: "none" });
  // one live certificate per tier
  expect([(await send(c, {}, alice, "origin")).r.status]).toEqual([409]);
});

test("origin gate: two-factor authentication on GitHub, else refused and nothing stored", async () => {
  for (const tfa of [false, undefined]) {
    const u = { ...alice, two_factor_authentication: tfa };
    const c = await asPerson(u);
    gh.addUser(u);
    const { r, body } = await send(c, {}, u, "origin");
    expect([r.status, body.error]).toEqual([403, "two-factor-needed"]);
  }
  expect(env.DB.sqlite.query("SELECT count(*) AS n FROM cert_requests").get()).toEqual({ n: 0 });
  const refused = env.DB.sqlite.query("SELECT actor_kind, actor_id, detail FROM audit_log WHERE action = 'cert.origin-refused'").all() as any[];
  expect(refused).toHaveLength(2);
  expect(JSON.parse(refused[0].detail)).toMatchObject({ code: "two-factor-needed", gates: { two_factor: false } });
  expect(JSON.parse(refused[1].detail).gates.two_factor).toBeNull();
  expect(gh.dispatches).toHaveLength(0);
});

test("origin gate: the GitHub account is older than 30 days", async () => {
  const young = { ...alice, created_at: new Date(Date.now() - 29 * 86400 * 1000).toISOString() };
  const { r, body } = await requestAs(young, {}, "origin");
  expect([r.status, body.error]).toEqual([403, "account-too-new"]);
  const ok = { ...alice, created_at: new Date(Date.now() - 31 * 86400 * 1000).toISOString() };
  gh.addUser(ok);
  const c = await signIn(env, gh, ok);
  expect((await send(c, {}, ok, "origin")).body.auto).toBe(true);
});

test("origin gate: the CLA and the Publisher Agreement (and the Trust Terms) are accepted", async () => {
  const c = await signIn(env, gh, alice);
  expect((await send(c, {}, alice, "origin")).body.error).toBe("cla-needed");
  await acceptCla(env, c, false);
  const { r, body } = await send(c, {}, alice, "origin");
  expect([r.status, body.error]).toEqual([403, "publisher-terms-needed"]);
  const noTerms = await req(env, "POST", "/api/cert/request", { cookie: c, body: { ...woltrustRequest(), tier: "origin" } });
  expect(((await noTerms.json()) as any).error).toBe("trust-terms-needed");
  await acceptCla(env, c, true);
  expect((await send(c, {}, alice, "origin")).body.auto).toBe(true);
});

test("origin gate: one per subject per 7 days; after a refusal a person looks at the next one", async () => {
  env = makeEnv(); // no pipeline App key: the approval stays undispatched, so an admin can still refuse it
  const { c, body } = await requestAs(alice, {}, "origin");
  expect(body).toMatchObject({ auto: true, dispatched: false });
  // gate: no open request (this one is approved and not issued yet)
  const open = await send(c, {}, alice, "origin");
  expect([open.r.status, open.body.error]).toEqual([409, "request-open"]);
  const a = await signIn(env, gh, carol);
  expect((await req(env, "POST", `/api/admin/requests/${body.request.id}/refuse`, { cookie: a, body: { reason: "Namespace dispute." } })).status).toBe(200);
  const again = await send(c, {}, alice, "origin");
  expect([again.r.status, again.body.error]).toEqual([429, "origin-weekly"]);
  expect(Number(again.r.headers.get("retry-after"))).toBeGreaterThan(6 * 86400);
  const back = shiftClock(7 * 86400 + 60);
  try {
    const c2 = await signIn(env, gh, alice);
    const later = await send(c2, {}, alice, "origin");
    expect(later.r.status).toBe(201);
    // refused before: stored for a person, not approved by the policy
    expect(later.body).toMatchObject({ auto: false, request: { status: "pending", tier: "origin", approved_by: null } });
    expect(auditOf(`request:${later.body.request.id}`).map((x) => x.action)).toEqual(["cert.request", "cert.review"]);
    // a person approves it: the file is still an origin file, without approved_by
    const d = await signIn(env, gh, dave);
    expect((await req(env, "POST", `/api/admin/requests/${later.body.request.id}/approve`, { cookie: d })).status).toBe(202);
    const file = (await (await fetchFile(later.body.request.id)).json()) as any;
    expect(file.tier).toBe("origin");
    expect(file.approved_by).toBeUndefined();
  } finally { back(); }
});

test("trusted: needs a live origin certificate first, a person's approval, and the file names origin_cert", async () => {
  const c0 = await asPerson(alice);
  const first = await send(c0, {}, alice, "trusted");
  expect([first.r.status, first.body.error]).toEqual([409, "origin-first"]);
  const { c, r, body } = await trustedAs();
  expect(r.status).toBe(201);
  const id = body.request.id as string;
  expect(body).toMatchObject({ auto: false, request: { tier: "trusted", status: "pending", origin_cert: ORIGIN_SERIAL, approved_by: null } });
  expect(((await (await req(env, "GET", "/api/me", { cookie: c })).json()) as any).certs).toEqual({ origin: "issued", trusted: "pending" });
  // one open request per subject
  expect((await send(c, {}, alice, "trusted")).body.error).toBe("request-open");
  // nobody approved it yet
  expect((await fetchFile(id)).status).toBe(404);
  // the person is no admin: the panel does not exist for them
  expect((await req(env, "GET", "/api/admin/queue", { cookie: c })).status).toBe(404);
  expect((await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: c })).status).toBe(404);
  const admin = await signIn(env, gh, carol);
  expect(((await (await req(env, "GET", "/api/me", { cookie: admin })).json()) as any)).toMatchObject({ admin: true, admin_role: "owner" });
  const q = (await (await req(env, "GET", "/api/admin/queue", { cookie: admin })).json()) as any;
  expect(q.requests.map((x: any) => [x.id, x.status, x.tier, x.requested_by])).toEqual([[id, "pending", "trusted", 1001]]);
  expect((await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: admin, origin: "https://evil.test" })).status).toBe(403);
  const ap = await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: admin });
  expect(ap.status).toBe(200);
  expect(((await ap.json()) as any)).toMatchObject({ dispatched: true, request: { status: "approved", approved_by: "carol-ca", dispatch_error: null } });
  const file = (await (await fetchFile(id)).json()) as any;
  expect(Object.keys(file)).toEqual(["format", "action", "id", "tier", "kind", "subject", "namespaces", "keys", "proof", "months", "requested_at", "verified_at", "approved_by", "approved_at", "origin_cert"]);
  expect(file).toMatchObject({ tier: "trusted", approved_by: ["carol-ca"], origin_cert: ORIGIN_SERIAL });
  expect(file.approved_at).toBeGreaterThanOrEqual(file.verified_at);
  // the certificate must be a trusted one naming that origin certificate, when its body says so
  const bad = await postCert({ request_id: id, serial: TRUSTED_SERIAL, cert: wolcert(file, TRUSTED_SERIAL, { class: "trusted", origin_cert: "9999999999999999" }) });
  expect([bad.status, ((await bad.json()) as any).error]).toEqual([409, "cert-mismatch"]);
  expect((await postCert({ request_id: id, serial: TRUSTED_SERIAL, tier: "origin", cert: wolcert(file, TRUSTED_SERIAL) })).status).toBe(409);
  expect((await postCert({ request_id: id, serial: TRUSTED_SERIAL, cert: wolcert(file, TRUSTED_SERIAL, { class: "origin" }) })).status).toBe(409);
  expect((await postCert({ request_id: id, serial: TRUSTED_SERIAL, tier: "trusted", cert: wolcert(file, TRUSTED_SERIAL, { class: "trusted", origin_cert: ORIGIN_SERIAL }) })).status).toBe(200);
  expect(((await (await req(env, "GET", "/api/me", { cookie: c })).json()) as any).certs).toEqual({ origin: "issued", trusted: "issued" });
  const pub = (await (await req(env, "GET", "/api/certs/alice")).json()) as any;
  const byTier = Object.fromEntries(pub.certs.map((x: any) => [x.tier, [x.serial, x.origin_cert]]));
  expect(byTier).toEqual({ origin: [ORIGIN_SERIAL, null], trusted: [TRUSTED_SERIAL, ORIGIN_SERIAL] });
  const log = auditOf(`request:${id}`).map((x) => [x.actor_kind, x.actor_id, x.action]);
  expect(log).toEqual([["person", "1001", "cert.request"], ["person", "1003", "cert.approve"], ["person", "1003", "cert.dispatch"], ["pipeline", "777.1", "cert.issued"]]);
});

test("an admin cannot approve their own request; another admin can", async () => {
  const { c, body } = await trustedAs(carol);
  const id = body.request.id;
  const own = await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: c });
  expect([own.status, ((await own.json()) as any).error]).toEqual([403, "own-request"]);
  const d = await signIn(env, gh, dave); // "Dave" in ADMINS as "dave": logins compare case-insensitively
  expect((await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: d })).status).toBe(200);
  expect(gh.dispatches).toHaveLength(2); // the origin one, then this
});

test("a failed dispatch keeps the approval; approving again starts the workflow, approved_by stays", async () => {
  const { body } = await trustedAs();
  const id = body.request.id;
  delete (env as any).GITHUB_PIPELINE_APP_PRIVATE_KEY;
  const a = await signIn(env, gh, carol);
  const r = await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: a });
  const rb = (await r.json()) as any;
  expect(r.status).toBe(202);
  expect(rb).toMatchObject({ dispatched: false, request: { status: "approved", dispatched_at: null } });
  expect(rb.request.dispatch_error).toContain("GITHUB_PIPELINE_APP_PRIVATE_KEY is not set");
  expect(((await (await req(env, "GET", "/api/admin/queue", { cookie: a })).json()) as any).requests[0].dispatch_error).toContain("not set");
  // GitHub refuses the dispatch (e.g. ca.yml missing on main)
  (env as any).GITHUB_PIPELINE_APP_PRIVATE_KEY = await appKey(gh, "pkcs8");
  gh.dispatchStatus = 422;
  expect((await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: a })).status).toBe(202);
  gh.dispatchStatus = 204;
  const d = await signIn(env, gh, dave);
  const ok = await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: d });
  expect(ok.status).toBe(200);
  expect(((await ok.json()) as any).request).toMatchObject({ approved_by: "carol-ca", dispatch_error: null });
  expect(gh.dispatches.map((x) => (x.body.inputs as { request_id: string }).request_id).filter((x) => x === id)).toHaveLength(2); // the refused one and this

  const actions = auditOf(`request:${id}`).map((x) => x.action);
  expect(actions).toEqual(["cert.request", "cert.approve", "cert.dispatch-failed", "cert.dispatch-failed", "cert.dispatch"]);
  // the pipeline App id is needed too
  delete (env as any).GITHUB_PIPELINE_APP_ID;
  const { dispatchCa } = await import("../src/ghapp");
  await expect_reject(() => dispatchCa(env, id), "GITHUB_PIPELINE_APP_ID is not set");
});
async function expect_reject(f: () => Promise<unknown>, msg: string) {
  let err: unknown = null;
  try { await f(); } catch (e) { err = e; }
  expect(String((err as Error)?.message)).toContain(msg);
}

test("refusing needs a reason and closes the request; a dispatched one cannot be refused", async () => {
  const { c, body } = await trustedAs();
  const id = body.request.id;
  const a = await signIn(env, gh, carol);
  expect((await req(env, "POST", `/api/admin/requests/${id}/refuse`, { cookie: a })).status).toBe(400);
  const r = await req(env, "POST", `/api/admin/requests/${id}/refuse`, { cookie: a, body: { reason: "The namespace is someone else's project." } });
  expect(((await r.json()) as any).request).toMatchObject({ status: "refused", reason: "The namespace is someone else's project.", approved_by: null });
  expect((await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: a })).status).toBe(409);
  expect((await fetchFile(id)).status).toBe(404);
  // a new trusted request is possible after a refusal
  const again = await send(c, {}, alice, "trusted");
  expect(again.r.status).toBe(201);
  await req(env, "POST", `/api/admin/requests/${again.body.request.id}/approve`, { cookie: a });
  const late = await req(env, "POST", `/api/admin/requests/${again.body.request.id}/refuse`, { cookie: a, body: { reason: "too late" } });
  expect(((await late.json()) as any).error).toBe("request-dispatched");
  expect((await req(env, "POST", "/api/admin/requests/r-nothing/approve", { cookie: a })).status).toBe(404);
});

test("the request's shape is checked; the hub's own fields cannot be sent", async () => {
  const c = await asPerson();
  const sendShape = async (over: Record<string, unknown>) => {
    const r = await req(env, "POST", "/api/cert/request", { cookie: c, body: await withTerms(woltrustRequest(over)) });
    return [r.status, ((await r.json()) as any).error];
  };
  const k = woltrustRequest().keys;
  const cases: [Record<string, unknown>, number, string][] = [
    [{ format: 2 }, 400, "bad-request"],
    [{ action: "revoke" }, 400, "bad-request"],
    [{ kind: "root" }, 400, "bad-request"],
    [{ approved_by: ["alice"] }, 400, "bad-request"],
    [{ verified_at: 1 }, 400, "bad-request"],
    [{ id: "r-0001" }, 400, "bad-request"],
    [{ extra: 1 }, 400, "bad-request"],
    [{ tier: "wolos" }, 400, "bad-request"],
    [{ keys: { ...k, "slh-dsa-sha2-128s": bytes(32) } }, 400, "bad-request"],
    [{ keys: { ed25519: k.ed25519, "ml-dsa-65": k["ml-dsa-65"], x25519: k.x25519 } }, 400, "bad-request"],
    [{ keys: { ...k, ed25519: bytes(31) } }, 400, "bad-request"],
    [{ keys: { ...k, "ml-dsa-65": bytes(1951) } }, 400, "bad-request"],
    [{ keys: { ...k, "ml-kem-768": "not base64!" } }, 400, "bad-request"],
    [{ proof: { ed25519: bytes(64) } }, 400, "bad-request"],
    [{ proof: { ed25519: bytes(63), second: bytes(3309) } }, 400, "bad-request"],
    [{ months: 25 }, 400, "bad-request"],
    [{ requested_at: t0() - 40 * 86400 }, 400, "bad-request"],
    [{ requested_at: t0() + 86400 }, 400, "bad-request"],
    [{ level: "wolos" }, 400, "bad-request"],
    [{ namespaces: [] }, 400, "bad-request"],
    [{ namespaces: ["Alice."] }, 400, "bad-request"],
    [{ namespaces: ["alice.", "alice."] }, 400, "bad-request"],
    [{ namespaces: ["bob."] }, 403, "wrong-namespace"],
    [{ namespaces: ["alice.", "bob."] }, 403, "wrong-namespace"],
    [{ subject: { github_id: 1002, login: "bob", name: "Bob" } }, 403, "not-you"],
    [{ subject: { github_id: 1001, login: "alice", name: "A", org: { login: "examplelabs" } } }, 403, "not-a-member"],
  ];
  for (const [over, status, error] of cases) expect([JSON.stringify(over).slice(0, 60), ...(await sendShape(over))]).toEqual([JSON.stringify(over).slice(0, 60), status, error]);
  // without encryption keys, with a sub-namespace, with level: fine (and no tier: origin)
  const { x25519: _x, "ml-kem-768": _m, ...signing } = k;
  const ok = await req(env, "POST", "/api/cert/request", { cookie: c, body: await withTerms(woltrustRequest({ keys: signing, namespaces: ["alice.", "alice.tools."], level: "verified", months: 24 })) });
  expect(ok.status).toBe(201);
  expect(((await ok.json()) as any).request).toMatchObject({ tier: "origin", encryption: false, namespaces: ["alice.", "alice.tools."], months: 24 });
});

test("a request needs a session and the hub's origin; it is rate limited", async () => {
  expect((await req(env, "POST", "/api/cert/request", { body: await withTerms(woltrustRequest()) })).status).toBe(401);
  const c = await signIn(env, gh, alice);
  expect((await req(env, "POST", "/api/cert/request", { cookie: c, body: await withTerms(woltrustRequest()), origin: "https://evil.test" })).status).toBe(403);
  const { c: c2 } = await withOrigin(); // the first stored request of the day
  const a = await signIn(env, gh, carol);
  for (let i = 0; i < 2; i++) {
    const x = await send(c2, {}, alice, "trusted");
    expect(x.r.status).toBe(201);
    await req(env, "POST", `/api/admin/requests/${x.body.request.id}/refuse`, { cookie: a, body: { reason: "test" } });
  }
  expect((await send(c2, {}, alice, "trusted")).r.status).toBe(429);
});

test("the Trust Terms are accepted with every request, and recorded", async () => {
  const c = await asPerson();
  const r2 = await req(env, "POST", "/api/cert/request", { cookie: c, body: { ...woltrustRequest(), trust_terms: { version: "1", sha256: "0".repeat(64) } } });
  expect([r2.status, ((await r2.json()) as any).error]).toEqual([409, "terms-changed"]);
  expect(env.DB.sqlite.query("SELECT count(*) AS n FROM cert_requests").get()).toEqual({ n: 0 });
  expect((await send(c)).r.status).toBe(201);
  expect(env.DB.sqlite.query("SELECT doc, github_id, version FROM terms_acceptances WHERE doc = 'trust'").all()).toEqual([{ doc: "trust", github_id: 1001, version: "1" }]);
  expect(((await (await req(env, "GET", "/api/me", { cookie: c })).json()) as any).terms.trust).toMatchObject({ accepted: "1", ok: true });
});

test("a person may name an organisation GitHub shows them in; its id comes from GitHub", async () => {
  gh.orgs.set(alice.id, [{ id: 501, login: "ExampleLabs", role: "member" }]);
  const { body } = await requestAs(alice, { subject: { github_id: 1001, login: "alice", name: "Alice", org: { login: "examplelabs" } } });
  expect(body.request.subject).toEqual({ github_id: 1001, login: "Alice", name: "Alice", org: { github_id: 501, login: "ExampleLabs" } });
  const file = (await (await fetchFile(body.request.id)).json()) as any;
  expect(file.subject.org).toEqual({ github_id: 501, login: "ExampleLabs" });
});

test("an organisation's certificates: an owner of a linked organisation with its CLA; members of it cannot approve the trusted one", async () => {
  gh.orgs.set(alice.id, [{ id: 501, login: "examplelabs", role: "admin" }]);
  gh.orgs.set(bob.id, [{ id: 501, login: "examplelabs", role: "member" }]);
  gh.orgs.set(dave.id, [{ id: 501, login: "examplelabs", role: "member" }]);
  const orgReq = { kind: "org", subject: { github_id: 501, login: "examplelabs", name: "Example Labs" }, namespaces: ["examplelabs."] };
  const c = await asPerson(alice);
  expect((await send(c, orgReq)).body.error).toBe("org-not-linked");
  const cla = (await (await req(env, "GET", "/api/cla")).json()) as any;
  expect((await req(env, "POST", "/api/orgs", { cookie: c, body: { org: "examplelabs", version: cla.version, sha256: cla.sha256 } })).status).toBe(201);
  const b = await asPerson(bob);
  expect((await send(b, orgReq, bob)).body.error).toBe("not-owner");
  // origin for the organisation: by policy, the gates are the owner's
  const o = await send(c, orgReq, alice, "origin");
  expect(o.body).toMatchObject({ auto: true, request: { kind: "org", tier: "origin" } });
  const ofile = (await (await fetchFile(o.body.request.id)).json()) as any;
  expect(ofile).toMatchObject({ kind: "org", tier: "origin", subject: { github_id: 501, login: "examplelabs" } });
  expect(ofile.cla_accepted_at).toBeGreaterThan(0);
  expect((await postCert({ request_id: o.body.request.id, serial: ORIGIN_SERIAL, cert: wolcert(ofile, ORIGIN_SERIAL) })).status).toBe(200);
  const t = await send(c, orgReq, alice, "trusted");
  expect(t.body.request).toMatchObject({ kind: "org", tier: "trusted", origin_cert: ORIGIN_SERIAL });
  const d = await signIn(env, gh, dave); // a member of examplelabs
  expect(((await (await req(env, "POST", `/api/admin/requests/${t.body.request.id}/approve`, { cookie: d })).json()) as any).error).toBe("own-request");
  const a = await signIn(env, gh, carol);
  expect((await req(env, "POST", `/api/admin/requests/${t.body.request.id}/approve`, { cookie: a })).status).toBe(200);
  const file = (await (await fetchFile(t.body.request.id)).json()) as any;
  expect(file).toMatchObject({ kind: "org", tier: "trusted", subject: { github_id: 501, login: "examplelabs", name: "Example Labs" }, namespaces: ["examplelabs."] });
  expect(file.subject.org).toBeUndefined();
});

test("the ca job's certificate must be the one asked for", async () => {
  env = makeEnv(); // no App key: the origin approval stays, so it can be refused below
  const { body } = await requestAs();
  const id = body.request.id;
  const post = async (b: unknown) => { const r = await postCert(b); return [r.status, ((await r.json()) as any).error]; };
  const file = (await (await fetchFile(id)).json()) as any;
  expect(await post({ request_id: id, serial: "0123456789ABCDEF", cert: wolcert(file) })).toEqual([400, "bad-request"]);
  expect(await post({ request_id: id, serial: "0123456789abcdef", cert: "not json" })).toEqual([400, "bad-request"]);
  expect(await post({ request_id: id, serial: "0123456789abcdef", tier: "gold", cert: wolcert(file) })).toEqual([400, "bad-request"]);
  expect(await post({ request_id: id, serial: "0123456789abcdef", cert: wolcert(file, "fedcba9876543210") })).toEqual([409, "cert-mismatch"]);
  expect(await post({ request_id: id, serial: "0123456789abcdef", cert: wolcert(file, undefined, { keys: { ed25519: bytes(32, 1) } }) })).toEqual([409, "cert-mismatch"]);
  expect(await post({ request_id: id, serial: "0123456789abcdef", cert: wolcert(file, undefined, { subject: { github_id: 1002 } }) })).toEqual([409, "cert-mismatch"]);
  expect(await post({ request_id: id, serial: "0123456789abcdef", cert: wolcert(file, undefined, { namespaces: ["alice.", "alice.x."] }) })).toEqual([409, "cert-mismatch"]);
  expect(await post({ request_id: id, serial: "0123456789abcdef", cert: wolcert(file, undefined, { class: "trusted" }) })).toEqual([409, "cert-mismatch"]);
  expect(await post({ request_id: "r-unknown", serial: "0123456789abcdef", cert: wolcert(file) })).toEqual([404, "no-request"]);
  expect(await post({ request_id: id, serial: "0123456789abcdef", cert: wolcert(file, undefined, { class: "origin" }) })).toEqual([200, undefined]);
  // a refused request takes no certificate
  const c2 = await asPerson(bob);
  const r2 = await send(c2, {}, bob);
  await req(env, "POST", `/api/admin/requests/${r2.body.request.id}/refuse`, { cookie: await signIn(env, gh, carol), body: { reason: "x" } });
  const f2 = { ...file, subject: { github_id: bob.id, login: "bob", name: "Bob Roe" }, namespaces: ["bob."], keys: woltrustRequest({}, bob).keys };
  expect(await post({ request_id: r2.body.request.id, serial: "2222222222222222", cert: wolcert(f2, "2222222222222222") })).toEqual([409, "not-approved"]);
});

test("the App private key: GitHub's PKCS#1 PEM is read as PKCS#8", async () => {
  const pem1 = await appKey(new FakeGitHub(), "pkcs1");
  expect(pem1).toContain("BEGIN RSA PRIVATE KEY");
  const k = await crypto.subtle.importKey("pkcs8", pkcs8Der(pem1), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["sign"]);
  expect(k.type).toBe("private");
  expect(() => pkcs8Der("not a key")).toThrow("not a PEM private key");
});

const FIXTURE = new URL("../../../hub-index/fixtures/request-issue.json", import.meta.url);
test.skipIf(!existsSync(FIXTURE))("hub-index's real request fixture (woltrust keys and proof) passes the shape check", () => {
  const f = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const { id: _i, tier: _r, verified_at: _v, approved_by: _a, approved_at: _t, cla_accepted_at: _c, ...woltrust } = f;
  const { org: _o, ...subject } = woltrust.subject;
  const r = requestShape({ ...woltrust, subject }, woltrust.requested_at);
  expect(r.keys).toEqual(f.keys);
  expect(r.proof).toEqual(f.proof);
});
