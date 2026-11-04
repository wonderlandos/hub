// SPDX-License-Identifier: GPL-2.0-or-later
// Certificate requests: shape, account checks, admin approval, the ca dispatch, the ca job's endpoints.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  acceptCla, alice, appKey, termsAnswer, bob, carol, claims, dave, FakeGitHub, install, jwt, makeEnv, oidcKey, req, signIn,
} from "./harness";
import { b64url } from "../src/crypto";
import { keyId, requestShape } from "../src/certs";
import { pkcs8Der } from "../src/ghapp";

let gh: FakeGitHub, undo: () => void, env: ReturnType<typeof makeEnv>, key: Awaited<ReturnType<typeof oidcKey>>;
beforeEach(async () => {
  gh = new FakeGitHub(); undo = install(gh);
  key = await oidcKey(gh);
  env = makeEnv({ GITHUB_APP_PRIVATE_KEY: await appKey(gh) });
});
afterEach(() => undo());

const bytes = (n: number, fill = 7) => b64url(new Uint8Array(n).fill(fill));
const t0 = () => Math.floor(Date.now() / 1000);
/** A request as `wol cert request` writes it (woltrust request::Request), with keys of the right sizes. */
export function woltrustRequest(over: Record<string, unknown> = {}, who = alice) {
  return {
    format: 1, action: "issue", kind: "person",
    subject: { github_id: who.id, login: who.login.toLowerCase(), name: who.name },
    namespaces: [`${who.login.toLowerCase()}.`],
    keys: { ed25519: bytes(32, who.id % 256), "ml-dsa-65": bytes(1952), x25519: bytes(32, 9), "ml-kem-768": bytes(1184) },
    proof: { ed25519: bytes(64), second: bytes(3309) },
    months: 12, requested_at: t0() - 60,
    ...over,
  };
}
/** What the site sends: the woltrust request and the Trust Terms accepted with it. */
const withTerms = async (r: Record<string, unknown>) => ({ ...r, trust_terms: await termsAnswer(env, "trust") });
const ca = async (over: Record<string, unknown> = {}) => ({ authorization: `Bearer ${await jwt(key, claims("ca", over))}` });

