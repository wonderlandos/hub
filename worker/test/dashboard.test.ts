// SPDX-License-Identifier: GPL-2.0-or-later
// The author's dashboard (/api/my/listings), organisation members, withdrawing one version, and the audit log.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { acceptCla, alice, bob, carol, claims, dave, erin, FakeGitHub, hook, install, jwt, makeEnv, oidcKey, req, signIn } from "./harness";

let gh: FakeGitHub, undo: () => void, env: ReturnType<typeof makeEnv>, key: Awaited<ReturnType<typeof oidcKey>>, ca: string;
const SHA = "ab".repeat(32);
const url = (repo: string, tag: string, f: string) => `https://github.com/${repo}/releases/download/${tag}/${f}`;
const bearer = async (job: "check" | "sign" | "ca") => ({ authorization: `Bearer ${await jwt(key, claims(job))}` });
const release = (id: number, repo: string, tag: string, f: string) => hook(env, "release", { action: "published", repository: { id, full_name: repo },
  release: { tag_name: tag, draft: false, prerelease: false, assets: [{ name: f, browser_download_url: url(repo, tag, f), size: 10 }] } });
const verdict = async (listing_id: string, version: string, v = "pass", findings: unknown[] = []) =>
  req(env, "POST", "/api/pipeline/verdicts", { origin: null, headers: await bearer("check"), body: { verdicts: [{ listing_id, version, verdict: v, sha256: SHA, findings }] } });

beforeEach(async () => {
  gh = new FakeGitHub(); undo = install(gh); env = makeEnv();
  key = await oidcKey(gh);
  gh.repos.set("Alice/notes", { id: 9001, full_name: "Alice/notes", private: false, owner: { id: 1001, login: "Alice", type: "User" } });
  gh.repos.set("examplelabs/tool", { id: 9100, full_name: "examplelabs/tool", private: false, owner: { id: 501, login: "examplelabs", type: "Organization" } });
  gh.orgs.set(alice.id, [{ id: 501, login: "examplelabs", role: "admin" }]);
  gh.orgs.set(bob.id, [{ id: 501, login: "examplelabs", role: "member" }]);
  ca = await signIn(env, gh, alice);
  await acceptCla(env, ca);
  const cla = (await (await req(env, "GET", "/api/cla")).json()) as any;
  await req(env, "POST", "/api/orgs", { cookie: ca, body: { org: "examplelabs", version: cla.version, sha256: cla.sha256 } });
  const base = { kind: "app", license: "MIT", summary: "A thing." };
  await req(env, "POST", "/api/listings", { cookie: ca, body: { ...base, id: "alice.notes", repo: "Alice/notes", asset: "notes.wol", name: "Notes" } });
  await req(env, "POST", "/api/listings", { cookie: ca, body: { ...base, id: "examplelabs.tool", repo: "examplelabs/tool", asset: "tool.wol", name: "Tool", owner: "examplelabs" } });
  await release(9001, "Alice/notes", "v1.0.0", "notes.wol");
  await release(9001, "Alice/notes", "v1.1.0", "notes.wol");
  await release(9100, "examplelabs/tool", "v2.0.0", "tool.wol");
});
afterEach(() => undo());

test("GET /api/my/listings: own and organisation listings, every version with its status and findings, unlisted ones too", async () => {
  await verdict("alice.notes", "1.0.0", "pass");
  await verdict("alice.notes", "1.1.0", "block", [{ rule: "pkg/bad", sentence: "Broken archive.", evidence: "x" }]);
  const r = await req(env, "GET", "/api/my/listings", { cookie: ca });
  const b = (await r.json()) as any;
  expect(b.listings.map((l: any) => l.id)).toEqual(["alice.notes", "examplelabs.tool"]);
  const notes = b.listings[0];
  const byVersion = (rs: any[]) => rs.map((x: any) => [x.version, x.status, x.findings]).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  expect(byVersion(notes.releases)).toEqual([["1.0.0", "listed", []], ["1.1.0", "block", [{ rule: "pkg/bad", sentence: "Broken archive." }]]]);
  expect(b.listings[1].releases.map((x: any) => [x.version, x.status])).toEqual([["2.0.0", "checking"]]);
  // bob sees the organisation's listing only; signed out: 401
  const bb = await signIn(env, gh, bob);
  expect(((await (await req(env, "GET", "/api/my/listings", { cookie: bb })).json()) as any).listings.map((l: any) => l.id)).toEqual(["examplelabs.tool"]);
  expect((await req(env, "GET", "/api/my/listings")).status).toBe(401);
});

test("GET /api/orgs/<login>/members: the members and roles the Worker knows, for members only", async () => {
  await signIn(env, gh, bob);
  const r = await req(env, "GET", "/api/orgs/ExampleLabs/members", { cookie: ca });
  const b = (await r.json()) as any;
  expect(b.org).toBe("examplelabs");
  expect(b.members.map((m: any) => [m.login, m.role])).toEqual([["Alice", "owner"], ["bob", "member"]]);
  const e = await signIn(env, gh, erin); // not a member
  expect((await req(env, "GET", "/api/orgs/examplelabs/members", { cookie: e })).status).toBe(404);
  expect((await req(env, "GET", "/api/orgs/nosuchorg/members", { cookie: ca })).status).toBe(404);
  expect((await req(env, "GET", "/api/orgs/examplelabs/members")).status).toBe(401);
});

