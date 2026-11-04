// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, beforeEach, expect, test } from "bun:test";
import { acceptCla, alice, bob, FakeGitHub, hook, install, makeEnv, req, signIn } from "./harness";

let gh: FakeGitHub, undo: () => void, env: ReturnType<typeof makeEnv>;
beforeEach(() => {
  gh = new FakeGitHub(); undo = install(gh); env = makeEnv();
  gh.repos.set("Alice/notes", { id: 9001, full_name: "Alice/notes", private: false, owner: { id: 1001, login: "Alice", type: "User" } });
  gh.repos.set("bob/stuff", { id: 9002, full_name: "bob/stuff", private: false, owner: { id: 1002, login: "bob", type: "User" } });
  gh.repos.set("examplelabs/tool", { id: 9003, full_name: "examplelabs/tool", private: false, owner: { id: 501, login: "examplelabs", type: "Organization" } });
  gh.repos.set("Alice/secret", { id: 9004, full_name: "Alice/secret", private: true, owner: { id: 1001, login: "Alice", type: "User" } });
});
afterEach(() => undo());

const listing = (over: Record<string, unknown> = {}) => ({
  id: "alice.notes", kind: "app", repo: "Alice/notes", asset: "notes-*.wol", name: "Notes", summary: "Write notes.", license: "GPL-2.0-or-later", ...over,
});

test("no publish without the CLA; after accepting, the listing is created as a draft", async () => {
  const c = await signIn(env, gh, alice);
  const r1 = await req(env, "POST", "/api/listings", { cookie: c, body: listing() });
  expect(r1.status).toBe(403);
  expect(((await r1.json()) as any).error).toBe("cla-needed");
  expect((await acceptCla(env, c)).status).toBe(200);
  const r2 = await req(env, "POST", "/api/listings", { cookie: c, body: listing() });
  expect(r2.status).toBe(201);
  const l = await r2.json() as any;
  expect(l.status).toBe("draft");
  expect(l.owner).toEqual({ kind: "person", github_id: 1001, login: "Alice" });
  expect(l.source).toEqual({ repo: "Alice/notes", repo_id: 9001, asset: "notes-*.wol" });
  expect((await req(env, "GET", "/api/listings/alice.notes")).status).toBe(200);
  expect((await req(env, "POST", "/api/listings", { cookie: c, body: listing() })).status).toBe(409);
});

test("a new CLA version must be accepted again; a stale hash is refused", async () => {
  const c = await signIn(env, gh, alice);
  expect((await req(env, "POST", "/api/cla", { cookie: c, body: { version: "0-placeholder", sha256: "0".repeat(64) } })).status).toBe(409);
  await acceptCla(env, c);
  const { CLAS } = await import("../src/cla");
  CLAS["1"] = "Version one.";
  const env2 = { ...env, CLA_VERSION: "1" };
  try {
    const r = await req(env2, "POST", "/api/listings", { cookie: c, body: listing() });
    expect(((await r.json()) as any).error).toBe("cla-needed");
    const me = await (await req(env2, "GET", "/api/me", { cookie: c })).json() as any;
    expect(me.cla).toMatchObject({ current: "1", accepted: "0-placeholder", ok: false });
  } finally { delete CLAS["1"]; }
});

test("a listing must be in the owner's namespace, bound to a public repository the owner owns", async () => {
  const c = await signIn(env, gh, alice);
  await acceptCla(env, c);
  const err = async (body: unknown) => { const r = await req(env, "POST", "/api/listings", { cookie: c, body }); return [r.status, ((await r.json()) as any).error]; };
  expect(await err(listing({ id: "bob.notes" }))).toEqual([403, "wrong-namespace"]);
  expect(await err(listing({ id: "org.wolos.notes" }))).toEqual([403, "reserved"]);
  expect(await err(listing({ id: "alice.stuff", repo: "bob/stuff" }))).toEqual([403, "not-your-repo"]);
  expect(await err(listing({ repo: "Alice/secret" }))).toEqual([400, "private-repo"]);
  expect(await err(listing({ repo: "Alice/none" }))).toEqual([404, "no-repo"]);
  expect(await err(listing({ asset: "notes.zip" }))).toEqual([400, "bad-asset"]);
  expect(await err(listing({ kind: "plugin" }))).toEqual([400, "bad-asset"]);
  expect(await err(listing({ kind: "extension", asset: "x.ext" }))).toEqual([400, "bad-field"]);
  expect(await err(listing({ host: "org.wolos.craft" }))).toEqual([400, "bad-host"]);
  expect(await err(listing({ id: "Notes" }))).toEqual([400, "bad-id"]);
  expect(await err(listing({ kind: "theme" }))).toEqual([400, "bad-kind"]);
  const ok = await req(env, "POST", "/api/listings", { cookie: c, body: listing({ id: "alice.craft-ext", kind: "extension", host: "org.wolos.craft", asset: "ext.tar" }) });
  expect(ok.status).toBe(201);
  expect(((await ok.json()) as any).host).toBe("org.wolos.craft");
});

