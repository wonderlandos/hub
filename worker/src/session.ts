// SPDX-License-Identifier: GPL-2.0-or-later
// Signed session cookies (HMAC-SHA256 with SESSION_SECRET, 7 days). No session rows:
// signing out sets persons.sessions_after, which voids every older cookie of that person.
// The person's GitHub user token travels inside the cookie, sealed with AES-GCM, so gated
// actions can ask GitHub at the moment of the action.

import type { Ctx } from "./ctx";
import type { Env } from "./env";
import { now } from "./env";
import { b64url, fromUtf8, hmac, same, seal, unb64url, unseal, utf8 } from "./crypto";
import { cookies, fail, setCookie } from "./http";
import { refreshTokens, type GhTokens } from "./github";

export const SESSION_COOKIE = "__Host-hub_session";
export const OAUTH_COOKIE = "__Host-hub_oauth";
export const SESSION_TTL = 7 * 86400;

export interface SessionData {
  v: 1;
  sub: number;     // GitHub id
  login: string;
  iat: number;
  exp: number;
  tok: string;     // sealed access token
  tex?: number;    // access token expiry
  rtk?: string;    // sealed refresh token
}

export interface Person {
  github_id: number; login: string; name: string | null; avatar: string | null;
  gh_created: number | null; two_factor: number | null; role: string;
  sessions_after: number; banned_at: number | null; first_seen: number; last_seen: number;
}

export async function signValue(env: Env, label: string, payload: object): Promise<string> {
  const p = b64url(utf8(JSON.stringify(payload)));
  return p + "." + b64url(await hmac(env.SESSION_SECRET, label, p));
}
export async function verifyValue<T>(env: Env, label: string, value: string | undefined): Promise<T | null> {
  if (!value) return null;
  const [p, mac] = value.split(".");
  if (!p || !mac) return null;
  if (!same(mac, b64url(await hmac(env.SESSION_SECRET, label, p)))) return null;
  try {
    return JSON.parse(fromUtf8(unb64url(p))) as T;
  } catch {
    return null;
  }
}

export async function sessionFromTokens(env: Env, sub: number, login: string, t: GhTokens): Promise<SessionData> {
  const iat = now();
  const life = Math.min(SESSION_TTL, t.refresh_token_expires_in ?? SESSION_TTL);
  return {
    v: 1, sub, login, iat, exp: iat + life,
    tok: await seal(env.SESSION_SECRET, t.access_token),
    ...(t.expires_in ? { tex: iat + t.expires_in } : {}),
    ...(t.refresh_token ? { rtk: await seal(env.SESSION_SECRET, t.refresh_token) } : {}),
  };
}

export async function sessionCookie(env: Env, s: SessionData): Promise<string> {
  return setCookie(SESSION_COOKIE, await signValue(env, "hub session v1", s), Math.max(0, s.exp - now()));
}
export const clearCookie = (name: string) => setCookie(name, "", 0);

export class Session {
  constructor(private ctx: Ctx, public data: SessionData, public person: Person) {}

  /** The GitHub user token, refreshed (and the cookie re-issued) when it is about to expire. */
  async token(): Promise<string> {
    const env = this.ctx.env;
    const d = this.data;
    if (d.tex && now() > d.tex - 60) {
      const rt = d.rtk ? await unseal(env.SESSION_SECRET, d.rtk) : null;
      if (!rt) fail(401, "signed-out", "Your sign-in has ended. Sign in again.");
      const t = await refreshTokens(env, rt!);
      const fresh = await sessionFromTokens(env, d.sub, d.login, t);
      fresh.iat = d.iat; // keep the original sign-in time
      fresh.exp = Math.min(d.exp, fresh.exp);
      this.data = fresh;
      this.ctx.cookies.push(await sessionCookie(env, fresh));
    }
    const tok = await unseal(env.SESSION_SECRET, this.data.tok);
    if (!tok) fail(401, "signed-out", "Your sign-in has ended. Sign in again.");
    return tok!;
  }
}

export async function optionalSession(ctx: Ctx): Promise<Session | null> {
  const d = await verifyValue<SessionData>(ctx.env, "hub session v1", cookies(ctx.req)[SESSION_COOKIE]);
  if (!d || d.v !== 1 || typeof d.sub !== "number" || d.exp <= now()) return null;
  const p = await ctx.env.DB.prepare("SELECT * FROM persons WHERE github_id = ?").bind(d.sub).first<Person>();
  if (!p || d.iat < p.sessions_after) return null;
  if (p.banned_at) fail(403, "banned", "This account may not use the hub.");
  return new Session(ctx, d, p);
}

export async function requireSession(ctx: Ctx): Promise<Session> {
  const s = await optionalSession(ctx);
  if (!s) fail(401, "signed-out", "Sign in with GitHub first.");
  return s!;
}
