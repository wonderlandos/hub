// SPDX-License-Identifier: GPL-2.0-or-later
// Test harness: an in-memory D1 on bun:sqlite, an in-memory KV, and a mocked GitHub
// (OAuth, REST and the Actions token issuer). No network.

import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { handle } from "../src/index";
import type { Env } from "../src/env";
import { b64url, unb64url, utf8, webhookSignature } from "../src/crypto";
import { resetJwksCache } from "../src/pipeline";

export const ORIGIN = "https://hub.wolos.org";
export const SCHEMA = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

// ---- D1 on bun:sqlite -------------------------------------------------------------------
class Stmt {
  constructor(private db: Database, private sql: string, private args: unknown[] = []) {}
  bind(...args: unknown[]) {
    if (args.some((a) => a === undefined)) throw new Error("D1_TYPE_ERROR: undefined bound");
    return new Stmt(this.db, this.sql, args);
  }
  private q() { return this.db.query(this.sql); }
  async first<T>(col?: string): Promise<T | null> {
    const row = this.q().get(...(this.args as never[])) as Record<string, unknown> | null;
    if (!row) return null;
    return (col ? row[col] : row) as T;
  }
  async all<T>() { return { results: this.q().all(...(this.args as never[])) as T[], success: true, meta: {} }; }
  async run() { return this.runSync(); }
  runSync() {
    const r = this.q().run(...(this.args as never[]));
    return { success: true, results: [], meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
  }
  async raw() { return this.q().values(...(this.args as never[])); }
}
export class FakeD1 {
  sqlite = new Database(":memory:");
  writes = 0;
  constructor(schema = SCHEMA) { this.sqlite.exec("PRAGMA foreign_keys = ON;"); this.sqlite.exec(schema); }
  prepare(sql: string) {
    if (!/^\s*SELECT/i.test(sql)) this.writes++;
    return new Stmt(this.sqlite, sql);
  }
  async batch(stmts: Stmt[]) {
    const tx = this.sqlite.transaction(() => stmts.map((s) => s.runSync()));
    return tx();
  }
  async exec(sql: string) { this.sqlite.exec(sql); return { count: 1, duration: 0 }; }
  dump() { return {} as never; }
}

export class FakeKV {
  m = new Map<string, { v: string; exp: number | null }>();
  writes = 0;
  async get(k: string, type?: string) {
    const e = this.m.get(k);
    if (!e || (e.exp && e.exp < Date.now() / 1000)) return null;
    return type === "json" ? JSON.parse(e.v) : e.v;
  }
  async put(k: string, v: string, o?: { expirationTtl?: number }) {
    this.writes++;
    this.m.set(k, { v, exp: o?.expirationTtl ? Date.now() / 1000 + o.expirationTtl : null });
  }
  async delete(k: string) { this.m.delete(k); }
}

export const SECRETS = {
  GITHUB_APP_ID: "123456",
  GITHUB_CLIENT_ID: "Iv1.testclientid",
  GITHUB_CLIENT_SECRET: "test-client-secret-0123456789abcdef",
  WEBHOOK_SECRET: "test-webhook-secret-fedcba9876543210",
  SESSION_SECRET: "test-session-secret-a-long-random-value",
};

/** The second, private App "WolOS Hub Pipeline" (ghapp.ts): its id; its key comes from appKey(). */
export const PIPELINE_APP_ID = "777001";

export function makeEnv(over: Partial<Env> = {}): Env & { DB: FakeD1; KV: FakeKV } {
  return {
    DB: new FakeD1() as never, KV: new FakeKV() as never, ...SECRETS,
    HUB_ORIGIN: ORIGIN, OIDC_AUDIENCE: "hub.wolos.org", PIPELINE_REPOSITORY: "wonderlandos/hub-index",
    PIPELINE_CHECK_WORKFLOW: "wonderlandos/hub-index/.github/workflows/check.yml@refs/heads/main",
    PIPELINE_CHECK_ENVIRONMENT: "check",
    PIPELINE_SIGN_WORKFLOW: "wonderlandos/hub-index/.github/workflows/sign.yml@refs/heads/main",
    PIPELINE_SIGN_ENVIRONMENT: "sign",
    PIPELINE_CA_WORKFLOW: "wonderlandos/hub-index/.github/workflows/ca.yml@refs/heads/main",
    PIPELINE_CA_ENVIRONMENT: "ca",
    RATE_STORE: "d1", CLA_VERSION: "1", ADMINS: "carol-ca, dave", GITHUB_PIPELINE_APP_ID: PIPELINE_APP_ID,
    GITHUB_WEB: "https://gh.test", GITHUB_API: "https://api.gh.test", OIDC_ISSUER: "https://oidc.test",
    ...over,
  } as never;
}

// ---- mocked GitHub -----------------------------------------------------------------------
export interface FakeUser { id: number; login: string; name: string; created_at: string; two_factor_authentication?: boolean }
export interface FakeRepo { id: number; full_name: string; private: boolean; owner: { id: number; login: string; type: string } }

const INSTALL_TOKEN = "ghs_installationtoken000000000";

export class FakeGitHub {
  users = new Map<string, FakeUser>();        // access token -> user
  codes = new Map<string, { token: string; challenge?: string }>(); // code -> token
  orgs = new Map<number, { id: number; login: string; role: string }[]>(); // user id -> memberships
  repos = new Map<string, FakeRepo>();
  calls: string[] = [];
  tokenBodies: Record<string, string>[] = [];
  jwks: JsonWebKey[] = [];
  expiresIn: number | undefined = 28800;
  // The pipeline GitHub App acting as itself (ghapp.ts): its public key, its installation, what it was asked.
  app: { publicKey: CryptoKey; installationId: number } | null = null;
  installTokenBodies: Record<string, unknown>[] = [];
  dispatches: { path: string; token: string; body: Record<string, unknown> }[] = [];
  dispatchStatus = 204;