test("only a GitHub owner may link an organisation; members then publish under it", async () => {
  gh.orgs.set(alice.id, [{ id: 501, login: "examplelabs", role: "admin" }]);
  gh.orgs.set(bob.id, [{ id: 501, login: "examplelabs", role: "member" }]);
  const a = await signIn(env, gh, alice), b = await signIn(env, gh, bob);
  await acceptCla(env, a); await acceptCla(env, b);
  const cla = await (await req(env, "GET", "/api/cla")).json() as any;
  const link = (c: string, org = "examplelabs") => req(env, "POST", "/api/orgs", { cookie: c, body: { org, version: cla.version, sha256: cla.sha256 } });
  const orgListing = listing({ id: "examplelabs.tool", repo: "examplelabs/tool", owner: "examplelabs", asset: "tool.wol" });

  expect(((await (await req(env, "POST", "/api/listings", { cookie: b, body: orgListing })).json()) as any).error).toBe("org-not-linked");
  const rb = await link(b);
  expect(rb.status).toBe(403);
  expect(((await rb.json()) as any).error).toBe("not-owner");
  expect((await link(a, "otherorg")).status).toBe(404);
  const ra = await link(a);
  expect(ra.status).toBe(201);
  expect(((await ra.json()) as any).org).toMatchObject({ github_org_id: 501, role: "owner", linked: true, cla: { ok: true } });

  // Bob, a member, publishes under the organisation; roles are asked of GitHub at that moment.
  expect((await req(env, "POST", "/api/listings", { cookie: b, body: orgListing })).status).toBe(201);
  gh.orgs.set(bob.id, []); // Bob leaves the organisation on GitHub
  const r = await req(env, "POST", "/api/listings", { cookie: b, body: { ...orgListing, id: "examplelabs.tool2" } });
  expect(((await r.json()) as any).error).toBe("not-a-member");
  const orgs = await (await req(env, "GET", "/api/orgs", { cookie: a })).json() as any;
  expect(orgs.orgs[0]).toMatchObject({ login: "examplelabs", role: "owner", linked: true });
});

test("org link needs the hub's origin and the person's own CLA", async () => {
  gh.orgs.set(alice.id, [{ id: 501, login: "examplelabs", role: "admin" }]);
  const a = await signIn(env, gh, alice);
  const cla = await (await req(env, "GET", "/api/cla")).json() as any;
  const body = { org: "examplelabs", version: cla.version, sha256: cla.sha256 };
  expect((await req(env, "POST", "/api/orgs", { cookie: a, body, origin: "https://evil.test" })).status).toBe(403);
  expect(((await (await req(env, "POST", "/api/orgs", { cookie: a, body })).json()) as any).error).toBe("cla-needed");
});

