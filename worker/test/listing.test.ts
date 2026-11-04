// SPDX-License-Identifier: GPL-2.0-or-later
// Listing metadata from the package (hubcheck's facts), the author's name and summary override, a reviewer's flag,
// and the file certificate the sign job reports for each release.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { acceptCla, alice, bob, carol, claims, FakeGitHub, hook, install, jwt, makeEnv, oidcKey, req, signIn } from "./harness";

let gh: FakeGitHub, undo: () => void, env: ReturnType<typeof makeEnv>, key: Awaited<ReturnType<typeof oidcKey>>, ca: string;
const SHA = "ab".repeat(32);
const ICON = { path: "icon.png", mime: "image/png", w: 256, h: 256, size: 4096, sha256: "11".repeat(32) };
const SHOT = { path: "screenshots/main.webp", mime: "image/webp", w: 1280, h: 800, size: 90000, sha256: "22".repeat(32) };
const FACTS = { name: "Notes Pro", summary: "Write and sort notes.", description: "Notes for WolOS.\nWith folders.", icon: ICON, screenshots: [SHOT], categories: ["Work"], homepage: "https://example.org" };

beforeEach(async () => {
  gh = new FakeGitHub(); undo = install(gh); env = makeEnv();
  key = await oidcKey(gh);
  gh.repos.set("Alice/notes", { id: 9001, full_name: "Alice/notes", private: false, owner: { id: 1001, login: "Alice", type: "User" } });
  ca = await signIn(env, gh, alice);
  await acceptCla(env, ca);
  await req(env, "POST", "/api/listings", { cookie: ca, body: { id: "alice.notes", kind: "app", repo: "Alice/notes", asset: "notes.wol", name: "Notes", summary: "A thing.", license: "MIT" } });
  await hook(env, "release", { action: "published", repository: { id: 9001, full_name: "Alice/notes" },
    release: { tag_name: "v1.0.0", draft: false, prerelease: false, assets: [{ name: "notes.wol", browser_download_url: "https://github.com/Alice/notes/releases/download/v1.0.0/notes.wol", size: 10 }] } });
});
afterEach(() => undo());

const bearer = async (job: "check" | "sign") => ({ authorization: `Bearer ${await jwt(key, claims(job))}` });
const verdict = async (over: Record<string, unknown> = {}) =>
  req(env, "POST", "/api/pipeline/verdicts", { origin: null, headers: await bearer("check"), body: { verdicts: [{ listing_id: "alice.notes", version: "1.0.0", verdict: "pass", sha256: SHA, size: 10, ...over }] } });
const exported = async () => (await (await req(env, "GET", "/api/pipeline/export", { headers: await bearer("sign") })).json()) as any;
const listing = async () => (await (await req(env, "GET", "/api/listings/alice.notes")).json()) as any;
const patch = (body: unknown, cookie = ca) => req(env, "PATCH", "/api/listings/alice.notes", { cookie, body });

test("the package's facts reach the listing and the export: name, summary, description, icon, screenshots", async () => {
  expect((await verdict({ facts: FACTS })).status).toBe(200);
  const e = (await exported()).apps[0];
  const pic = (p: any, ext: string) => ({ sha256: p.sha256, mime: p.mime, w: p.w, h: p.h, size: p.size, file: `${p.sha256}.${ext}` });
  expect(e).toMatchObject({ id: "alice.notes", name: "Notes Pro", summary: "Write and sort notes.", description: "Notes for WolOS.\nWith folders.",
    icon: pic(ICON, "png"), screenshots: [pic(SHOT, "webp")] });
  const l = await listing();
  expect(l).toMatchObject({ name: "Notes Pro", summary: "Write and sort notes.", registered: { name: "Notes", summary: "A thing." }, override: null,
    description: "Notes for WolOS.\nWith folders.", icon: pic(ICON, "png"), screenshots: [pic(SHOT, "webp")] });
  // a package name longer than the index takes (40) is passed over, never cut
  await verdict({ facts: { ...FACTS, name: "N".repeat(41) } });
  expect((await exported()).apps[0].name).toBe("Notes");
  // a later verdict without facts (an older check job) keeps what the last facts said
  await verdict({ facts: null });
  expect((await exported()).apps[0]).toMatchObject({ name: "Notes", summary: "Write and sort notes.", description: "Notes for WolOS.\nWith folders." });
});