  /** GitHub App endpoints (JWT, installation token, workflow dispatch); null when the path is not one. */
  async appCall(path: string, method: string, tok: string, body: unknown): Promise<Response | null> {
    const j = (b: unknown, status = 200) => new Response(b === null ? null : JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    const appJwtOk = async () => {
      if (!this.app) return false;
      const [h, p, sig] = tok.split(".");
      if (!sig) return false;
      const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", this.app.publicKey, unb64url(sig), utf8(`${h}.${p}`));
      const c = JSON.parse(new TextDecoder().decode(unb64url(p)));
      const t = Math.floor(Date.now() / 1000);
      return ok && c.iss === PIPELINE_APP_ID && c.exp > t && c.exp - c.iat <= 600;
    };
    if (path === "/repos/wonderlandos/hub-index/installation" && method === "GET") {
      return (await appJwtOk()) ? j({ id: this.app!.installationId }) : j({ message: "A JSON web token could not be decoded" }, 401);
    }
    const it = path.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
    if (it && method === "POST") {
      if (!(await appJwtOk()) || Number(it[1]) !== this.app!.installationId) return j({ message: "Bad credentials" }, 401);
      this.installTokenBodies.push(JSON.parse(String(body)));
      return j({ token: INSTALL_TOKEN, expires_at: "2099-01-01T00:00:00Z", permissions: { actions: "write" } }, 201);
    }
    if (/^\/repos\/[^/]+\/[^/]+\/actions\/workflows\/[^/]+\/dispatches$/.test(path) && method === "POST") {
      if (tok !== INSTALL_TOKEN) return j({ message: "Bad credentials" }, 401);
      this.dispatches.push({ path, token: tok, body: JSON.parse(String(body)) });
      return j(this.dispatchStatus === 204 ? null : { message: "No ref found" }, this.dispatchStatus);
    }
    return null;
  }

  addUser(u: FakeUser, token = `ghu_${u.login}token0000000000`) { this.users.set(token, u); return token; }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    this.calls.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
    const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (url.origin === "https://gh.test" && url.pathname === "/login/oauth/access_token") {
      const b = JSON.parse(String(init?.body)) as Record<string, string>;
      this.tokenBodies.push(b);
      if (b.client_secret !== SECRETS.GITHUB_CLIENT_SECRET) return j({ error: "incorrect_client_credentials" });
      if (b.grant_type === "refresh_token") {
        const tok = b.refresh_token.replace("ghr_", "ghu_");
        return this.users.has(tok) ? j({ access_token: tok, expires_in: this.expiresIn, refresh_token: b.refresh_token }) : j({ error: "bad_refresh_token" });
      }
      const c = this.codes.get(b.code);
      if (!c) return j({ error: "bad_verification_code" });
      // PKCE: the challenge sent to /authorize must be S256 of the verifier sent here.
      const { pkceChallenge } = await import("../src/crypto");
      if (c.challenge && c.challenge !== (await pkceChallenge(b.code_verifier))) return j({ error: "invalid_grant" });
      this.codes.delete(b.code);
      return j({ access_token: c.token, expires_in: this.expiresIn, refresh_token: c.token.replace("ghu_", "ghr_"), refresh_token_expires_in: 15897600 });
    }
    if (url.origin === "https://api.gh.test") {
      const tok = (new Headers(init?.headers).get("authorization") ?? "").replace("Bearer ", "");
      const app = await this.appCall(url.pathname, init?.method ?? "GET", tok, init?.body);
      if (app) return app;
      const u = this.users.get(tok);
      if (!u) return j({ message: "Bad credentials" }, 401);
      if (url.pathname === "/user") return j(u);
      const ms = this.orgs.get(u.id) ?? [];
      const mview = (m: { id: number; login: string; role: string }) => ({ state: "active", role: m.role, organization: { id: m.id, login: m.login } });
      if (url.pathname === "/user/memberships/orgs") return j(ms.map(mview));
      const om = url.pathname.match(/^\/user\/memberships\/orgs\/([^/]+)$/);
      if (om) { const m = ms.find((x) => x.login.toLowerCase() === om[1].toLowerCase()); return m ? j(mview(m)) : j({ message: "Not Found" }, 404); }
      const rm = url.pathname.match(/^\/repos\/(.+)$/);
      if (rm) { const r = this.repos.get(rm[1]); return r ? j(r) : j({ message: "Not Found" }, 404); }
    }
    if (url.origin === "https://oidc.test" && url.pathname === "/.well-known/jwks") return j({ keys: this.jwks });
    return new Response("unexpected " + url, { status: 599 });
  };
}

/** Registers the pipeline GitHub App with a fresh RSA key; returns its private key as PEM (PKCS#8 or GitHub's PKCS#1). */
export async function appKey(gh: FakeGitHub, format: "pkcs8" | "pkcs1" = "pkcs1"): Promise<string> {
  const { generateKeyPairSync } = await import("node:crypto");
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const spki = publicKey.export({ type: "spki", format: "der" });
  gh.app = {
    publicKey: await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]),
    installationId: 4242,
  };
  return privateKey.export({ type: format, format: "pem" }) as string;
}

