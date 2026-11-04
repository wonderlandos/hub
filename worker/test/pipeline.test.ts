// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, beforeEach, expect, test } from "bun:test";
import { acceptCla, alice, claims, FakeGitHub, hook, install, jwt, makeEnv, oidcKey, req, signIn } from "./harness";

let gh: FakeGitHub, undo: () => void, env: ReturnType<typeof makeEnv>, key: Awaited<ReturnType<typeof oidcKey>>;
beforeEach(async () => {
  gh = new FakeGitHub(); undo = install(gh); env = makeEnv();
  key = await oidcKey(gh);
  gh.repos.set("Alice/notes", { id: 9001, full_name: "Alice/notes", private: false, owner: { id: 1001, login: "Alice", type: "User" } });
  const c = await signIn(env, gh, alice);
  await acceptCla(env, c);
  await req(env, "POST", "/api/listings", { cookie: c, body: { id: "alice.notes", kind: "app", repo: "Alice/notes", asset: "notes.wol", name: "Notes", summary: "Write notes.", license: "MIT" } });
  await hook(env, "release", { action: "published", repository: { id: 9001, full_name: "Alice/notes" },
    release: { tag_name: "v1.2.0", draft: false, prerelease: false, assets: [{ name: "notes.wol", browser_download_url: "https://github.com/Alice/notes/releases/download/v1.2.0/notes.wol", size: 4096 }] } });
});
afterEach(() => undo());

const bearer = async (job: "check" | "sign", over: Record<string, unknown> = {}, k = key) => ({ authorization: `Bearer ${await jwt(k, claims(job, over))}` });
const SHA = "ab".repeat(32);

test("the check job fetches pending releases and posts a verdict that lists the release", async () => {
  const p = await req(env, "GET", "/api/pipeline/pending", { headers: await bearer("check") });
  expect(p.status).toBe(200);
  const rel = ((await p.json()) as any).releases;
  expect(rel).toHaveLength(1);
  expect(rel[0]).toMatchObject({ listing_id: "alice.notes", version: "1.2.0", tag: "v1.2.0", asset_name: "notes.wol", size: 4096, previous: null });
  expect(((await (await req(env, "GET", "/api/index/preview")).json()) as any).apps).toEqual([]);

  const v = await req(env, "POST", "/api/pipeline/verdicts", { origin: null, headers: await bearer("check"),
    body: { verdicts: [{ listing_id: "alice.notes", version: "1.2.0", verdict: "flag", sha256: SHA, size: 4096, commit: "c".repeat(40),
      findings: [{ rule: "permissions-added", sentence: "Asks for more now: network.", evidence: "network" }] }] } });
  expect(v.status).toBe(200);
  expect(((await v.json()) as any).results).toEqual([{ listing_id: "alice.notes", version: "1.2.0", stored: "flag" }]);
  expect(((await (await req(env, "GET", "/api/listings/alice.notes")).json()) as any).status).toBe("listed");
  const idx = await (await req(env, "GET", "/api/index/preview")).json() as any;
  expect(idx.apps).toHaveLength(1);
  expect(idx.apps[0]).toMatchObject({ id: "alice.notes", version: "1.2.0", sha256: SHA, verdict: "flag", trust: "community",
    owner: { kind: "person", github_id: 1001, login: "Alice" }, source: { repo: "Alice/notes", tag: "v1.2.0", commit: "c".repeat(40) } });
  expect(idx.apps[0].findings[0].rule).toBe("permissions-added");
  expect(((await (await req(env, "GET", "/api/pipeline/pending", { headers: await bearer("check") })).json()) as any).releases).toEqual([]);

  // The sign job reads the export; a check token cannot, and vice versa.
  expect((await req(env, "GET", "/api/pipeline/export", { headers: await bearer("check") })).status).toBe(401);
  const ex = await req(env, "GET", "/api/pipeline/export", { headers: await bearer("sign") });
  expect(ex.status).toBe(200);
  expect(((await ex.json()) as any).preview).toBe(false);
  expect((await req(env, "GET", "/api/pipeline/pending", { headers: await bearer("sign") })).status).toBe(401);
});

