// SPDX-License-Identifier: GPL-2.0-or-later
// The admin panel's reports, takedowns, and the check's facts in the export.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { acceptCla, alice, bob, carol, claims, FakeGitHub, hook, install, jwt, makeEnv, oidcKey, req, signIn } from "./harness";

let gh: FakeGitHub, undo: () => void, env: ReturnType<typeof makeEnv>, key: Awaited<ReturnType<typeof oidcKey>>, ca: string, cb: string;
const SHA = "ab".repeat(32);
const CERT = "0123456789abcdef";
const URLS = { notes: "https://github.com/Alice/notes/releases/download/v1.0.0/notes.wol", clock: "https://github.com/Alice/clock/releases/download/v2.0.0/clock.wolplug" };

beforeEach(async () => {
  gh = new FakeGitHub(); undo = install(gh); env = makeEnv();
  key = await oidcKey(gh);
  gh.repos.set("Alice/notes", { id: 9001, full_name: "Alice/notes", private: false, owner: { id: 1001, login: "Alice", type: "User" } });
  gh.repos.set("Alice/clock", { id: 9002, full_name: "Alice/clock", private: false, owner: { id: 1001, login: "Alice", type: "User" } });
  ca = await signIn(env, gh, alice);
  await acceptCla(env, ca);
  const base = { license: "MIT", summary: "A thing." };
  await req(env, "POST", "/api/listings", { cookie: ca, body: { ...base, id: "alice.notes", kind: "app", repo: "Alice/notes", asset: "notes.wol", name: "Notes" } });
  await req(env, "POST", "/api/listings", { cookie: ca, body: { ...base, id: "alice.clock", kind: "plugin", repo: "Alice/clock", asset: "clock.wolplug", name: "Clock" } });
  await hook(env, "release", { action: "published", repository: { id: 9001, full_name: "Alice/notes" },
    release: { tag_name: "v1.0.0", draft: false, prerelease: false, assets: [{ name: "notes.wol", browser_download_url: URLS.notes, size: 10 }] } });
  await hook(env, "release", { action: "published", repository: { id: 9002, full_name: "Alice/clock" },
    release: { tag_name: "v2.0.0", draft: false, prerelease: false, assets: [{ name: "clock.wolplug", browser_download_url: URLS.clock, size: 20 }] } });
  cb = await signIn(env, gh, bob);
});
afterEach(() => undo());

const check = async () => ({ authorization: `Bearer ${await jwt(key, claims("check"))}` });
const sign = async () => ({ authorization: `Bearer ${await jwt(key, claims("sign"))}` });
const verdicts = async (list: unknown[]) => req(env, "POST", "/api/pipeline/verdicts", { origin: null, headers: await check(), body: { verdicts: list } });
const exported = async () => (await (await req(env, "GET", "/api/pipeline/export", { headers: await sign() })).json()) as any;

test("verdicts carry kinds, permissions, min_wolos, trust and cert into the export (plugins keep 0.12's kinds)", async () => {
  const v = await verdicts([
    { listing_id: "alice.clock", version: "2.0.0", verdict: "pass", sha256: SHA, size: 20, findings: [],
      kinds: ["panel", "panel"], permissions: ["network", "time"], min_wolos: "0.13", trust: "trusted", cert: CERT },
    { listing_id: "alice.notes", version: "1.0.0", verdict: "flag", sha256: SHA, size: 10, findings: [],
      kinds: ["ignored-for-apps"], permissions: ["network"], min_wolos: "", trust: "invalid", cert: CERT },
  ]);
  expect(((await v.json()) as any).results.map((r: any) => r.stored)).toEqual(["pass", "flag"]);
  const ex = await exported();
  expect(ex.plugins).toHaveLength(1);
  expect(ex.plugins[0]).toMatchObject({ id: "alice.clock", kinds: ["panel"], permissions: ["network", "time"], min_wolos: "0.13", trust: "trusted", cert: CERT });
  expect(((await (await req(env, "GET", "/api/listings/alice.clock")).json()) as any).releases[0]).toMatchObject({ trust: "trusted", cert: CERT });
  // 0.12 reads id, version, kinds, url, sha256 first: they are all there
  expect(Object.keys(ex.plugins[0]).slice(0, 9)).toEqual(["id", "name", "version", "summary", "author", "license", "kinds", "permissions", "min_wolos"]);
  // an app never carries kinds or permissions; an invalid signature shows as community, without a cert
  expect(ex.apps[0]).toMatchObject({ id: "alice.notes", trust: "community" });
  for (const k of ["kinds", "permissions", "min_wolos", "cert"]) expect(ex.apps[0][k]).toBeUndefined();
  expect(env.DB.sqlite.query("SELECT signature, cert FROM release_facts WHERE listing_id = 'alice.notes'").get()).toEqual({ signature: "invalid", cert: CERT });
  expect(ex.withdrawn).toEqual([]);
  // hubcheck's trust as the index shows it: origin stays, an older hubcheck's verified is origin
  for (const [sig, shown] of [["origin", "origin"], ["verified", "origin"], ["wolos", "wolos"], ["withdrawn", "community"], ["community", "community"]]) {
    await verdicts([{ listing_id: "alice.clock", version: "2.0.0", verdict: "pass", sha256: SHA, trust: sig, cert: CERT }]);
    const p = (await exported()).plugins[0];
    expect([sig, p.trust, p.cert]).toEqual([sig, shown, shown === "community" ? undefined : CERT]);
  }
  // a verdict without facts (today's check job) keeps the export as it was
  const old = await verdicts([{ listing_id: "alice.clock", version: "2.0.0", verdict: "pass", sha256: SHA }]);
  expect(old.status).toBe(200);
});