export function install(gh: FakeGitHub) {
  const real = globalThis.fetch;
  globalThis.fetch = gh.fetch as typeof fetch;
  resetJwksCache();
  return () => { globalThis.fetch = real; };
}

// ---- requests ----------------------------------------------------------------------------
export function req(env: Env, method: string, path: string, opts: { body?: unknown; cookie?: string; headers?: Record<string, string>; origin?: string | null; ip?: string } = {}) {
  const h = new Headers(opts.headers);
  if (opts.cookie) h.set("cookie", opts.cookie);
  if (opts.origin !== null && method !== "GET") h.set("origin", opts.origin ?? ORIGIN);
  h.set("cf-connecting-ip", opts.ip ?? "203.0.113.7");
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    body = typeof opts.body === "string" || opts.body instanceof Uint8Array || opts.body instanceof ReadableStream ? (opts.body as BodyInit) : JSON.stringify(opts.body);
    if (!h.has("content-type")) h.set("content-type", "application/json");
  }
  return handle(new Request(ORIGIN + path, { method, headers: h, body }), env);
}

export function cookieFrom(r: Response, name: string): string | null {
  for (const c of r.headers.getSetCookie()) if (c.startsWith(name + "=")) return c;
  return null;
}
export const cookiePair = (setCookie: string | null) => (setCookie ?? "").split(";")[0];

/** Runs the whole sign-in: /auth/login, GitHub's authorize (mocked), /auth/callback. Returns the Cookie header value. */
export async function signIn(env: Env, gh: FakeGitHub, u: FakeUser, next = "/"): Promise<string> {
  const token = gh.addUser(u);
  // Each person signs in from their own address, so a test with many sign-ins stays under the per-address limit.
  const ip = `198.51.100.${(u.id % 250) + 1}`;
  const r1 = await req(env, "GET", `/auth/login?next=${encodeURIComponent(next)}`, { ip });
  const loc = new URL(r1.headers.get("location")!);
  const code = "code-" + Math.random().toString(36).slice(2);
  gh.codes.set(code, { token, challenge: loc.searchParams.get("code_challenge")! });
  const oauth = cookiePair(cookieFrom(r1, "__Host-hub_oauth"));
  const r2 = await req(env, "GET", `/auth/callback?code=${code}&state=${loc.searchParams.get("state")}`, { cookie: oauth, ip });
  if (r2.status !== 302) throw new Error("sign-in failed: " + r2.status + " " + (await r2.text()));
  return cookiePair(cookieFrom(r2, "__Host-hub_session"));
}