test("withdraw one version: needs its file certificate and a reason; feeds a withdrawn-version revoke file; export and listing mark it", async () => {
  env.GITHUB_PIPELINE_APP_PRIVATE_KEY = undefined; // the dispatch is recorded as not started; the file is still served
  await verdict("alice.notes", "1.1.0", "pass");
  const a = await signIn(env, gh, carol);
  const w = (body?: unknown, cookie = a) => req(env, "POST", "/api/admin/releases/alice.notes/1.1.0/withdraw", { cookie, body });
  expect((await w()).status).toBe(400);
  expect(((await (await w({ reason: "Ships a miner." })).json()) as any).error).toBe("no-file-certificate");
  const fc = { listing_id: "alice.notes", version: "1.1.0", serial: "abcdefabcdef0123", url: "https://cdn.wolos.org/plugins/statements/abcdefabcdef0123.wsig", checked_at: 1793700000, verdict: "pass" };
  await req(env, "POST", "/api/pipeline/file-certificates", { origin: null, headers: await bearer("sign"), body: { file_certificates: [fc] } });
  // reviewers and support cannot; strangers get 404
  const b = await signIn(env, gh, bob);
  await req(env, "POST", "/api/admin/roles", { cookie: a, body: { login: "bob", role: "reviewer", reason: "r" } });
  expect((await w({ reason: "x" }, b)).status).toBe(403);
  expect((await w({ reason: "x" }, await signIn(env, gh, erin))).status).toBe(404);
  const r = await w({ reason: "Ships a miner." });
  expect(r.status).toBe(202);
  const wd = ((await r.json()) as any).withdrawal;
  expect(wd).toMatchObject({ listing_id: "alice.notes", version: "1.1.0", serial: fc.serial, status: "approved", approved_by: ["carol-ca"] });
  expect(((await (await w({ reason: "again" })).json()) as any).error).toBe("withdrawn-already");
  const q = (await (await req(env, "GET", "/api/admin/queue", { cookie: a })).json()) as any;
  expect(q.withdrawals.map((x: any) => x.id)).toEqual([wd.id]);
  const file = (await (await req(env, "GET", `/api/pipeline/requests/${wd.id}`, { headers: await bearer("ca") })).json()) as any;
  expect(file).toEqual({ format: 1, action: "revoke", id: wd.id, serial: fc.serial, reason: "withdrawn-version", approved_by: ["carol-ca"], note: "Ships a miner." });
  const ex = (await (await req(env, "GET", "/api/pipeline/export", { headers: await bearer("sign") })).json()) as any;
  expect(ex.apps[0]).toMatchObject({ id: "alice.notes", version: "1.1.0", withdrawn: true });
  const l = (await (await req(env, "GET", "/api/listings/alice.notes")).json()) as any;
  expect(l.releases.find((x: any) => x.version === "1.1.0")).toMatchObject({ withdrawn: true, status: "withdrawn" });
  expect(l.releases.find((x: any) => x.version === "1.0.0")).toMatchObject({ withdrawn: false });
  const done = await req(env, "POST", "/api/pipeline/revocations", { origin: null, headers: await bearer("ca"), body: { request_id: wd.id, serial: fc.serial } });
  expect(done.status).toBe(200);
  expect((await req(env, "GET", `/api/pipeline/requests/${wd.id}`, { headers: await bearer("ca") })).status).toBe(404);
  const log = env.DB.sqlite.query("SELECT action FROM audit_log WHERE action LIKE 'release.withdraw%' ORDER BY id").all();
  expect(log).toEqual([{ action: "release.withdraw" }, { action: "release.withdrawn" }]);
});

test("GET /api/admin/audit: owner and admin only, newest first, paged with before", async () => {
  const a = await signIn(env, gh, carol);
  const d = await signIn(env, gh, dave);
  const all = (await (await req(env, "GET", "/api/admin/audit?limit=100", { cookie: a })).json()) as any;
  expect(all.entries.length).toBeGreaterThan(5);
  const ids = all.entries.map((e: any) => e.id);
  expect(ids).toEqual([...ids].sort((x: number, y: number) => y - x));
  expect(all.entries[0]).toMatchObject({ action: "sign-in", actor_kind: "person", actor_login: "Dave" });
  const p1 = (await (await req(env, "GET", "/api/admin/audit?limit=2", { cookie: d })).json()) as any;
  expect(p1.entries.map((e: any) => e.id)).toEqual(ids.slice(0, 2));
  const p2 = (await (await req(env, "GET", `/api/admin/audit?limit=2&before=${p1.next}`, { cookie: d })).json()) as any;
  expect(p2.entries.map((e: any) => e.id)).toEqual(ids.slice(2, 4));
  await signIn(env, gh, bob);
  const b = await signIn(env, gh, bob);
  await req(env, "POST", "/api/admin/roles", { cookie: a, body: { login: "bob", role: "support", reason: "r" } });
  expect((await req(env, "GET", "/api/admin/audit", { cookie: b })).status).toBe(403);
  expect((await req(env, "GET", "/api/admin/audit", { cookie: ca })).status).toBe(404);
});