async function asPerson(u = alice) {
  const c = await signIn(env, gh, u);
  await acceptCla(env, c);
  return c;
}
async function requestAs(u = alice, over: Record<string, unknown> = {}) {
  const c = await asPerson(u);
  const r = await req(env, "POST", "/api/cert/request", { cookie: c, body: await withTerms(woltrustRequest(over, u)) });
  return { c, r, body: (await r.json()) as any };
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

test("request, admin approval, ca dispatch, the ca job fetches the file and reports the certificate", async () => {
  const { c, r, body } = await requestAs();
  expect(r.status).toBe(201);
  const id = body.request.id as string;
  expect(id).toMatch(/^r-[0-9a-f]{16}$/);
  expect(body.request).toMatchObject({ kind: "person", status: "pending", subject: { github_id: 1001, login: "Alice", name: "Alice Doe" },
    namespaces: ["alice."], encryption: true, months: 12, approved_by: null, cert: null });
  expect(body.request.key_id).toBe(await keyId(woltrustRequest().keys.ed25519));
  // one open request per subject
  const again = await req(env, "POST", "/api/cert/request", { cookie: c, body: await withTerms(woltrustRequest()) });
  expect([again.status, ((await again.json()) as any).error]).toEqual([409, "request-open"]);
  expect((((await (await req(env, "GET", "/api/cert/requests", { cookie: c })).json()) as any).requests).map((x: any) => x.id)).toEqual([id]);
  // the ca job cannot fetch a request nobody approved
  expect((await req(env, "GET", `/api/pipeline/requests/${id}`, { headers: await ca() })).status).toBe(404);

  // the person is not an admin; carol is
  expect((await req(env, "GET", "/api/admin/queue", { cookie: c })).status).toBe(403);
  expect((await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: c })).status).toBe(403);
  const admin = await signIn(env, gh, carol);
  expect(((await (await req(env, "GET", "/api/me", { cookie: admin })).json()) as any).admin).toBe(true);
  const q = (await (await req(env, "GET", "/api/admin/queue", { cookie: admin })).json()) as any;
  expect(q.requests.map((x: any) => [x.id, x.status, x.requested_by])).toEqual([[id, "pending", 1001]]);
  expect((await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: admin, origin: "https://evil.test" })).status).toBe(403);
  const ap = await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: admin });
  expect(ap.status).toBe(200);
  const apb = (await ap.json()) as any;
  expect(apb).toMatchObject({ dispatched: true, request: { status: "approved", approved_by: "carol-ca", dispatch_error: null } });
  expect(apb.request.dispatched_at).toBeGreaterThan(0);
  // the App token: one repository, actions: write; the dispatch: ca.yml on main with the id
  expect(gh.installTokenBodies).toEqual([{ repositories: ["hub-index"], permissions: { actions: "write" } }]);
  expect(gh.dispatches).toEqual([{ path: "/repos/wonderlandos/hub-index/actions/workflows/ca.yml/dispatches", token: "ghs_installationtoken000000000",
    body: { ref: "main", inputs: { request_id: id, dry_run: "false" } } }]);

  // only the ca job reads the file
  expect((await req(env, "GET", `/api/pipeline/requests/${id}`, { headers: { authorization: `Bearer ${await jwt(key, claims("check"))}` } })).status).toBe(401);
  expect((await req(env, "GET", `/api/pipeline/requests/${id}`, { headers: await ca({ environment: "sign" }) })).status).toBe(401);
  const f = await req(env, "GET", `/api/pipeline/requests/${id}`, { headers: await ca() });
  expect(f.status).toBe(200);
  const file = (await f.json()) as any;
  const sent = woltrustRequest();
  expect(Object.keys(file)).toEqual(["format", "action", "id", "tier", "kind", "subject", "namespaces", "keys", "proof", "months", "requested_at", "verified_at", "approved_by", "approved_at"]);
  expect(file).toMatchObject({ format: 1, action: "issue", id, tier: "trusted", kind: "person", subject: { github_id: 1001, login: "Alice", name: "Alice Doe" },
    namespaces: ["alice."], keys: sent.keys, proof: sent.proof, months: 12, approved_by: ["carol-ca"] });
  expect(file.verified_at).toBeGreaterThan(0);
  expect(file.approved_at).toBeGreaterThanOrEqual(file.verified_at);

  // the certificate comes back
  const cert = wolcert(file);
  const post = (b: unknown, h?: Record<string, string>) => req(env, "POST", "/api/pipeline/certs", { origin: null, headers: h, body: b });
  expect((await post({ request_id: id, serial: "0123456789abcdef", cert }, { authorization: `Bearer ${await jwt(key, claims("sign"))}` })).status).toBe(401);
  const stored = await post({ request_id: id, serial: "0123456789abcdef", cert }, await ca());
  expect([stored.status, await stored.json()]).toEqual([200, { stored: true }]);
  expect(((await (await post({ request_id: id, serial: "0123456789abcdef", cert }, await ca())).json()) as any).duplicate).toBe(true);
  expect((await post({ request_id: id, serial: "1111111111111111", cert }, await ca())).status).toBe(409);
  expect((await req(env, "GET", `/api/pipeline/requests/${id}`, { headers: await ca() })).status).toBe(404);

  // shown to the person and on the public page
  const mine = (await (await req(env, "GET", "/api/cert/requests", { cookie: c })).json()) as any;
  expect(mine.requests[0]).toMatchObject({ status: "issued", serial: "0123456789abcdef", cert });
  const pub = (await (await req(env, "GET", "/api/certs/alice")).json()) as any;
  expect(pub.certs).toHaveLength(1);
  expect(pub.certs[0]).toMatchObject({ serial: "0123456789abcdef", kind: "person", login: "Alice", cert });
  expect(((await (await req(env, "GET", "/api/certs/bob")).json()) as any).certs).toEqual([]);

  const log = env.DB.sqlite.query("SELECT actor_kind, actor_id, action FROM audit_log WHERE target = ? ORDER BY id").all(`request:${id}`);
  expect(log).toEqual([
    { actor_kind: "person", actor_id: "1001", action: "cert.request" },
    { actor_kind: "person", actor_id: "1003", action: "cert.approve" },
    { actor_kind: "person", actor_id: "1003", action: "cert.dispatch" },
    { actor_kind: "pipeline", actor_id: "777.1", action: "cert.issued" },
  ]);
});

test("an admin cannot approve their own request; another admin can", async () => {
  const { c, body } = await requestAs(carol);
  const id = body.request.id;
  const own = await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: c });
  expect([own.status, ((await own.json()) as any).error]).toEqual([403, "own-request"]);
  const d = await signIn(env, gh, dave); // "Dave" in ADMINS as "dave": logins compare case-insensitively
  expect((await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: d })).status).toBe(200);
  expect(gh.dispatches).toHaveLength(1);
});