/** Accepts what a publisher needs: the CLA and the Publisher Agreement. */
export async function acceptCla(env: Env, cookie: string, publisher = true) {
  const cla = await (await req(env, "GET", "/api/cla")).json() as { version: string; sha256: string };
  const r = await req(env, "POST", "/api/cla", { cookie, body: { version: cla.version, sha256: cla.sha256 } });
  if (publisher) await acceptTerms(env, cookie, "publisher");
  return r;
}
export async function acceptTerms(env: Env, cookie: string, doc: "publisher" | "trust") {
  return req(env, "POST", `/api/terms/${doc}`, { cookie, body: await termsAnswer(env, doc) });
}
/** {version, sha256} of the current text, as the site sends it after showing the text. */
export async function termsAnswer(env: Env, doc: "cla" | "publisher" | "trust" | "certificates") {
  const t = await (await req(env, "GET", `/api/terms/${doc}`)).json() as { version: string; sha256: string };
  return { version: t.version, sha256: t.sha256 };
}

export const OLD = "2020-01-01T00:00:00Z";
// Everyone here has two-factor authentication on GitHub unless a test takes it away.
export const alice: FakeUser = { id: 1001, login: "Alice", name: "Alice Doe", created_at: OLD, two_factor_authentication: true };
export const bob: FakeUser = { id: 1002, login: "bob", name: "Bob Roe", created_at: OLD, two_factor_authentication: true };
/** Owners of the admin panel (makeEnv ADMINS). */
export const carol: FakeUser = { id: 1003, login: "carol-ca", name: "Carol Admin", created_at: OLD, two_factor_authentication: true };
export const dave: FakeUser = { id: 1004, login: "Dave", name: "Dave Admin", created_at: OLD, two_factor_authentication: true };
export const erin: FakeUser = { id: 1005, login: "erin", name: "Erin Helper", created_at: OLD, two_factor_authentication: true };

/** Moves the clock (Date.now) by seconds; returns the function that puts it back. */
export function shiftClock(seconds: number): () => void {
  const real = Date.now;
  Date.now = () => real() + seconds * 1000;
  return () => { Date.now = real; };
}

// ---- webhooks and OIDC -------------------------------------------------------------------
export async function hook(env: Env, event: string, payload: unknown, delivery = crypto.randomUUID(), secret = SECRETS.WEBHOOK_SECRET) {
  const body = utf8(JSON.stringify(payload));
  return req(env, "POST", "/api/webhook/github", {
    body, origin: null,
    headers: {
      "content-type": "application/json", "x-github-event": event, "x-github-delivery": delivery,
      "x-hub-signature-256": await webhookSignature(secret, body),
    },
  });
}

export async function oidcKey(gh: FakeGitHub, kid = "k1") {
  const kp = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"],
  )) as CryptoKeyPair;
  const pub = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;
  gh.jwks.push({ ...pub, kid, alg: "RS256", use: "sig" } as JsonWebKey);
  return { kid, key: kp.privateKey };
}

export function claims(job: "check" | "sign" | "ca", over: Record<string, unknown> = {}) {
  const t = Math.floor(Date.now() / 1000);
  return {
    iss: "https://oidc.test", aud: "hub.wolos.org", sub: `repo:wonderlandos/hub-index:environment:${job}`,
    iat: t, nbf: t, exp: t + 300, repository: "wonderlandos/hub-index", repository_owner: "wonderlandos",
    workflow_ref: `wonderlandos/hub-index/.github/workflows/${job}.yml@refs/heads/main`, ref: "refs/heads/main",
    environment: job, event_name: "schedule", run_id: "777", run_attempt: "1", runner_environment: "github-hosted",
    job_workflow_sha: "a".repeat(40), ...over,
  };
}

export async function jwt(k: { kid: string; key: CryptoKey }, payload: unknown, header: Record<string, unknown> = {}) {
  const h = b64url(utf8(JSON.stringify({ alg: "RS256", typ: "JWT", kid: k.kid, ...header })));
  const p = b64url(utf8(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", k.key, utf8(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

// ---- certificate requests ----------------------------------------------------------------------------------------
export const bytes = (n: number, fill = 7) => b64url(new Uint8Array(n).fill(fill));
export const t0 = () => Math.floor(Date.now() / 1000);
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
