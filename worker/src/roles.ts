// SPDX-License-Identifier: GPL-2.0-or-later
// Admin panel roles (RBAC). The panel is closed: a route under /api/admin answers 404, exactly as an unknown address,
// to anyone without a role (signed out, no role, or no two-factor authentication on GitHub), never 403, and every
// response under it says noindex. Roles live in admin_roles; the logins in ADMINS are owners (the seed). Each role has
// the least rights it needs; every action is in audit_log with actor, role, target, reason and the address class
// (IPv4 or IPv6 and the country, never the address); each role has its own rate limit.

import type { Ctx } from "./ctx";
import type { Env } from "./env";
import { admins, now } from "./env";
import { fail, sameOrigin } from "./http";
import { optionalSession, type Person, type Session } from "./session";
import { getUser } from "./github";
import { limit, RULES, type Rule } from "./ratelimit";
import { audit } from "./audit";
import { log } from "./log";

export const ROLES = ["owner", "admin", "reviewer", "support"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "queue.requests" | "queue.reports" | "request.approve" | "request.refuse" | "cert.revoke" | "cert.downgrade"
  | "report.resolve" | "report.takedown" | "release.flag" | "release.withdraw" | "audit.read" | "roles.manage";

/** Least rights per role (lead 2026-11-04). The owner holds every permission, including roles. */
export const GRANTS: Record<Role, readonly Permission[]> = {
  owner: ["queue.requests", "queue.reports", "request.approve", "request.refuse", "cert.revoke", "cert.downgrade",
    "report.resolve", "report.takedown", "release.flag", "release.withdraw", "audit.read", "roles.manage"],
  admin: ["queue.requests", "queue.reports", "request.approve", "request.refuse", "cert.revoke", "cert.downgrade",
    "report.resolve", "report.takedown", "release.withdraw", "audit.read"],
  reviewer: ["queue.requests", "request.approve", "request.refuse", "release.flag"],
  support: ["queue.reports", "report.resolve"],
};

/** Panel writes per role, per person, per hour (on top of the general per-person write limit). */
export const ROLE_RULES: Record<Role, Rule> = {
  owner: { name: "admin-owner", limit: 120, window: 3600 },
  admin: { name: "admin-admin", limit: 120, window: 3600 },
  reviewer: { name: "admin-reviewer", limit: 60, window: 3600 },
  support: { name: "admin-support", limit: 60, window: 3600 },
};

/** How often an admin's two-factor authentication is asked of GitHub again. */
export const TWO_FACTOR_RECHECK = 3600;

export const may = (role: Role | null, p: Permission): boolean => !!role && GRANTS[role].includes(p);

/** The person's role: an ADMINS login is an owner; a row seeded from ADMINS counts only while the login is in it. */
export async function roleOf(env: Env, p: Pick<Person, "github_id" | "login">): Promise<Role | null> {
  const seeded = admins(env).has(p.login.toLowerCase());
  if (seeded) return "owner";
  const row = await env.DB.prepare("SELECT role, granted_by FROM admin_roles WHERE github_id = ?").bind(p.github_id)
    .first<{ role: Role; granted_by: string }>();
  if (!row || row.granted_by === "ADMINS") return null;
  return row.role;
}

/** Sign-in: an ADMINS login gets (or keeps) its owner row. */
export function seedStatements(env: Env, githubId: number, login: string, t: number): D1PreparedStatement[] {
  if (!admins(env).has(login.toLowerCase())) return [];
  return [env.DB.prepare(
    "INSERT INTO admin_roles (github_id, role, granted_by, granted_at) VALUES (?, 'owner', 'ADMINS', ?) " +
    "ON CONFLICT (github_id) DO UPDATE SET role = 'owner', granted_by = 'ADMINS', granted_at = excluded.granted_at " +
    "WHERE admin_roles.role != 'owner' OR admin_roles.granted_by != 'ADMINS'",
  ).bind(githubId, t)];
}

/** The panel does not exist for this request: the router's own 404. */
export const hidden = (): never => fail(404, "not-found", "There is nothing at this address.");

/** The address class kept in audit_log instead of the address. */
export function ipClass(ctx: Ctx): { ip_class: "v4" | "v6" | "unknown"; country?: string } {
  const ip = ctx.ip;
  const v = /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? "v4" : ip.includes(":") ? "v6" : "unknown";
  const country = (ctx.req as Request & { cf?: { country?: unknown } }).cf?.country;
  return { ip_class: v, ...(typeof country === "string" && /^[A-Z]{2}$/.test(country) ? { country } : {}) };
}

export interface Staff { s: Session; role: Role }

/** Two-factor authentication on GitHub: required for every role, checked at sign-in and again every hour. */
async function twoFactor(ctx: Ctx, s: Session): Promise<boolean> {
  const p = s.person as Person & { two_factor_checked_at?: number | null };
  const t = now();
  if (p.two_factor === 1 && p.two_factor_checked_at && t - p.two_factor_checked_at < TWO_FACTOR_RECHECK) return true;
  let on: boolean | null = null;
  try {
    const u = await getUser(ctx.env, await s.token());
    if (u.id !== p.github_id) return false;
    on = u.two_factor_authentication === undefined ? null : !!u.two_factor_authentication;
  } catch {
    return false; // signed out on GitHub, or GitHub did not answer: the panel stays closed rather than trusting an old answer
  }
  await ctx.env.DB.prepare("UPDATE persons SET two_factor = ?, two_factor_checked_at = ? WHERE github_id = ?")
    .bind(on === null ? null : on ? 1 : 0, t, p.github_id).run();
  if (!on) log("admin.two-factor-off", { person: p.github_id });
  return on === true;
}

/** A panel request: a role, two-factor authentication, then the permission (null: any role). Anyone without a role,
 * or without two-factor authentication, gets 404. */
export async function requireRole(ctx: Ctx, perm: Permission | null): Promise<Staff> {
  const s = await optionalSession(ctx).catch(() => null);
  if (!s) return hidden();
  const role = await roleOf(ctx.env, s.person);
  if (!role) return hidden();
  if (!(await twoFactor(ctx, s))) return hidden();
  if (perm && !may(role, perm)) fail(403, "not-allowed", `The ${role} role cannot do this.`);
  return { s, role };
}

/** A panel write: the role first (so nobody without one learns anything), then the hub's origin and the limits. */
export async function requireRoleWrite(ctx: Ctx, perm: Permission): Promise<Staff> {
  const st = await requireRole(ctx, perm);
  sameOrigin(ctx.req, ctx.env);
  await limit(ctx.env, RULES.writeIp, ctx.ip);
  await limit(ctx.env, RULES.writePerson, st.s.person.github_id);
  await limit(ctx.env, ROLE_RULES[st.role], st.s.person.github_id);
  return st;
}

/** One panel action in audit_log: actor, role, target, reason and the address class. */
export function staffAudit(ctx: Ctx, st: Staff, action: string, target: string, reason: string | null, detail: Record<string, unknown> = {}): D1PreparedStatement {
  return audit(ctx.env.DB, "person", st.s.person.github_id, action, target, {
    actor: st.s.person.login, role: st.role, reason, ...ipClass(ctx), ...detail,
  });
}
