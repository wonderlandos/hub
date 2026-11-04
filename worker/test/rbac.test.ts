// SPDX-License-Identifier: GPL-2.0-or-later
// The closed admin panel: roles with least rights, two-factor authentication (at sign-in and hourly), 404 for anyone
// without a role, noindex, per-role rate limits, and every action in audit_log with actor, role, reason and address class.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { acceptCla, alice, bob, carol, dave, erin, FakeGitHub, type FakeUser, hook, install, makeEnv, req, shiftClock, signIn } from "./harness";
import { GRANTS, ROLE_RULES } from "../src/roles";

let gh: FakeGitHub, undo: () => void, env: ReturnType<typeof makeEnv>;
beforeEach(() => { gh = new FakeGitHub(); undo = install(gh); env = makeEnv(); });
afterEach(() => undo());

const NOT_FOUND = { error: "not-found", sentence: "There is nothing at this address." };
const status = async (cookie: string | undefined, method: string, path: string, body?: unknown) => (await req(env, method, path, { cookie, body })).status;
async function grant(owner: string, login: string, role: string, reason = "Helps with the queue.") {
  return req(env, "POST", "/api/admin/roles", { cookie: owner, body: { login, role, reason } });
}
/** A listing with one checked release and one open report, for the report and flag routes. */
async function listingWithReport(reporter: string) {
  gh.repos.set("Alice/notes", { id: 9001, full_name: "Alice/notes", private: false, owner: { id: 1001, login: "Alice", type: "User" } });
  const ca = await signIn(env, gh, alice);
  await acceptCla(env, ca);
  await req(env, "POST", "/api/listings", { cookie: ca, body: { id: "alice.notes", kind: "app", repo: "Alice/notes", asset: "notes.wol", name: "Notes", summary: "Notes.", license: "MIT" } });
  await hook(env, "release", { action: "published", repository: { id: 9001, full_name: "Alice/notes" },
    release: { tag_name: "v1.0.0", draft: false, prerelease: false, assets: [{ name: "notes.wol", browser_download_url: "https://github.com/Alice/notes/releases/download/v1.0.0/notes.wol", size: 10 }] } });
  const r = await req(env, "POST", "/api/reports", { cookie: reporter, body: { listing_id: "alice.notes", reason: "broken", text: "It crashes." } });
  return ((await r.json()) as any).report.id as number;
}

test("anyone without a role gets the router's own 404 on every panel route, with noindex; no 401, 403, 405 or 429 leaks", async () => {
  const unknown = await req(env, "GET", "/api/admin/nothing-here");
  expect([unknown.status, await unknown.json()]).toEqual([404, NOT_FOUND]);
  const b = await signIn(env, gh, bob);
  const paths: [string, string][] = [
    ["GET", "/api/admin/queue"], ["GET", "/api/admin/roles"], ["POST", "/api/admin/roles"], ["POST", "/api/admin/requests/r-1/approve"],
    ["POST", "/api/admin/requests/r-1/refuse"], ["POST", "/api/admin/certs/0123456789abcdef/revoke"], ["POST", "/api/admin/certs/0123456789abcdef/downgrade"],
    ["POST", "/api/admin/revocations/g-1/approve"], ["POST", "/api/admin/reports/1/resolve"], ["POST", "/api/admin/reports/1/takedown"],
    ["POST", "/api/admin/releases/alice.notes/1.0.0/flag"], ["GET", "/api/admin/requests/r-1/approve"], ["DELETE", "/api/admin/queue"],
  ];
  for (const cookie of [undefined, b]) {
    for (const [m, p] of paths) {
      const r = await req(env, m, p, { cookie, origin: "https://evil.test" });
      expect([m, p, r.status, await r.json(), r.headers.get("x-robots-tag")]).toEqual([m, p, 404, NOT_FOUND, "noindex, nofollow, noarchive"]);
    }
  }
  // many tries from one address: still 404, never 429
  for (let i = 0; i < 70; i++) expect(await status(undefined, "POST", "/api/admin/requests/r-1/approve")).toBe(404);
  // /api/me says nothing about the panel to someone without a role
  const me = (await (await req(env, "GET", "/api/me", { cookie: b })).json()) as any;
  expect(me.admin).toBe(false);
  expect(me.admin_role).toBeUndefined();
  // public routes carry no noindex header (the site decides there)
  expect((await req(env, "GET", "/api/cla")).headers.get("x-robots-tag")).toBeNull();
});