test("bad facts are refused", async () => {
  const st = async (facts: unknown) => (await verdict({ facts })).status;
  expect(await st("Notes")).toBe(400);
  expect(await st({ name: "N".repeat(81) })).toBe(400);
  expect(await st({ name: "two\nlines" })).toBe(400);
  expect(await st({ description: "d".repeat(4001) })).toBe(400);
  expect(await st({ icon: { ...ICON, mime: "image/svg+xml" } })).toBe(400);
  expect(await st({ icon: { ...ICON, sha256: "xyz" } })).toBe(400);
  expect(await st({ icon: { ...ICON, w: 0 } })).toBe(400);
  expect(await st({ icon: { ...ICON, size: 3 * 1024 * 1024 } })).toBe(400);
  expect(await st({ icon: { ...ICON, url: "https://evil.test/x.png" } })).toBe(400);
  expect(await st({ screenshots: Array.from({ length: 9 }, () => SHOT) })).toBe(400);
  expect(await st({ name: "Fine", screenshots: [] })).toBe(200);
});

test("the author overrides name and summary only; icon, screenshots and description always come from the package", async () => {
  await verdict({ facts: FACTS });
  expect((await patch({ name: "My Notes" }, ca)).status).toBe(200);
  expect((await exported()).apps[0]).toMatchObject({ name: "My Notes", summary: "Write and sort notes." });
  const r = await patch({ summary: "Notes, fast." });
  expect(((await r.json()) as any)).toMatchObject({ name: "My Notes", summary: "Notes, fast.", override: { name: "My Notes", summary: "Notes, fast." } });
  for (const bad of [{ icon: ICON }, { description: "x" }, { screenshots: [] }, {}, { name: "N".repeat(41) }, { summary: "a\nb" }]) {
    expect([JSON.stringify(bad).slice(0, 30), (await patch(bad)).status]).toEqual([JSON.stringify(bad).slice(0, 30), 400]);
  }
  // null goes back to the package's
  await patch({ name: null });
  expect((await exported()).apps[0]).toMatchObject({ name: "Notes Pro", summary: "Notes, fast." });
  // only the owner, from the hub's pages
  const b = await signIn(env, gh, bob);
  expect((await patch({ name: "Mine now" }, b)).status).toBe(403);
  expect((await req(env, "PATCH", "/api/listings/alice.notes", { cookie: ca, origin: "https://evil.test", body: { name: "x" } })).status).toBe(403);
  expect((await req(env, "PATCH", "/api/listings/alice.none", { cookie: ca, body: { name: "x" } })).status).toBe(404);
  expect(env.DB.sqlite.query("SELECT count(*) AS n FROM audit_log WHERE action = 'listing.override'").get()).toEqual({ n: 3 });
});

test("a reviewer's flag: the release stays listed, verdict flag, the reason first among the findings", async () => {
  await verdict({ findings: [{ rule: "net", sentence: "Uses the network.", evidence: "" }] });
  const a = await signIn(env, gh, carol);
  expect((await req(env, "POST", "/api/admin/releases/alice.notes/1.0.0/flag", { cookie: a })).status).toBe(400);
  expect((await req(env, "POST", "/api/admin/releases/alice.notes/9.9.9/flag", { cookie: a, body: { reason: "x" } })).status).toBe(404);
  expect((await req(env, "POST", "/api/admin/releases/alice.notes/1.0.0/flag", { cookie: a, body: { reason: "Sends data to an undisclosed server." } })).status).toBe(200);
  const e = (await exported()).apps[0];
  expect(e.verdict).toBe("flag");
  expect(e.findings.map((f: any) => f.rule)).toEqual(["hub/reviewer-flag", "net"]);
  expect(e.findings[0].sentence).toBe("Sends data to an undisclosed server.");
  expect((await listing()).releases[0]).toMatchObject({ verdict: "flag", flag: "Sends data to an undisclosed server." });
});

test("the sign job reports each release's file certificate; it is shown on the release", async () => {
  await verdict();
  const fc = { listing_id: "alice.notes", version: "1.0.0", serial: "abcdefabcdef0123", url: "https://cdn.wolos.org/plugins/statements/abcdefabcdef0123.wsig", checked_at: 1793700000, verdict: "pass" };
  const post = async (list: unknown, job: "check" | "sign" = "sign") => req(env, "POST", "/api/pipeline/file-certificates", { origin: null, headers: await bearer(job), body: { file_certificates: list } });
  expect((await listing()).releases[0].file_certificate).toBeNull();
  expect((await post([fc], "check")).status).toBe(401);
  for (const bad of [{ ...fc, serial: "XYZ" }, { ...fc, url: "http://cdn.wolos.org/x.wsig" }, { ...fc, url: "https://cdn.wolos.org/x.json" }, { ...fc, verdict: "block" }, { ...fc, checked_at: -1 }]) {
    expect((await post([bad])).status).toBe(400);
  }
  expect((await post([])).status).toBe(400);
  const r = await post([fc, { ...fc, version: "9.9.9" }]);
  expect(((await r.json()) as any).results.map((x: any) => x.stored)).toEqual(["stored", "unknown-release"]);
  const { listing_id: _l, version: _v, ...shownFc } = fc;
  expect((await listing()).releases[0].file_certificate).toEqual(shownFc);
});