test("a failed dispatch keeps the approval; approving again starts the workflow, approved_by stays", async () => {
  const e2 = makeEnv({ GITHUB_APP_PRIVATE_KEY: undefined });
  const prevEnv = env; env = e2;
  try {
    const { body } = await requestAs();
    const id = body.request.id;
    const a = await signIn(env, gh, carol);
    const r = await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: a });
    const rb = (await r.json()) as any;
    expect(r.status).toBe(202);
    expect(rb).toMatchObject({ dispatched: false, request: { status: "approved", dispatched_at: null } });
    expect(rb.request.dispatch_error).toContain("GITHUB_APP_PRIVATE_KEY is not set");
    expect(((await (await req(env, "GET", "/api/admin/queue", { cookie: a })).json()) as any).requests[0].dispatch_error).toContain("not set");
    // GitHub refuses the dispatch (e.g. ca.yml missing on main)
    (env as any).GITHUB_APP_PRIVATE_KEY = await appKey(gh, "pkcs8");
    gh.dispatchStatus = 422;
    expect((await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: a })).status).toBe(202);
    gh.dispatchStatus = 204;
    const d = await signIn(env, gh, dave);
    const ok = await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: d });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).request).toMatchObject({ approved_by: "carol-ca", dispatch_error: null });
    expect(gh.dispatches).toHaveLength(2);
    const actions = (env.DB.sqlite.query("SELECT action FROM audit_log WHERE target = ? ORDER BY id").all(`request:${id}`) as any[]).map((x) => x.action);
    expect(actions).toEqual(["cert.request", "cert.approve", "cert.dispatch-failed", "cert.dispatch-failed", "cert.dispatch"]);
  } finally { env = prevEnv; }
});

test("refusing needs a reason and closes the request", async () => {
  const { c, body } = await requestAs();
  const id = body.request.id;
  const a = await signIn(env, gh, carol);
  expect((await req(env, "POST", `/api/admin/requests/${id}/refuse`, { cookie: a })).status).toBe(400);
  const r = await req(env, "POST", `/api/admin/requests/${id}/refuse`, { cookie: a, body: { reason: "The namespace is someone else's project." } });
  expect(((await r.json()) as any).request).toMatchObject({ status: "refused", reason: "The namespace is someone else's project.", approved_by: null });
  expect((await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: a })).status).toBe(409);
  expect((await req(env, "GET", `/api/pipeline/requests/${id}`, { headers: await ca() })).status).toBe(404);
  expect(gh.dispatches).toHaveLength(0);
  // a new request is possible after a refusal
  expect((await req(env, "POST", "/api/cert/request", { cookie: c, body: await withTerms(woltrustRequest()) })).status).toBe(201);
  expect((await req(env, "POST", "/api/admin/requests/r-nothing/approve", { cookie: a })).status).toBe(404);
});

