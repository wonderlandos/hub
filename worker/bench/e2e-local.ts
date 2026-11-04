// SPDX-License-Identifier: GPL-2.0-or-later
// End to end on real workerd and local D1: a mock GitHub on :8798, the Worker on :8799
// started with --var GITHUB_WEB/GITHUB_API/OIDC_ISSUER pointing at it. Sign in, accept the
// CLA, register a listing, deliver a release webhook twice, post a verdict, read the preview.
import { FakeGitHub, SECRETS, claims, jwt, oidcKey } from "../test/harness";
import { webhookSignature } from "../src/crypto";

const W = "http://127.0.0.1:8799", M = "http://127.0.0.1:8798";
const gh = new FakeGitHub();
const map: Record<string, string> = { "/web": "https://gh.test", "/api": "https://api.gh.test", "/oidc": "https://oidc.test" };
Bun.serve({ port: 8798, async fetch(r) {
  const u = new URL(r.url); const pre = "/" + u.pathname.split("/")[1];
  const target = map[pre] + u.pathname.slice(pre.length) + u.search;
  const out = await gh.fetch(target, { method: r.method, headers: r.headers, body: r.method === "GET" ? undefined : await r.text() });
  if (process.env.DEBUG) console.log("mock", r.method, target, out.status);
  return out;
} });
const key = await oidcKey(gh);
const alice = { id: 1001, login: "Alice", name: "Alice Doe", created_at: "2020-01-01T00:00:00Z" };
const token = gh.addUser(alice);
gh.repos.set("Alice/notes", { id: 9001, full_name: "Alice/notes", private: false, owner: { id: 1001, login: "Alice", type: "User" } });

const ok = (c: boolean, what: string) => { console.log(`${c ? "ok  " : "FAIL"} ${what}`); if (!c) process.exitCode = 1; };
const ip = { "cf-connecting-ip": "203.0.113.50" };
const r1 = await fetch(`${W}/auth/login`, { redirect: "manual", headers: ip });
const loc = new URL(r1.headers.get("location")!);
ok(loc.href.startsWith(`${M}/web/login/oauth/authorize`), "login redirects to GitHub authorize");
gh.codes.set("c1", { token, challenge: loc.searchParams.get("code_challenge")! });
const oauth = r1.headers.getSetCookie()[0].split(";")[0];
const r2 = await fetch(`${W}/auth/callback?code=c1&state=${loc.searchParams.get("state")}`, { redirect: "manual", headers: { cookie: oauth, ...ip } });
const sess = r2.headers.getSetCookie().find((c) => c.startsWith("__Host-hub_session="))!.split(";")[0];
ok(r2.status === 302 && !!sess, "callback sets the session");
const H = { cookie: sess, origin: "https://hub.wolos.org", "content-type": "application/json", ...ip };
const me = await (await fetch(`${W}/api/me`, { headers: H })).json() as any;
ok(me.github_id === 1001 && me.cla.ok === false, "/api/me: person, CLA not yet");
const cla = await (await fetch(`${W}/api/cla`)).json() as any;
const body = { id: "alice.notes", kind: "app", repo: "Alice/notes", asset: "notes.wol", name: "Notes", summary: "Notes.", license: "MIT" };
ok((await fetch(`${W}/api/listings`, { method: "POST", headers: H, body: JSON.stringify(body) })).status === 403, "no listing before the CLA");
ok((await fetch(`${W}/api/cla`, { method: "POST", headers: H, body: JSON.stringify({ version: cla.version, sha256: cla.sha256 }) })).status === 200, "CLA accepted");
ok((await fetch(`${W}/api/listings`, { method: "POST", headers: H, body: JSON.stringify(body) })).status === 201, "listing created");
const ev = new TextEncoder().encode(JSON.stringify({ action: "published", repository: { id: 9001, full_name: "Alice/notes" },
  release: { tag_name: "v1.0.0", draft: false, prerelease: false, assets: [{ name: "notes.wol", browser_download_url: "https://github.com/Alice/notes/releases/download/v1.0.0/notes.wol", size: 10 }] } }));
const send = async (d: string) => (await fetch(`${W}/api/webhook/github`, { method: "POST", body: ev, headers: {
  "content-type": "application/json", "x-github-event": "release", "x-github-delivery": d,
  "x-hub-signature-256": await webhookSignature(SECRETS.WEBHOOK_SECRET, ev) } })).json() as any;
const d = crypto.randomUUID();
ok((await send(d)).outcome?.["alice.notes"] === "pending", "webhook records the release");
ok((await send(d)).duplicate === true, "same delivery again is a no-op");
const iss = { iss: `${M}/oidc` };
const pend = await (await fetch(`${W}/api/pipeline/pending`, { headers: { authorization: `Bearer ${await jwt(key, claims("check", iss))}` } })).json() as any;
ok(pend.releases?.length === 1, "pipeline sees one pending release");
const v = await fetch(`${W}/api/pipeline/verdicts`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${await jwt(key, claims("check", iss))}` },
  body: JSON.stringify({ verdicts: [{ listing_id: "alice.notes", version: "1.0.0", verdict: "pass", sha256: "ab".repeat(32) }] }) });
ok(v.status === 200, "verdict posted");
const bad = await fetch(`${W}/api/pipeline/pending`, { headers: { authorization: `Bearer ${await jwt(key, claims("check", { ...iss, repository: "mallory/hub-index" }))}` } });
ok(bad.status === 401, "token from another repository refused");
const idx = await (await fetch(`${W}/api/index/preview`)).json() as any;
ok(idx.apps?.[0]?.id === "alice.notes" && idx.apps[0].verdict === "pass", "preview lists the app");
const l = await (await fetch(`${W}/api/listings/alice.notes`)).json() as any;
ok(l.status === "listed", "listing is listed");
process.exit();