test("ADMINS are owners, seeded at sign-in; a role needs two-factor authentication, checked at sign-in and again every hour", async () => {
  const c = await signIn(env, gh, carol);
  expect(env.DB.sqlite.query("SELECT github_id, role, granted_by FROM admin_roles").all()).toEqual([{ github_id: 1003, role: "owner", granted_by: "ADMINS" }]);
  expect(((await (await req(env, "GET", "/api/me", { cookie: c })).json()) as any)).toMatchObject({ admin: true, admin_role: "owner", two_factor: true });
  expect(((await (await req(env, "GET", "/api/admin/queue", { cookie: c })).json()) as any).role).toBe("owner");
  // an owner without two-factor authentication on GitHub: the panel does not exist for them
  const noTfa: FakeUser = { ...dave, two_factor_authentication: false };
  const d = await signIn(env, gh, noTfa);
  expect(await status(d, "GET", "/api/admin/queue")).toBe(404);
  expect(((await (await req(env, "GET", "/api/me", { cookie: d })).json()) as any).admin).toBe(false);
  // the hourly re-check: carol turns two-factor off on GitHub; within the hour the stored answer holds, after it the panel closes
  gh.addUser({ ...carol, two_factor_authentication: false });
  const callsBefore = gh.calls.filter((x) => x.endsWith("/user")).length;
  expect(await status(c, "GET", "/api/admin/queue")).toBe(200);
  expect(gh.calls.filter((x) => x.endsWith("/user")).length).toBe(callsBefore); // not asked again within the hour
  const back = shiftClock(3601);
  try {
    expect(await status(c, "GET", "/api/admin/queue")).toBe(404);
    expect(env.DB.sqlite.query("SELECT two_factor FROM persons WHERE github_id = 1003").get()).toEqual({ two_factor: 0 });
    gh.addUser(carol); // back on: a stored 0 is asked again at once, and the panel opens
    expect(await status(c, "GET", "/api/admin/queue")).toBe(200);
  } finally { back(); }
  // a GitHub answer without the field counts as off
  gh.addUser({ ...carol, two_factor_authentication: undefined });
  const e = await signIn(env, gh, { ...carol, two_factor_authentication: undefined });
  expect(await status(e, "GET", "/api/admin/queue")).toBe(404);
  // a seeded row counts only while the login is in ADMINS
  env.ADMINS = "dave";
  gh.addUser(carol);
  const c2 = await signIn(env, gh, carol);
  expect(await status(c2, "GET", "/api/admin/queue")).toBe(404);
});

test("least rights per role: owner everything, admin no roles or resolve, reviewer requests and flags, support reports", async () => {
  expect(GRANTS.owner).toContain("roles.manage");
  expect(GRANTS.admin).not.toContain("roles.manage");
  expect(GRANTS.admin).not.toContain("report.resolve");
  expect(GRANTS.reviewer).toEqual(["queue.requests", "request.approve", "request.refuse", "release.flag"]);
  expect(GRANTS.support).toEqual(["queue.reports", "report.resolve"]);
  const owner = await signIn(env, gh, carol);
  const b = await signIn(env, gh, bob);
  const e = await signIn(env, gh, erin);
  const a = await signIn(env, gh, alice);
  expect((await grant(owner, "bob", "reviewer")).status).toBe(200);
  expect((await grant(owner, "erin", "support")).status).toBe(200);
  expect((await grant(owner, "Alice", "admin")).status).toBe(200);
  const rep = await listingWithReport(await signIn(env, gh, dave));

  // reviewer: requests in the queue, no reports; flags a release; cannot resolve, take down, revoke or grant
  const qb = (await (await req(env, "GET", "/api/admin/queue", { cookie: b })).json()) as any;
  expect([qb.role, "requests" in qb, "reports" in qb, "revocations" in qb]).toEqual(["reviewer", true, false, false]);
  expect(await status(b, "POST", `/api/admin/reports/${rep}/resolve`)).toBe(403);
  expect(await status(b, "POST", `/api/admin/reports/${rep}/takedown`)).toBe(403);
  expect(await status(b, "POST", "/api/admin/certs/0123456789abcdef/revoke", { reason: "abuse" })).toBe(403);
  expect(await status(b, "GET", "/api/admin/roles")).toBe(403);
  expect(await status(b, "POST", "/api/admin/releases/alice.notes/1.0.0/flag", { reason: "Asks for the network without saying why." })).toBe(200);
  // support: reports only
  const qe = (await (await req(env, "GET", "/api/admin/queue", { cookie: e })).json()) as any;
  expect([qe.role, "requests" in qe, "reports" in qe]).toEqual(["support", false, true]);
  expect(await status(e, "POST", "/api/admin/requests/r-1/approve")).toBe(403);
  expect(await status(e, "POST", "/api/admin/releases/alice.notes/1.0.0/flag", { reason: "x" })).toBe(403);
  // admin: takedown yes, resolve and roles no
  expect(await status(a, "GET", "/api/admin/roles")).toBe(403);
  expect(await status(a, "POST", `/api/admin/reports/${rep}/resolve`)).toBe(403);
  expect(await status(e, "POST", `/api/admin/reports/${rep}/resolve`, { note: "Works here." })).toBe(200);
  // owner: the roles list
  const roles = (await (await req(env, "GET", "/api/admin/roles", { cookie: owner })).json()) as any;
  expect(roles.roles.map((r: any) => [r.login, r.role, r.seeded])).toEqual([["Alice", "admin", false], ["Dave", "owner", true], ["carol-ca", "owner", true], ["bob", "reviewer", false], ["erin", "support", false]]);
  // taking a role away closes the panel for them
  expect((await grant(owner, "erin", "none", "Left the team.")).status).toBe(200);
  expect(await status(e, "GET", "/api/admin/queue")).toBe(404);
});

