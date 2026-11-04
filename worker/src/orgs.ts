// SPDX-License-Identifier: GPL-2.0-or-later
// GitHub organisations. Roles come from GitHub; the memberships table is a cache that
// gated actions refresh. Only a GitHub owner of an organisation may link it.

import type { Ctx } from "./ctx";
import { now } from "./env";
import { fail, json, readJson, sameOrigin, str } from "./http";
import { requireSession, type Session } from "./session";
import { getOrgMembership, getOrgMemberships, hubRole, type GhOrgMembership } from "./github";
import { acceptedBody, claStatus, requireCla } from "./cla";
import { audit } from "./audit";

export const MEMBERSHIP_TTL = 600;

export interface Membership { github_org_id: number; org_login: string; role: "owner" | "member"; synced_at: number }

/** Replaces the person's cached memberships with what GitHub says now. */
export async function syncMemberships(ctx: Ctx, githubId: number, list: GhOrgMembership[]): Promise<Membership[]> {
  const db = ctx.env.DB;
  const t = now();
  const rows: Membership[] = list.map((m) => ({
    github_org_id: m.organization.id, org_login: m.organization.login, role: hubRole(m.role), synced_at: t,
  }));
  await db.batch([
    db.prepare("DELETE FROM memberships WHERE github_id = ?").bind(githubId),
    ...rows.map((r) => db.prepare(
      "INSERT INTO memberships (github_org_id, github_id, org_login, role, synced_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(r.github_org_id, githubId, r.org_login, r.role, r.synced_at)),
  ]);
  return rows;
}

export async function memberships(ctx: Ctx, s: Session, fresh = false): Promise<Membership[]> {
  const db = ctx.env.DB;
  const rows = (await db.prepare(
    "SELECT github_org_id, org_login, role, synced_at FROM memberships WHERE github_id = ? ORDER BY org_login",
  ).bind(s.person.github_id).all<Membership>()).results;
  const oldest = rows.reduce((m, r) => Math.min(m, r.synced_at), Infinity);
  if (!fresh && rows.length > 0 && now() - oldest < MEMBERSHIP_TTL) return rows;
  if (!fresh && rows.length === 0 && now() - s.person.last_seen < MEMBERSHIP_TTL) return rows;
  return syncMemberships(ctx, s.person.github_id, await getOrgMemberships(ctx.env, await s.token()));
}

/** Asks GitHub, now, for the person's role in the organisation, and updates the cache. */
export async function liveRole(ctx: Ctx, s: Session, org: { github_org_id: number; login: string }): Promise<"owner" | "member" | null> {
  const m = await getOrgMembership(ctx.env, await s.token(), org.login);
  const db = ctx.env.DB;
  if (!m || m.organization.id !== org.github_org_id) {
    await db.prepare("DELETE FROM memberships WHERE github_org_id = ? AND github_id = ?").bind(org.github_org_id, s.person.github_id).run();
    return null;
  }
  const role = hubRole(m.role);
  await db.prepare(
    "INSERT INTO memberships (github_org_id, github_id, org_login, role, synced_at) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT (github_org_id, github_id) DO UPDATE SET org_login = excluded.org_login, role = excluded.role, synced_at = excluded.synced_at",
  ).bind(org.github_org_id, s.person.github_id, m.organization.login, role, now()).run();
  return role;
}

interface OrgRow { github_org_id: number; login: string; name: string | null; linked_by: number; linked_at: number }

export async function orgView(ctx: Ctx, m: Membership) {
  const org = await ctx.env.DB.prepare("SELECT * FROM orgs WHERE github_org_id = ?").bind(m.github_org_id).first<OrgRow>();
  return {
    github_org_id: m.github_org_id, login: m.org_login, role: m.role,
    linked: !!org, cla: org ? await claStatus(ctx.env, "org", m.github_org_id) : null,
  };
}

export async function getOrgs(ctx: Ctx): Promise<Response> {
  const s = await requireSession(ctx);
  const list = await memberships(ctx, s);
  return json({ orgs: await Promise.all(list.map((m) => orgView(ctx, m))) });
}

export async function postOrgs(ctx: Ctx): Promise<Response> {
  sameOrigin(ctx.req, ctx.env);
  const s = await requireSession(ctx);
  const body = await readJson(ctx.req);
  const login = str(body.org, "org", 39);
  await requireCla(ctx.env, "person", s.person.github_id);
  const cla = await acceptedBody(ctx.env, body);
  const m = await getOrgMembership(ctx.env, await s.token(), login);
  if (!m) fail(404, "not-a-member", `You are not a member of ${login} on GitHub, or the hub's GitHub App is not installed there.`);
  if (hubRole(m!.role) !== "owner") fail(403, "not-owner", `Only an owner of ${login} on GitHub can link it to the hub.`);
  const id = m!.organization.id;
  const t = now();
  const db = ctx.env.DB;
  await db.batch([
    db.prepare(
      "INSERT INTO orgs (github_org_id, login, name, avatar, linked_by, linked_at) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT (github_org_id) DO UPDATE SET login = excluded.login",
    ).bind(id, m!.organization.login, null, m!.organization.avatar_url ?? null, s.person.github_id, t),
    db.prepare(
      "INSERT OR IGNORE INTO cla_acceptances (subject_kind, subject_id, version, sha256, accepted_by, accepted_at) VALUES ('org', ?, ?, ?, ?, ?)",
    ).bind(id, cla.version, cla.sha256, s.person.github_id, t),
    db.prepare(
      "INSERT INTO memberships (github_org_id, github_id, org_login, role, synced_at) VALUES (?, ?, ?, 'owner', ?) " +
      "ON CONFLICT (github_org_id, github_id) DO UPDATE SET role = 'owner', org_login = excluded.org_login, synced_at = excluded.synced_at",
    ).bind(id, s.person.github_id, m!.organization.login, t),
    audit(db, "person", s.person.github_id, "org.link", `org:${id}`, { login: m!.organization.login, cla: cla.version }),
  ]);
  return json({ org: await orgView(ctx, { github_org_id: id, org_login: m!.organization.login, role: "owner", synced_at: t }) }, 201);
}

/** GET /api/orgs/<login>/members: the members and roles the Worker knows (synced from GitHub at their sign-in), for
 * members of that organisation only; anyone else gets 404. */
export async function getOrgMembers(ctx: Ctx, login: string): Promise<Response> {
  const s = await requireSession(ctx);
  const db = ctx.env.DB;
  const org = /^[A-Za-z0-9-]{1,39}$/.test(login)
    ? await db.prepare("SELECT github_org_id, login FROM orgs WHERE lower(login) = lower(?)").bind(login).first<{ github_org_id: number; login: string }>() : null;
  const mine = org ? await db.prepare("SELECT 1 FROM memberships WHERE github_org_id = ? AND github_id = ?").bind(org.github_org_id, s.person.github_id).first() : null;
  if (!org || !mine) fail(404, "no-org", "There is no organisation with that name that you belong to.");
  const members = (await db.prepare(
    "SELECT p.login, m.role, m.synced_at FROM memberships m JOIN persons p ON p.github_id = m.github_id WHERE m.github_org_id = ? ORDER BY m.role DESC, p.login LIMIT 500",
  ).bind(org!.github_org_id).all<{ login: string; role: string; synced_at: number }>()).results;
  return json({ org: org!.login, members });
}