test("the request's shape is checked; the hub's own fields cannot be sent", async () => {
  const c = await asPerson();
  const send = async (over: Record<string, unknown>) => {
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
  for (const [over, status, error] of cases) expect([JSON.stringify(over).slice(0, 60), ...(await send(over))]).toEqual([JSON.stringify(over).slice(0, 60), status, error]);
  // without encryption keys, with a sub-namespace, with level: fine
  const { x25519: _x, "ml-kem-768": _m, ...signing } = k;
  const ok = await req(env, "POST", "/api/cert/request", { cookie: c, body: await withTerms(woltrustRequest({ keys: signing, namespaces: ["alice.", "alice.tools."], level: "verified", months: 24 })) });
  expect(ok.status).toBe(201);
  expect(((await ok.json()) as any).request).toMatchObject({ encryption: false, namespaces: ["alice.", "alice.tools."], months: 24 });
});

test("a request needs a session, the hub's origin and the CLA; it is rate limited", async () => {
  expect((await req(env, "POST", "/api/cert/request", { body: await withTerms(woltrustRequest()) })).status).toBe(401);
  const c = await signIn(env, gh, alice);
  expect((await req(env, "POST", "/api/cert/request", { cookie: c, body: await withTerms(woltrustRequest()), origin: "https://evil.test" })).status).toBe(403);
  const r = await req(env, "POST", "/api/cert/request", { cookie: c, body: await withTerms(woltrustRequest()) });
  expect([r.status, ((await r.json()) as any).error]).toEqual([403, "cla-needed"]);
  await acceptCla(env, c);
  const a = await signIn(env, gh, carol);
  for (let i = 0; i < 3; i++) {
    const x = await req(env, "POST", "/api/cert/request", { cookie: c, body: await withTerms(woltrustRequest()) });
    expect(x.status).toBe(201);
    await req(env, "POST", `/api/admin/requests/${((await x.json()) as any).request.id}/refuse`, { cookie: a, body: { reason: "test" } });
  }
  expect((await req(env, "POST", "/api/cert/request", { cookie: c, body: await withTerms(woltrustRequest()) })).status).toBe(429);
});

test("a person may name an organisation GitHub shows them in; its id comes from GitHub", async () => {
  gh.orgs.set(alice.id, [{ id: 501, login: "ExampleLabs", role: "member" }]);
  const { body } = await requestAs(alice, { subject: { github_id: 1001, login: "alice", name: "Alice", org: { login: "examplelabs" } } });
  expect(body.request.subject).toEqual({ github_id: 1001, login: "Alice", name: "Alice", org: { github_id: 501, login: "ExampleLabs" } });
  const a = await signIn(env, gh, carol);
  await req(env, "POST", `/api/admin/requests/${body.request.id}/approve`, { cookie: a });
  const file = (await (await req(env, "GET", `/api/pipeline/requests/${body.request.id}`, { headers: await ca() })).json()) as any;
  expect(file.subject.org).toEqual({ github_id: 501, login: "ExampleLabs" });
});

test("an organisation's certificate: an owner of a linked organisation with its CLA; members of it cannot approve it", async () => {
  gh.orgs.set(alice.id, [{ id: 501, login: "examplelabs", role: "admin" }]);
  gh.orgs.set(bob.id, [{ id: 501, login: "examplelabs", role: "member" }]);
  gh.orgs.set(dave.id, [{ id: 501, login: "examplelabs", role: "member" }]);
  const orgReq = { kind: "org", subject: { github_id: 501, login: "examplelabs", name: "Example Labs" }, namespaces: ["examplelabs."] };
  const c = await asPerson(alice);
  const r1 = await req(env, "POST", "/api/cert/request", { cookie: c, body: await withTerms(woltrustRequest(orgReq)) });
  expect(((await r1.json()) as any).error).toBe("org-not-linked");
  const cla = (await (await req(env, "GET", "/api/cla")).json()) as any;
  expect((await req(env, "POST", "/api/orgs", { cookie: c, body: { org: "examplelabs", version: cla.version, sha256: cla.sha256 } })).status).toBe(201);
  const b = await asPerson(bob);
  const r2 = await req(env, "POST", "/api/cert/request", { cookie: b, body: await withTerms(woltrustRequest(orgReq, bob)) });
  expect(((await r2.json()) as any).error).toBe("not-owner");
  const r3 = await req(env, "POST", "/api/cert/request", { cookie: c, body: await withTerms(woltrustRequest(orgReq)) });
  expect(r3.status).toBe(201);
  const id = ((await r3.json()) as any).request.id;
  const d = await signIn(env, gh, dave); // a member of examplelabs
  expect(((await (await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: d })).json()) as any).error).toBe("own-request");
  const a = await signIn(env, gh, carol);
  expect((await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: a })).status).toBe(200);
  const file = (await (await req(env, "GET", `/api/pipeline/requests/${id}`, { headers: await ca() })).json()) as any;
  expect(file).toMatchObject({ kind: "org", subject: { github_id: 501, login: "examplelabs", name: "Example Labs" }, namespaces: ["examplelabs."] });
  expect(file.subject.org).toBeUndefined();
});

test("the ca job's certificate must be the one asked for", async () => {
  const { body } = await requestAs();
  const id = body.request.id;
  const post = async (b: unknown) => { const r = await req(env, "POST", "/api/pipeline/certs", { origin: null, headers: await ca(), body: b }); return [r.status, ((await r.json()) as any).error]; };
  expect(await post({ request_id: id, serial: "0123456789abcdef", cert: "{}" })).toEqual([409, "not-approved"]);
  await req(env, "POST", `/api/admin/requests/${id}/approve`, { cookie: await signIn(env, gh, carol) });
  const file = (await (await req(env, "GET", `/api/pipeline/requests/${id}`, { headers: await ca() })).json()) as any;
  expect(await post({ request_id: id, serial: "0123456789ABCDEF", cert: wolcert(file) })).toEqual([400, "bad-request"]);
  expect(await post({ request_id: id, serial: "0123456789abcdef", cert: "not json" })).toEqual([400, "bad-request"]);
  expect(await post({ request_id: id, serial: "0123456789abcdef", cert: wolcert(file, "fedcba9876543210") })).toEqual([409, "cert-mismatch"]);
  expect(await post({ request_id: id, serial: "0123456789abcdef", cert: wolcert(file, undefined, { keys: { ed25519: bytes(32, 1) } }) })).toEqual([409, "cert-mismatch"]);
  expect(await post({ request_id: id, serial: "0123456789abcdef", cert: wolcert(file, undefined, { subject: { github_id: 1002 } }) })).toEqual([409, "cert-mismatch"]);
  expect(await post({ request_id: id, serial: "0123456789abcdef", cert: wolcert(file, undefined, { namespaces: ["alice.", "alice.x."] }) })).toEqual([409, "cert-mismatch"]);
  expect(await post({ request_id: "r-unknown", serial: "0123456789abcdef", cert: wolcert(file) })).toEqual([404, "no-request"]);
  expect(await post({ request_id: id, serial: "0123456789abcdef", cert: wolcert(file) })).toEqual([200, undefined]);
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