test("granting roles: owner only, a reason, a person who signed in with two-factor, never yourself or an ADMINS owner", async () => {
  const owner = await signIn(env, gh, carol);
  expect((await req(env, "POST", "/api/admin/roles", { cookie: owner, body: { login: "bob", role: "admin" } })).status).toBe(400);
  expect(((await (await grant(owner, "bob", "admin")).json()) as any).error).toBe("no-person");
  await signIn(env, gh, { ...bob, two_factor_authentication: false });
  expect(((await (await grant(owner, "bob", "admin")).json()) as any).error).toBe("two-factor-needed");
  expect(((await (await grant(owner, "carol-ca", "support")).json()) as any).error).toBe("own-role");
  await signIn(env, gh, dave);
  expect(((await (await grant(owner, "dave", "support")).json()) as any).error).toBe("seeded");
  await signIn(env, gh, bob);
  expect(((await (await grant(owner, "bob", "god")).json()) as any).error).toBe("bad-field");
  expect((await req(env, "POST", "/api/admin/roles", { cookie: owner, origin: "https://evil.test", body: { login: "bob", role: "admin", reason: "x" } })).status).toBe(403);
  expect((await grant(owner, "bob", "admin")).status).toBe(200);
});

test("every panel action is in audit_log with actor, role, target, reason and the address class, never the address", async () => {
  const owner = await signIn(env, gh, carol);
  await signIn(env, gh, bob);
  await grant(owner, "bob", "reviewer", "New reviewer for plugins.");
  const rows = env.DB.sqlite.query("SELECT actor_kind, actor_id, action, target, detail FROM audit_log WHERE action = 'role.set'").all() as any[];
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ actor_kind: "person", actor_id: "1003", action: "role.set", target: "person:1002" });
  expect(JSON.parse(rows[0].detail)).toEqual({ actor: "carol-ca", role: "owner", reason: "New reviewer for plugins.", ip_class: "v4", login: "bob", from: null, to: "reviewer" });
  const all = JSON.stringify(env.DB.sqlite.query("SELECT * FROM audit_log").all());
  expect(all).not.toContain("203.0.113.7");
  // IPv6 is classed too
  await req(env, "POST", "/api/admin/roles", { cookie: owner, ip: "2001:db8::1", body: { login: "bob", role: "support", reason: "Moved." } });
  const last = env.DB.sqlite.query("SELECT detail FROM audit_log WHERE action = 'role.set' ORDER BY id DESC LIMIT 1").get() as any;
  expect(JSON.parse(last.detail)).toMatchObject({ ip_class: "v6", from: "reviewer", to: "support" });
});

test("each role has its own hourly write limit", async () => {
  expect(ROLE_RULES.support).toEqual({ name: "admin-support", limit: 60, window: 3600 });
  const owner = await signIn(env, gh, carol);
  const e = await signIn(env, gh, erin);
  await grant(owner, "erin", "support");
  let last = 0;
  // inside one hour window (start just after the next full hour), spread over minutes so the per-minute limits do not hit first
  const nowS = Math.floor(Date.now() / 1000);
  const toHour = Math.ceil(nowS / 3600) * 3600 + 5 - nowS;
  const e2 = await (async () => { const back = shiftClock(toHour); try { return await signIn(env, gh, erin); } finally { back(); } })();
  for (let i = 0; i < 61; i++) {
    const back = shiftClock(toHour + Math.floor(i / 20) * 61);
    try { last = await status(e2, "POST", "/api/admin/reports/99/resolve"); } finally { back(); }
    if (i < 60) expect(last).toBe(404); // no such report, but counted
  }
  expect(last).toBe(429);
});