test("a changed file behind the same release is blocked, the first hash stays pinned", async () => {
  const post = async (sha: string) => req(env, "POST", "/api/pipeline/verdicts", { origin: null, headers: await bearer("check", { run_id: sha.slice(0, 6) }),
    body: { verdicts: [{ listing_id: "alice.notes", version: "1.2.0", verdict: "pass", sha256: sha }] } });
  await post(SHA);
  const r = await post("cd".repeat(32));
  expect(((await r.json()) as any).results[0].stored).toBe("block");
  expect(env.DB.sqlite.query("SELECT sha256, verdict FROM releases").get()).toEqual({ sha256: SHA, verdict: "block" });
});

const refused: [string, Record<string, unknown>][] = [
  ["wrong issuer", { iss: "https://evil.test" }],
  ["wrong audience", { aud: "sts.amazonaws.com" }],
  ["wrong repository", { repository: "mallory/hub-index" }],
  ["wrong workflow", { workflow_ref: "wonderlandos/hub-index/.github/workflows/other.yml@refs/heads/main" }],
  ["wrong branch", { ref: "refs/heads/feature", workflow_ref: "wonderlandos/hub-index/.github/workflows/check.yml@refs/heads/main" }],
  ["wrong workflow", { workflow_ref: "wonderlandos/hub-index/.github/workflows/check.yml@refs/heads/feature" }],
  ["wrong environment", { environment: "sign" }],
  ["wrong environment", { environment: undefined }],
  ["pull requests may not report", { event_name: "pull_request_target" }],
  ["not a GitHub-hosted runner", { runner_environment: "self-hosted" }],
  ["expired", { exp: Math.floor(Date.now() / 1000) - 3600 }],
  ["issued at a wrong time", { iat: Math.floor(Date.now() / 1000) + 3600 }],
  ["issued at a wrong time", { iat: Math.floor(Date.now() / 1000) - 3600 }],
];
for (const [why, over] of refused) {
  test(`pipeline token refused: ${why} (${Object.keys(over).join(",")})`, async () => {
    const r = await req(env, "GET", "/api/pipeline/pending", { headers: await bearer("check", over) });
    expect(r.status).toBe(401);
    expect(((await r.json()) as any).sentence).toBe(`The pipeline token was refused: ${why}.`);
  });
}

test("pipeline token refused: bad signature, unknown key, wrong algorithm, no token", async () => {
  const other = await oidcKey(new FakeGitHub(), "k1"); // same kid, key GitHub never published
  const r1 = await req(env, "GET", "/api/pipeline/pending", { headers: await bearer("check", {}, other) });
  expect(((await r1.json()) as any).sentence).toContain("bad signature");
  const r2 = await req(env, "GET", "/api/pipeline/pending", { headers: await bearer("check", {}, { ...other, kid: "k9" }) });
  expect(((await r2.json()) as any).sentence).toContain("unknown key");
  const none = `${btoa(JSON.stringify({ alg: "none", kid: "k1" })).replace(/=/g, "")}.${btoa(JSON.stringify(claims("check"))).replace(/=/g, "")}.`;
  const r3 = await req(env, "GET", "/api/pipeline/pending", { headers: { authorization: `Bearer ${none}` } });
  expect(r3.status).toBe(401);
  expect((await req(env, "GET", "/api/pipeline/pending")).status).toBe(401);
});

test("a rotated GitHub key is picked up on an unknown kid", async () => {
  await req(env, "GET", "/api/pipeline/pending", { headers: await bearer("check") }); // caches jwks with k1
  const k2 = await oidcKey(gh, "k2");
  expect((await req(env, "GET", "/api/pipeline/pending", { headers: await bearer("check", {}, k2) })).status).toBe(200);
});

test("verdict bodies are validated", async () => {
  const post = async (verdicts: unknown) => req(env, "POST", "/api/pipeline/verdicts", { origin: null, headers: await bearer("check"), body: { verdicts } });
  expect((await post([])).status).toBe(400);
  expect((await post([{ listing_id: "alice.notes", version: "1.2.0", verdict: "safe", sha256: SHA }])).status).toBe(400);
  expect((await post([{ listing_id: "alice.notes", version: "1.2.0", verdict: "pass" }])).status).toBe(400);
  expect((await post([{ listing_id: "alice.notes", version: "1.2.0", verdict: "pass", sha256: "xyz" }])).status).toBe(400);
  const r = await post([{ listing_id: "alice.nothing", version: "1", verdict: "not-checked" }]);
  expect(((await r.json()) as any).results[0].stored).toBe("unknown-release");
});