test("reports: account age, reason, visibility to the reporter only, daily cap", async () => {
  const a = await signIn(env, gh, alice);
  await acceptCla(env, a);
  await req(env, "POST", "/api/listings", { cookie: a, body: listing() });
  const b = await signIn(env, gh, bob);
  const rep = (body: Record<string, unknown>, c = b) => req(env, "POST", "/api/reports", { cookie: c, body: { listing_id: "alice.notes", reason: "broken", text: "It does not start.", ...body } });
  expect(((await (await rep({ reason: "ugly" })).json()) as any).error).toBe("bad-reason");
  expect((await rep({ text: "x".repeat(2001) })).status).toBe(400);
  expect((await rep({ listing_id: "alice.none" })).status).toBe(404);
  const r = await rep({});
  expect(r.status).toBe(201);
  const id = ((await r.json()) as any).report.id;
  expect((await req(env, "GET", `/api/reports/${id}`, { cookie: b })).status).toBe(200);
  expect((await req(env, "GET", `/api/reports/${id}`, { cookie: a })).status).toBe(404);
  env.DB.sqlite.exec("UPDATE persons SET role = 'moderator' WHERE github_id = 1001");
  expect(((await (await req(env, "GET", `/api/reports/${id}`, { cookie: a })).json()) as any).report.state).toBe("open");
  // The audit log never names the reporter.
  expect(env.DB.sqlite.query("SELECT actor_id FROM audit_log WHERE action = 'report.open'").get()).toEqual({ actor_id: null });
  // Five attempts a day, refused ones included (three bad requests + one report above + one more).
  expect((await rep({})).status).toBe(201);
  const capped = await rep({});
  expect(capped.status).toBe(429);
  expect(Number(capped.headers.get("retry-after"))).toBeGreaterThan(0);
  // A brand-new GitHub account cannot report.
  const young = await signIn(env, gh, { id: 1003, login: "carol", name: "C", created_at: new Date().toISOString() });
  expect(((await (await rep({}, young)).json()) as any).error).toBe("account-too-new");
});

test("webhook: signature checked, release recorded once, redelivery and replays idempotent", async () => {
  const a = await signIn(env, gh, alice);
  await acceptCla(env, a);
  await req(env, "POST", "/api/listings", { cookie: a, body: listing() });
  const ev = (tag: string, assets = [{ name: `notes-${tag}.wol`, browser_download_url: `https://github.com/Alice/notes/releases/download/${tag}/notes-${tag}.wol`, size: 1234 }]) => ({
    action: "published", release: { tag_name: tag, draft: false, prerelease: false, assets },
    repository: { id: 9001, full_name: "Alice/notes" },
  });
  expect((await hook(env, "release", ev("v1.0.0"), undefined, "wrong-secret")).status).toBe(401);
  const d = crypto.randomUUID();
  const r1 = await hook(env, "release", ev("v1.0.0"), d);
  expect(((await r1.json()) as any).outcome).toEqual({ "alice.notes": "pending" });
  const r2 = await hook(env, "release", ev("v1.0.0"), d);
  expect(((await r2.json()) as any).duplicate).toBe(true);
  // A new delivery of the same release (e.g. GitHub re-sent with a new id) does not duplicate or overwrite.
  await hook(env, "release", ev("v1.0.0", [{ name: "notes-v1.0.0.wol", browser_download_url: "https://evil.test/x", size: 1 }]));
  const rows = env.DB.sqlite.query("SELECT version, asset_url, verdict FROM releases").all() as any[];
  expect(rows.length).toBe(1);
  expect(rows[0]).toMatchObject({ version: "1.0.0", verdict: "pending" });
  expect(rows[0].asset_url).toContain("github.com/Alice/notes");
  const l = await (await req(env, "GET", "/api/listings/alice.notes")).json() as any;
  expect(l.status).toBe("checking");
  // No asset matching the pattern: nothing recorded.
  expect(((await (await hook(env, "release", ev("v2", []))).json()) as any).outcome).toEqual({ "alice.notes": "no-asset" });
  // Unrelated repositories and events are acknowledged and ignored.
  expect((await hook(env, "ping", { zen: "hi" })).status).toBe(200);
  // A transferred repository withdraws its listings.
  await hook(env, "repository", { action: "transferred", repository: { id: 9001, full_name: "mallory/notes" } });
  expect(((await (await req(env, "GET", "/api/listings/alice.notes")).json()) as any).status).toBe("withdrawn");
});

test("webhook bodies over the cap are refused before parsing", async () => {
  const big = { action: "published", pad: "x".repeat(600 * 1024) };
  expect((await hook(env, "release", big)).status).toBe(413);
});
