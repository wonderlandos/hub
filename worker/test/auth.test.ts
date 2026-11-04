// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, beforeEach, expect, test } from "bun:test";
import { alice, cookieFrom, cookiePair, FakeGitHub, install, makeEnv, ORIGIN, req, signIn } from "./harness";
import { pkceChallenge } from "../src/crypto";
import { safeNext } from "../src/auth";

let gh: FakeGitHub, undo: () => void, env: ReturnType<typeof makeEnv>;
beforeEach(() => { gh = new FakeGitHub(); undo = install(gh); env = makeEnv(); });
afterEach(() => undo());

test("login redirects to GitHub with state and a PKCE S256 challenge, and sets a short signed cookie", async () => {
  const r = await req(env, "GET", "/auth/login?next=/publish");
  expect(r.status).toBe(302);
  const loc = new URL(r.headers.get("location")!);
  expect(loc.origin + loc.pathname).toBe("https://gh.test/login/oauth/authorize");
  expect(loc.searchParams.get("client_id")).toBe(env.GITHUB_CLIENT_ID);
  expect(loc.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/auth/callback`);
  expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
  expect(loc.searchParams.get("state")!.length).toBeGreaterThanOrEqual(43);
  expect(loc.searchParams.get("code_challenge")!.length).toBe(43);
  const c = cookieFrom(r, "__Host-hub_oauth")!;
  expect(c).toContain("HttpOnly");
  expect(c).toContain("Secure");
  expect(c).toContain("SameSite=Lax");
  expect(c).toContain("Path=/");
  expect(c).toContain("Max-Age=600");
});

test("callback exchanges the code with the verifier, creates the person and sets the session cookie", async () => {
  const r1 = await req(env, "GET", "/auth/login?next=/publish");
  const loc = new URL(r1.headers.get("location")!);
  const token = gh.addUser(alice);
  gh.codes.set("c1", { token, challenge: loc.searchParams.get("code_challenge")! });
  gh.orgs.set(alice.id, [{ id: 501, login: "examplelabs", role: "admin" }]);
  const r2 = await req(env, "GET", `/auth/callback?code=c1&state=${loc.searchParams.get("state")}`, {
    cookie: cookiePair(cookieFrom(r1, "__Host-hub_oauth")),
  });
  expect(r2.status).toBe(302);
  expect(r2.headers.get("location")).toBe(`${ORIGIN}/publish`);
  const sc = cookieFrom(r2, "__Host-hub_session")!;
  for (const f of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=604800"]) expect(sc).toContain(f);
  expect(sc).not.toContain(token); // the GitHub token is sealed, never in clear
  expect(cookieFrom(r2, "__Host-hub_oauth")).toContain("Max-Age=0");
  const sent = gh.tokenBodies[0];
  expect(await pkceChallenge(sent.code_verifier)).toBe(loc.searchParams.get("code_challenge")!);
  expect(sent.redirect_uri).toBe(`${ORIGIN}/auth/callback`);

  const me = await req(env, "GET", "/api/me", { cookie: cookiePair(sc) });
  expect(me.status).toBe(200);
  const body = await me.json() as any;
  expect(body.github_id).toBe(1001);
  expect(body.login).toBe("Alice");
  expect(body.name).toBe("Alice Doe");
  expect(body.cla).toEqual({ current: "0-placeholder", accepted: null, accepted_at: null, ok: false });
  expect(body.orgs).toEqual([{ github_org_id: 501, login: "examplelabs", role: "owner", linked: false, cla: null }]);
});

test("a wrong state, a missing state cookie or a reused code fail without a session", async () => {
  const r1 = await req(env, "GET", "/auth/login");
  const loc = new URL(r1.headers.get("location")!);
  const oauth = cookiePair(cookieFrom(r1, "__Host-hub_oauth"));
  const token = gh.addUser(alice);
  gh.codes.set("c1", { token, challenge: loc.searchParams.get("code_challenge")! });
  for (const [q, cookie] of [[`code=c1&state=wrong`, oauth], [`code=c1&state=${loc.searchParams.get("state")}`, undefined]] as const) {
    const r = await req(env, "GET", `/auth/callback?${q}`, { cookie });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(`${ORIGIN}/signin?error=state`);
    expect(cookieFrom(r, "__Host-hub_session")).toBeNull();
  }
  // A forged state cookie (signed with another secret) is refused too.
  const other = makeEnv({ SESSION_SECRET: "another-secret-entirely-xxxxxxxx" });
  const r3 = await req(other, "GET", "/auth/login");
  const s3 = new URL(r3.headers.get("location")!).searchParams.get("state");
  const r4 = await req(env, "GET", `/auth/callback?code=c1&state=${s3}`, { cookie: cookiePair(cookieFrom(r3, "__Host-hub_oauth")) });
  expect(r4.headers.get("location")).toBe(`${ORIGIN}/signin?error=state`);
  // GitHub refusing a PKCE verifier mismatch ends as an error, not a session.
  gh.codes.set("c2", { token, challenge: "not-the-challenge" });
  const r5 = await req(env, "GET", `/auth/callback?code=c2&state=${loc.searchParams.get("state")}`, { cookie: oauth });
  expect(r5.status).toBe(502);
  expect(cookieFrom(r5, "__Host-hub_session")).toBeNull();
});

test("a tampered session cookie is refused", async () => {
  const c = await signIn(env, gh, alice);
  const [name, value] = c.split("=");
  const [p, mac] = value.split(".");
  const flipped = `${name}=${p.slice(0, -1)}${p.endsWith("A") ? "B" : "A"}.${mac}`;
  expect((await req(env, "GET", "/api/me", { cookie: flipped })).status).toBe(401);
  expect((await req(env, "GET", "/api/me")).status).toBe(401);
});

test("logout needs the hub's origin, clears the cookie and voids every older session", async () => {
  const c = await signIn(env, gh, alice);
  expect((await req(env, "POST", "/auth/logout", { cookie: c, origin: "https://evil.test" })).status).toBe(403);
  const r = await req(env, "POST", "/auth/logout", { cookie: c });
  expect(r.status).toBe(200);
  expect(cookieFrom(r, "__Host-hub_session")).toContain("Max-Age=0");
  // Replaying the old cookie fails once a second has passed (sessions_after is in seconds).
  env.DB.sqlite.exec("UPDATE persons SET sessions_after = sessions_after + 1");
  expect((await req(env, "GET", "/api/me", { cookie: c })).status).toBe(401);
});

test("an expired GitHub token is refreshed and the cookie re-issued", async () => {
  gh.expiresIn = 1; // expires inside the 60 s margin, so the next use refreshes
  const c = await signIn(env, gh, alice);
  gh.orgs.set(alice.id, [{ id: 501, login: "examplelabs", role: "member" }]);
  env.DB.sqlite.exec("UPDATE memberships SET synced_at = 0; UPDATE persons SET last_seen = 0");
  const r = await req(env, "GET", "/api/me", { cookie: c });
  expect(r.status).toBe(200);
  expect(gh.tokenBodies.some((b) => b.grant_type === "refresh_token")).toBe(true);
  expect(cookieFrom(r, "__Host-hub_session")).toContain("Max-Age=");
  expect(((await r.json()) as any).orgs[0].role).toBe("member");
});

test("next only ever points at the hub itself", () => {
  expect(safeNext("/publish?x=1")).toBe("/publish?x=1");
  for (const bad of ["https://evil.test", "//evil.test", "/\\evil.test", "evil", null]) expect(safeNext(bad as never)).toBe("/");
});

test("banned people cannot sign in", async () => {
  await signIn(env, gh, alice);
  env.DB.sqlite.exec("UPDATE persons SET banned_at = 1");
  const r1 = await req(env, "GET", "/auth/login");
  const loc = new URL(r1.headers.get("location")!);
  const token = gh.addUser(alice);
  gh.codes.set("c9", { token, challenge: loc.searchParams.get("code_challenge")! });
  const r = await req(env, "GET", `/auth/callback?code=c9&state=${loc.searchParams.get("state")}`, { cookie: cookiePair(cookieFrom(r1, "__Host-hub_oauth")) });
  expect(r.headers.get("location")).toBe(`${ORIGIN}/signin?error=banned`);
});
