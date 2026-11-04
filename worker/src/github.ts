// SPDX-License-Identifier: GPL-2.0-or-later
// The few GitHub calls the hub makes, all with the signed-in person's own user token.

import type { Env } from "./env";
import { ghApi, ghWeb } from "./env";
import { fail } from "./http";

export interface GhTokens {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}
export interface GhUser {
  id: number; login: string; name: string | null; avatar_url?: string;
  created_at?: string; two_factor_authentication?: boolean;
}
export interface GhOrgMembership {
  state: string; role: "admin" | "member" | string;
  organization: { id: number; login: string; avatar_url?: string };
}
export interface GhRepo {
  id: number; full_name: string; private: boolean; archived?: boolean;
  owner: { id: number; login: string; type: string };
}

const TIMEOUT = 8000;

async function tokenCall(env: Env, params: Record<string, string>): Promise<GhTokens> {
  const r = await fetch(`${ghWeb(env)}/login/oauth/access_token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "wolos-hub" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, ...params }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const body = (await r.json().catch(() => ({}))) as Partial<GhTokens> & { error?: string };
  if (!r.ok || !body.access_token) fail(502, "github-sign-in", "GitHub did not accept the sign-in. Try signing in again.");
  return body as GhTokens;
}

export const exchangeCode = (env: Env, code: string, verifier: string, redirect: string) =>
  tokenCall(env, { code, code_verifier: verifier, redirect_uri: redirect });

export const refreshTokens = (env: Env, refresh: string) =>
  tokenCall(env, { grant_type: "refresh_token", refresh_token: refresh });

export class GhUnauthorized extends Error {}

async function api<T>(env: Env, token: string, path: string): Promise<{ status: number; body: T | null }> {
  const r = await fetch(`${ghApi(env)}${path}`, {
    headers: {
      authorization: `Bearer ${token}`, accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28", "user-agent": "wolos-hub",
    },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (r.status === 401) throw new GhUnauthorized();
  if (r.status === 404 || r.status === 403) return { status: r.status, body: null };
  if (!r.ok) fail(502, "github-down", "GitHub is not answering right now. Try again in a minute.");
  return { status: r.status, body: (await r.json()) as T };
}

export async function getUser(env: Env, token: string): Promise<GhUser> {
  const { body } = await api<GhUser>(env, token, "/user");
  if (!body || typeof body.id !== "number") return fail(502, "github-user", "GitHub did not say who you are.");
  return body;
}

export async function getOrgMemberships(env: Env, token: string): Promise<GhOrgMembership[]> {
  const { body } = await api<GhOrgMembership[]>(env, token, "/user/memberships/orgs?state=active&per_page=100");
  return (body ?? []).filter((m) => m.state === "active" && m.organization && typeof m.organization.id === "number");
}

export async function getOrgMembership(env: Env, token: string, org: string): Promise<GhOrgMembership | null> {
  if (!/^[A-Za-z0-9-]{1,39}$/.test(org)) return null;
  const { body } = await api<GhOrgMembership>(env, token, `/user/memberships/orgs/${org}`);
  return body && body.state === "active" ? body : null;
}

export async function getRepo(env: Env, token: string, fullName: string): Promise<GhRepo | null> {
  if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(fullName)) return null;
  const { body } = await api<GhRepo>(env, token, `/repos/${fullName}`);
  return body;
}

/** GitHub says "admin" for organisation owners. */
export const hubRole = (r: string): "owner" | "member" => (r === "admin" ? "owner" : "member");