test("bad facts are refused", async () => {
  const post = async (over: Record<string, unknown>) => (await verdicts([{ listing_id: "alice.clock", version: "2.0.0", verdict: "pass", sha256: SHA, ...over }])).status;
  expect(await post({ kinds: "panel" })).toBe(400);
  expect(await post({ kinds: Array.from({ length: 17 }, (_, i) => `k${i}`) })).toBe(400);
  expect(await post({ permissions: ["has space"] })).toBe(400);
  expect(await post({ min_wolos: "latest" })).toBe(400);
  expect(await post({ trust: "safe" })).toBe(400);
  expect(await post({ cert: "XYZ" })).toBe(400);
  expect(await post({ kinds: [], permissions: [], min_wolos: null, trust: null, cert: null })).toBe(200);
});

test("admins see open reports; resolve closes one, takedown withdraws the listing and the export names it", async () => {
  await verdicts([{ listing_id: "alice.notes", version: "1.0.0", verdict: "pass", sha256: SHA, size: 10 }]);
  const rep = async (reason: string) => ((await (await req(env, "POST", "/api/reports", { cookie: cb, body: { listing_id: "alice.notes", reason, text: "It deletes files." } })).json()) as any).report.id;
  const r1 = await rep("broken"), r2 = await rep("malware");
  expect((await req(env, "GET", "/api/admin/queue", { cookie: cb })).status).toBe(403);
  expect((await req(env, "POST", `/api/admin/reports/${r1}/resolve`, { cookie: cb })).status).toBe(403);
  const a = await signIn(env, gh, carol);
  const q = (await (await req(env, "GET", "/api/admin/queue", { cookie: a })).json()) as any;
  expect(q.reports.map((r: any) => [r.id, r.reason, r.listing.id, r.listing.status])).toEqual([[r1, "broken", "alice.notes", "listed"], [r2, "malware", "alice.notes", "listed"]]);
  expect(q.requests).toEqual([]);
  // an admin may read any report
  expect((await req(env, "GET", `/api/reports/${r1}`, { cookie: a })).status).toBe(200);

  const res = await req(env, "POST", `/api/admin/reports/${r1}/resolve`, { cookie: a, body: { note: "Works for me on 0.12." } });
  expect(((await res.json()) as any).report).toEqual({ id: r1, state: "dismissed", action: "resolved" });
  expect((await req(env, "POST", `/api/admin/reports/${r1}/resolve`, { cookie: a })).status).toBe(409);
  expect(((await exported()).apps).map((x: any) => x.id)).toEqual(["alice.notes"]);

  expect((await req(env, "POST", `/api/admin/reports/${r2}/takedown`, { cookie: a, origin: "https://evil.test" })).status).toBe(403);
  const td = await req(env, "POST", `/api/admin/reports/${r2}/takedown`, { cookie: a, body: { note: "Confirmed: it deletes files." } });
  expect(((await td.json()) as any)).toEqual({ report: { id: r2, state: "actioned", action: "takedown" }, listing: { id: "alice.notes", status: "withdrawn" } });
  expect(((await (await req(env, "GET", "/api/listings/alice.notes")).json()) as any).status).toBe("withdrawn");
  const ex = await exported();
  expect(ex.apps).toEqual([]);
  expect(ex.withdrawn).toHaveLength(1);
  expect(ex.withdrawn[0]).toMatchObject({ id: "alice.notes", kind: "app", reason: "takedown" });
  expect(((await (await req(env, "GET", "/api/index/preview")).json()) as any).withdrawn[0].id).toBe("alice.notes");
  // the reporter sees the outcome
  expect(((await (await req(env, "GET", `/api/reports/${r2}`, { cookie: cb })).json()) as any).report).toMatchObject({ state: "actioned", action: "takedown" });
  expect((await req(env, "POST", "/api/admin/reports/999/takedown", { cookie: a })).status).toBe(404);

  const log = env.DB.sqlite.query("SELECT actor_id, action, target FROM audit_log WHERE action IN ('report.resolve','listing.takedown') ORDER BY id").all();
  expect(log).toEqual([
    { actor_id: "1003", action: "report.resolve", target: `report:${r1}` },
    { actor_id: "1003", action: "listing.takedown", target: "listing:alice.notes" },
  ]);
});

test("a repository that changed hands is named withdrawn with reason transferred, once it had been listed", async () => {
  await verdicts([{ listing_id: "alice.clock", version: "2.0.0", verdict: "pass", sha256: SHA, size: 20 }]);
  await hook(env, "repository", { action: "transferred", repository: { id: 9002, full_name: "mallory/clock" } });
  await hook(env, "repository", { action: "transferred", repository: { id: 9001, full_name: "mallory/notes" } }); // never listed
  const ex = await exported();
  expect(ex.withdrawn.map((w: any) => [w.id, w.reason])).toEqual([["alice.clock", "transferred"]]);
});
