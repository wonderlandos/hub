// SPDX-License-Identifier: GPL-2.0-or-later
// GitHub sign-in (GitHub App user authorisation, state + PKCE S256) and /api/me.

import type { Ctx } from "./ctx";
import { ghWeb, now } from "./env";
import { b64url, pkceChallenge, random, same } from "./crypto";
import { cookies, fail, json, sameOrigin, setCookie } from "./http";
import { limit, RULES } from "./ratelimit";
import { exchangeCode, getOrgMemberships, getUser, GhUnauthorized } from "./github";
import {
  clearCookie, OAUTH_COOKIE, optionalSession, requireSession, SESSION_COOKIE, sessionCookie, sessionFromTokens, signValue, verifyValue,
} from "./session";
import { memberships, orgView, syncMemberships } from "./orgs";
import { claStatus, termsStatus } from "./cla";
import { audit } from "./audit";
import { log } from "./log";
import { isAdmin } from "./admin";

interface OAuthState { s: string; v: string; n: string; exp: number }

const OAUTH_TTL = 600;

/** Only paths on the hub itself; never another host. */
export function safeNext(n: string | null): string {
  if (!n || !n.startsWith("/") || n.startsWith("//") || n.includes("\\") || n.length > 512) return "/";
  return n;
}

function redirect(location: string, cookiesOut: string[]): Response {
  const h = new Headers({ location, "cache-control": "no-store" });
  for (const c of cookiesOut) h.append("set-cookie", c);
  return new Response(null, { status: 302, headers: h });
}

const callbackUrl = (ctx: Ctx) => `${ctx.env.HUB_ORIGIN}/auth/callback`;

export async function login(ctx: Ctx): Promise<Response> {
  await limit(ctx.env, RULES.signIn, ctx.ip);
  const st: OAuthState = {
    s: b64url(random(32)), v: b64url(random(48)), n: safeNext(ctx.url.searchParams.get("next")), exp: now() + OAUTH_TTL,
  };
  const q = new URLSearchParams({
    client_id: ctx.env.GITHUB_CLIENT_ID,
    redirect_uri: callbackUrl(ctx),
    state: st.s,
    code_challenge: await pkceChallenge(st.v),
    code_challenge_method: "S256",
  });
  return redirect(`${ghWeb(ctx.env)}/login/oauth/authorize?${q}`, [
    setCookie(OAUTH_COOKIE, await signValue(ctx.env, "hub oauth v1", st), OAUTH_TTL),
  ]);
}

const failed = (ctx: Ctx, code: string) =>
  redirect(`${ctx.env.HUB_ORIGIN}/signin?error=${encodeURIComponent(code)}`, [clearCookie(OAUTH_COOKIE)]);

export async function callback(ctx: Ctx): Promise<Response> {
  await limit(ctx.env, RULES.signIn, ctx.ip);
  const p = ctx.url.searchParams;
  if (p.get("error")) return failed(ctx, "denied");
  const st = await verifyValue<OAuthState>(ctx.env, "hub oauth v1", cookies(ctx.req)[OAUTH_COOKIE]);
  const code = p.get("code"), state = p.get("state");
  if (!st || st.exp < now() || !code || !state || !same(state, st.s)) return failed(ctx, "state");
  const tokens = await exchangeCode(ctx.env, code, st.v, callbackUrl(ctx));
  const u = await getUser(ctx.env, tokens.access_token);
  const t = now();
  const created = u.created_at ? Math.floor(Date.parse(u.created_at) / 1000) : null;
  const db = ctx.env.DB;
  const existing = await db.prepare("SELECT banned_at FROM persons WHERE github_id = ?").bind(u.id).first<{ banned_at: number | null }>();
  if (existing?.banned_at) return failed(ctx, "banned");
  await db.batch([
    db.prepare(
      "INSERT INTO persons (github_id, login, name, avatar, gh_created, two_factor, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT (github_id) DO UPDATE SET login = excluded.login, name = excluded.name, avatar = excluded.avatar, " +
      "gh_created = excluded.gh_created, two_factor = excluded.two_factor, last_seen = excluded.last_seen",
    ).bind(u.id, u.login, u.name ?? null, u.avatar_url ?? null, Number.isFinite(created) ? created : null,
      u.two_factor_authentication === undefined ? null : u.two_factor_authentication ? 1 : 0, t, t),
    audit(db, "person", u.id, "sign-in", `person:${u.id}`, { login: u.login }),
  ]);
  try {
    await syncMemberships(ctx, u.id, await getOrgMemberships(ctx.env, tokens.access_token));
  } catch (e) {
    log("sign-in.orgs-unavailable", { person: u.id }); // sign-in still works; /api/me retries
  }
  const s = await sessionFromTokens(ctx.env, u.id, u.login, tokens);
  log("sign-in", { person: u.id });
  return redirect(`${ctx.env.HUB_ORIGIN}${st.n}`, [await sessionCookie(ctx.env, s), clearCookie(OAUTH_COOKIE)]);
}

export async function logout(ctx: Ctx): Promise<Response> {
  sameOrigin(ctx.req, ctx.env);
  const s = await optionalSession(ctx).catch(() => null);
  if (s) {
    await ctx.env.DB.batch([
      ctx.env.DB.prepare("UPDATE persons SET sessions_after = ? WHERE github_id = ?").bind(now(), s.person.github_id),
      audit(ctx.env.DB, "person", s.person.github_id, "sign-out", `person:${s.person.github_id}`),
    ]);
  }
  ctx.cookies.push(clearCookie(SESSION_COOKIE));
  return json({ signed_in: false });
}

export async function me(ctx: Ctx): Promise<Response> {
  const s = await requireSession(ctx);
  let list;
  try {
    list = await memberships(ctx, s);
  } catch (e) {
    if (e instanceof GhUnauthorized) {
      ctx.cookies.push(clearCookie(SESSION_COOKIE));
      fail(401, "signed-out", "GitHub ended your sign-in. Sign in again.");
    }
    throw e;
  }
  const p = s.person;
  return json({
    github_id: p.github_id, login: p.login, name: p.name, avatar: p.avatar, role: p.role, admin: isAdmin(ctx.env, p),
    cla: await claStatus(ctx.env, "person", p.github_id),
    terms: { publisher: await termsStatus(ctx.env, "publisher", p.github_id), trust: await termsStatus(ctx.env, "trust", p.github_id) },
    orgs: await Promise.all(list.map((m) => orgView(ctx, m))),
  });
}
