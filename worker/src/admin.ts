// SPDX-License-Identifier: GPL-2.0-or-later
// The hub admin panel's API. Closed (roles.ts): every route needs a role and two-factor authentication on GitHub, and
// answers 404 to anyone else. Every action is in audit_log with actor, role, target, reason and address class. Nobody
// decides about their own certificate (or an organisation they belong to).

import type { Ctx } from "./ctx";
import { admins, now } from "./env";
import { fail, json, readJson, str } from "./http";
import { hex, random } from "./crypto";
import {
  type CertRow, liveCert, REQUEST_ID, requestView, type RequestRow, type RevocationRow, SERIAL, startCa,
} from "./certs";
import { may, requireRole, requireRoleWrite, ROLES, type Role, roleOf, type Staff, staffAudit } from "./roles";
import { validId } from "./listings";

/** The body's optional or required text field, at most 500 characters. */
async function field(ctx: Ctx, name: string, required: boolean): Promise<{ text: string | null; body: Record<string, unknown> }> {
  const ct = ctx.req.headers.get("content-type") ?? "";
  const b = ct.toLowerCase().startsWith("application/json") ? await readJson(ctx.req) : {};
  if (b[name] === undefined || b[name] === null || b[name] === "") {
    if (required) fail(400, "bad-field", `Say why in '${name}'.`);
    return { text: null, body: b };
  }
  return { text: str(b[name], name, 500), body: b };
}

interface ReportRow {
  id: number; listing_id: string; version: string | null; reporter: number; reason: string; text: string;
  state: string; created_at: number; listing_name: string | null; listing_status: string | null;
}

/** What the role may see: requests for those who decide them, reports for those who handle them. */
export async function queue(ctx: Ctx): Promise<Response> {
  const st = await requireRole(ctx, null);
  const db = ctx.env.DB;
  const out: Record<string, unknown> = { role: st.role };
  if (may(st.role, "queue.requests")) {
    const reqs = (await db.prepare(
      "SELECT * FROM cert_requests WHERE status IN ('pending','approved') ORDER BY created_at, id LIMIT 200",
    ).all<RequestRow>()).results;
    out.requests = await Promise.all(reqs.map((r) => requestView(ctx.env, r, true)));
  }
  if (may(st.role, "queue.reports")) {
    const reports = (await db.prepare(
      `SELECT r.id, r.listing_id, r.version, r.reporter, r.reason, r.text, r.state, r.created_at, l.name AS listing_name, l.status AS listing_status
       FROM reports r LEFT JOIN listings l ON l.id = r.listing_id WHERE r.state = 'open' ORDER BY r.created_at, r.id LIMIT 200`,
    ).all<ReportRow>()).results;
    out.reports = reports.map((r) => ({
      id: r.id, listing: { id: r.listing_id, name: r.listing_name, status: r.listing_status }, version: r.version,
      reporter: r.reporter, reason: r.reason, text: r.text, created_at: r.created_at,
    }));
  }
  if (may(st.role, "cert.revoke")) {
    const rv = (await db.prepare("SELECT * FROM revocations WHERE status != 'done' ORDER BY created_at, id LIMIT 200").all<RevocationRow>()).results;
    out.revocations = rv.map(revocationView);
  }
  return json(out);
}

async function loadRequest(ctx: Ctx, id: string): Promise<RequestRow> {
  const row = REQUEST_ID.test(id)
    ? await ctx.env.DB.prepare("SELECT * FROM cert_requests WHERE id = ?").bind(id).first<RequestRow>() : null;
  if (!row) fail(404, "no-request", "There is no certificate request with this id.");
  return row!;
}

/** True when the person is the subject (or a member of the organisation that is). */
async function isSubject(ctx: Ctx, me: number, kind: string, subjectId: number): Promise<boolean> {
  if (kind === "person") return subjectId === me;
  return !!(await ctx.env.DB.prepare("SELECT 1 FROM memberships WHERE github_org_id = ? AND github_id = ?").bind(subjectId, me).first());
}

/** The approver may not be the subject, the one who asked, or a member of the organisation asking. */
async function notOwn(ctx: Ctx, st: Staff, row: RequestRow): Promise<void> {
  const me = st.s.person.github_id;
  if (row.requested_by === me || await isSubject(ctx, me, row.kind, row.subject_id)) {
    fail(403, "own-request", "You cannot decide about a certificate for yourself. Another admin has to.");
  }
}

/** Approve, then start the ca workflow. Approving an approved request that has no certificate yet starts the workflow
 * again (after a failed dispatch); the first approver stays approved_by. A trusted request still needs its origin
 * certificate alive. */
export async function approveRequest(ctx: Ctx, id: string): Promise<Response> {
  const st = await requireRoleWrite(ctx, "request.approve");
  const { text: note } = await field(ctx, "note", false);
  const row = await loadRequest(ctx, id);
  await notOwn(ctx, st, row);
  if (row.status === "issued" || row.status === "refused") fail(409, "request-closed", `Request ${id} is ${row.status}.`);
  if (row.tier === "trusted") {
    const origin = await liveCert(ctx.env, row.kind, row.subject_id, "origin");
    if (!origin || origin.serial !== row.origin_cert) fail(409, "origin-gone", `The origin certificate ${row.origin_cert} of this request is no longer valid. Refuse it.`);
  }
  const db = ctx.env.DB;
  const t = now();
  if (row.status === "pending") {
    const res = await db.batch([
      db.prepare("UPDATE cert_requests SET status = 'approved', decided_by = ?, decided_login = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
        .bind(st.s.person.github_id, st.s.person.login, t, id),
      staffAudit(ctx, st, "cert.approve", `request:${id}`, note, { subject: row.subject_id, kind: row.kind, tier: row.tier }),
    ]);
    if (!res[0].meta.changes) fail(409, "request-changed", `Request ${id} changed meanwhile. Reload the queue.`);
  }
  const { dispatched } = await startCa(ctx.env, "cert_requests", id, ["person", st.s.person.github_id]);
  const fresh = await loadRequest(ctx, id);
  return json({
    request: await requestView(ctx.env, fresh, true), dispatched,
    sentence: dispatched ? "Approved. The certificate is being issued now." : "Approved, but the issuing workflow could not be started. Approve again to retry.",
  }, dispatched ? 200 : 202);
}

export async function refuseRequest(ctx: Ctx, id: string): Promise<Response> {
  const st = await requireRoleWrite(ctx, "request.refuse");
  const { text: reason } = await field(ctx, "reason", true);
  const row = await loadRequest(ctx, id);
  if (row.status !== "pending" && row.status !== "approved") fail(409, "request-closed", `Request ${id} is ${row.status}.`);
  if (row.status === "approved" && row.dispatched_at) fail(409, "request-dispatched", `Request ${id} is being issued already; revoke the certificate once it exists.`);
  const db = ctx.env.DB;
  const res = await db.batch([
    db.prepare("UPDATE cert_requests SET status = 'refused', decided_by = ?, decided_login = ?, decided_at = ?, reason = ? WHERE id = ? AND status IN ('pending','approved')")
      .bind(st.s.person.github_id, st.s.person.login, now(), reason, id),
    staffAudit(ctx, st, "cert.refuse", `request:${id}`, reason, { subject: row.subject_id, tier: row.tier }),
  ]);
  if (!res[0].meta.changes) fail(409, "request-changed", `Request ${id} changed meanwhile. Reload the queue.`);
  return json({ request: await requestView(ctx.env, await loadRequest(ctx, id), true) });
}

// ---- revocations and downgrades --------------------------------------------------------------------------------

const REVOKE_REASONS = ["key-compromise", "abuse"] as const;

function revocationView(r: RevocationRow) {
  return {
    id: r.id, group: r.grp, serial: r.serial, action: r.action, reason: r.reason, note: r.note, status: r.status,
    requested_by: r.requested_by, approved_by: JSON.parse(r.approvers), approved_at: r.approved_at,
    dispatched_at: r.dispatched_at, dispatch_error: r.dispatch_error, done_at: r.done_at, created_at: r.created_at,
  };
}

async function loadCert(ctx: Ctx, serial: string): Promise<CertRow> {
  const c = SERIAL.test(serial) ? await ctx.env.DB.prepare("SELECT * FROM certs WHERE serial = ?").bind(serial).first<CertRow>() : null;
  if (!c) fail(404, "no-cert", "There is no certificate with this serial.");
  if (c!.revoked_at) fail(409, "cert-revoked", `Certificate ${serial} is revoked already.`);
  return c!;
}

async function notOwnCert(ctx: Ctx, st: Staff, c: CertRow): Promise<void> {
  if (await isSubject(ctx, st.s.person.github_id, c.kind, c.subject_id)) {
    fail(403, "own-cert", "You cannot revoke or downgrade a certificate of your own. Another admin has to.");
  }
}

/** Serials that already have a revocation on its way. */
async function inFlight(ctx: Ctx, serials: string[]): Promise<Set<string>> {
  if (!serials.length) return new Set();
  const rows = (await ctx.env.DB.prepare(`SELECT serial FROM revocations WHERE serial IN (${serials.map(() => "?").join(",")})`)
    .bind(...serials).all<{ serial: string }>()).results;
  return new Set(rows.map((r) => r.serial));
}

/** Dispatches every approved row of a group; returns the rows as they are now. */
async function dispatchGroup(ctx: Ctx, st: Staff, grp: string): Promise<{ rows: RevocationRow[]; dispatched: boolean }> {
  const db = ctx.env.DB;
  let all = true;
  const rows = (await db.prepare("SELECT * FROM revocations WHERE grp = ? AND status = 'approved' ORDER BY id").bind(grp).all<RevocationRow>()).results;
  for (const r of rows) all = (await startCa(ctx.env, "revocations", r.id, ["person", st.s.person.github_id])).dispatched && all;
  const fresh = (await db.prepare("SELECT * FROM revocations WHERE grp = ? ORDER BY id").bind(grp).all<RevocationRow>()).results;
  return { rows: fresh, dispatched: all };
}

/** Revoke (key-compromise or abuse): kills everything the subject holds. Every live certificate of the subject (origin
 * and trusted) gets a revocation, open requests of the subject are refused. key-compromise starts at once; abuse waits
 * for a second admin (POST /api/admin/revocations/:group/approve), as hub-index requires two approvers for it. */
export async function revokeCert(ctx: Ctx, serial: string): Promise<Response> {
  const st = await requireRoleWrite(ctx, "cert.revoke");
  const { text: note, body } = await field(ctx, "note", false);
  const reason = body.reason;
  if (!(REVOKE_REASONS as readonly unknown[]).includes(reason)) fail(400, "bad-field", "'reason' is key-compromise or abuse.");
  const c = await loadCert(ctx, serial);
  await notOwnCert(ctx, st, c);
  const db = ctx.env.DB;
  const t = now();
  const live = (await db.prepare("SELECT serial FROM certs WHERE kind = ? AND subject_id = ? AND revoked_at IS NULL ORDER BY tier, serial")
    .bind(c.kind, c.subject_id).all<{ serial: string }>()).results.map((r) => r.serial);
  const busy = await inFlight(ctx, live);
  const serials = live.filter((s) => !busy.has(s));
  if (!serials.length) fail(409, "revocation-open", `Every certificate of ${c.login} has a revocation on its way already.`);
  const grp = `g-${hex(random(8))}`;
  const urgent = reason === "key-compromise";
  const approvers = JSON.stringify([st.s.person.login]);
  await db.batch([
    ...serials.map((s) => db.prepare(
      "INSERT INTO revocations (id, grp, serial, action, reason, note, status, requested_by, approvers, approved_at, created_at) VALUES (?, ?, ?, 'revoke', ?, ?, ?, ?, ?, ?, ?)",
    ).bind(`v-${hex(random(8))}`, grp, s, reason as string, note, urgent ? "approved" : "pending", st.s.person.github_id, approvers, urgent ? t : null, t)),
    db.prepare("UPDATE cert_requests SET status = 'refused', decided_by = ?, decided_login = ?, decided_at = ?, reason = ? WHERE kind = ? AND subject_id = ? AND status = 'pending'")
      .bind(st.s.person.github_id, st.s.person.login, t, `certificates revoked: ${reason}`, c.kind, c.subject_id),
    staffAudit(ctx, st, "cert.revoke", `cert:${serial}`, reason as string, { note, group: grp, serials, subject: c.subject_id, waits_for_second: !urgent }),
  ]);
  const { rows, dispatched } = urgent ? await dispatchGroup(ctx, st, grp) : { rows: (await db.prepare("SELECT * FROM revocations WHERE grp = ? ORDER BY id").bind(grp).all<RevocationRow>()).results, dispatched: false };
  return json({
    group: grp, revocations: rows.map(revocationView), dispatched,
    sentence: urgent
      ? dispatched ? "Revoking now: every certificate of this subject goes on the revocation list." : "Recorded, but the workflow could not be started. Approve the group again to retry."
      : "Recorded. A revocation for abuse needs a second admin to approve it.",
  }, urgent && dispatched ? 200 : 202);
}

/** Downgrade: a trusted certificate revoked as superseded; the subject keeps its origin certificate and the index shows
 * what the trusted one signed as origin. */
export async function downgradeCert(ctx: Ctx, serial: string): Promise<Response> {
  const st = await requireRoleWrite(ctx, "cert.downgrade");
  const { text: note } = await field(ctx, "note", true);
  const c = await loadCert(ctx, serial);
  if (c.tier !== "trusted") fail(409, "not-trusted", `Certificate ${serial} is an origin certificate; only a trusted one is downgraded.`);
  await notOwnCert(ctx, st, c);
  if ((await inFlight(ctx, [serial])).size) fail(409, "revocation-open", `Certificate ${serial} has a revocation on its way already.`);
  const db = ctx.env.DB;
  const t = now();
  const grp = `g-${hex(random(8))}`;
  await db.batch([
    db.prepare(
      "INSERT INTO revocations (id, grp, serial, action, reason, note, status, requested_by, approvers, approved_at, created_at) VALUES (?, ?, ?, 'downgrade', 'superseded', ?, 'approved', ?, ?, ?, ?)",
    ).bind(`v-${hex(random(8))}`, grp, serial, note, st.s.person.github_id, JSON.stringify([st.s.person.login]), t, t),
    staffAudit(ctx, st, "cert.downgrade", `cert:${serial}`, note, { revoke_reason: "superseded", group: grp, subject: c.subject_id }),
  ]);
  const { rows, dispatched } = await dispatchGroup(ctx, st, grp);
  return json({ group: grp, revocations: rows.map(revocationView), dispatched,
    sentence: dispatched ? "Downgrading now: what this certificate signed shows as origin." : "Recorded, but the workflow could not be started. Approve the group again to retry." },
  dispatched ? 200 : 202);
}

/** The second approval of a revocation for abuse, or a retry of a dispatch that failed. */
export async function approveRevocation(ctx: Ctx, grp: string): Promise<Response> {
  const st = await requireRoleWrite(ctx, "cert.revoke");
  const { text: note } = await field(ctx, "note", false);
  const db = ctx.env.DB;
  const rows = /^g-[0-9a-f]{16}$/.test(grp)
    ? (await db.prepare("SELECT * FROM revocations WHERE grp = ? ORDER BY id").bind(grp).all<RevocationRow>()).results : [];
  if (!rows.length) fail(404, "no-revocation", "There is no revocation with this id.");
  const c = await db.prepare("SELECT * FROM certs WHERE serial = ?").bind(rows[0].serial).first<CertRow>();
  if (c) await notOwnCert(ctx, st, c);
  const pending = rows.filter((r) => r.status === "pending");
  if (pending.length) {
    const first = JSON.parse(pending[0].approvers) as string[];
    if (first.map((l) => l.toLowerCase()).includes(st.s.person.login.toLowerCase()) || pending[0].requested_by === st.s.person.github_id) {
      fail(403, "second-admin", "A revocation for abuse needs a second, different admin.");
    }
    const approvers = JSON.stringify([...first, st.s.person.login]);
    await db.batch([
      db.prepare("UPDATE revocations SET status = 'approved', approvers = ?, approved_at = ? WHERE grp = ? AND status = 'pending'").bind(approvers, now(), grp),
      staffAudit(ctx, st, "cert.revoke-approve", `revocation:${grp}`, note, { serials: pending.map((r) => r.serial) }),
    ]);
  } else if (!rows.some((r) => r.status === "approved")) {
    fail(409, "revocation-done", "This revocation is done already.");
  }
  const { rows: fresh, dispatched } = await dispatchGroup(ctx, st, grp);
  return json({ group: grp, revocations: fresh.map(revocationView), dispatched }, dispatched ? 200 : 202);
}

// ---- reports and releases --------------------------------------------------------------------------------------

async function openReport(ctx: Ctx, id: string): Promise<{ id: number; listing_id: string }> {
  const n = /^[1-9][0-9]{0,15}$/.test(id) ? Number(id) : 0;
  const r = n ? await ctx.env.DB.prepare("SELECT id, listing_id, state FROM reports WHERE id = ?").bind(n).first<{ id: number; listing_id: string; state: string }>() : null;
  if (!r) fail(404, "no-report", "There is no report with that number.");
  if (r!.state !== "open") fail(409, "report-closed", `Report ${n} is already ${r!.state}.`);
  return r!;
}

/** Closes a report without action on the listing. */
export async function resolveReport(ctx: Ctx, id: string): Promise<Response> {
  const st = await requireRoleWrite(ctx, "report.resolve");
  const { text } = await field(ctx, "note", false);
  const r = await openReport(ctx, id);
  const db = ctx.env.DB;
  await db.batch([
    db.prepare("UPDATE reports SET state = 'dismissed', moderator = ?, action = 'resolved', decided_at = ? WHERE id = ? AND state = 'open'")
      .bind(st.s.person.github_id, now(), r.id),
    staffAudit(ctx, st, "report.resolve", `report:${r.id}`, text, { listing: r.listing_id }),
  ]);
  return json({ report: { id: r.id, state: "dismissed", action: "resolved" } });
}

/** Withdraws the listing: it leaves the next signed index and is named in the export's "withdrawn". */
export async function takedown(ctx: Ctx, id: string): Promise<Response> {
  const st = await requireRoleWrite(ctx, "report.takedown");
  const { text } = await field(ctx, "note", false);
  const r = await openReport(ctx, id);
  const db = ctx.env.DB;
  const t = now();
  await db.batch([
    db.prepare("UPDATE reports SET state = 'actioned', moderator = ?, action = 'takedown', decided_at = ? WHERE id = ? AND state = 'open'")
      .bind(st.s.person.github_id, t, r.id),
    db.prepare("UPDATE listings SET status = 'withdrawn', updated_at = ? WHERE id = ?").bind(t, r.listing_id),
    db.prepare(
      "INSERT INTO takedowns (listing_id, report_id, admin, note, at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT (listing_id) DO UPDATE SET report_id = excluded.report_id, admin = excluded.admin, note = excluded.note, at = excluded.at",
    ).bind(r.listing_id, r.id, st.s.person.github_id, text, t),
    staffAudit(ctx, st, "listing.takedown", `listing:${r.listing_id}`, text, { report: r.id }),
  ]);
  return json({ report: { id: r.id, state: "actioned", action: "takedown" }, listing: { id: r.listing_id, status: "withdrawn" } });
}

/** A reviewer flags a release: it stays listed, its verdict shows flag, and the reason is its first finding. */
export async function flagRelease(ctx: Ctx, listing: string, version: string): Promise<Response> {
  const st = await requireRoleWrite(ctx, "release.flag");
  const { text: reason } = await field(ctx, "reason", true);
  if (!validId(listing)) fail(404, "no-release", "There is no release with that id and version.");
  const db = ctx.env.DB;
  const rel = await db.prepare("SELECT verdict FROM releases WHERE listing_id = ? AND version = ?").bind(listing, version).first<{ verdict: string }>();
  if (!rel) fail(404, "no-release", "There is no release with that id and version.");
  const t = now();
  await db.batch([
    db.prepare("INSERT INTO release_flags (listing_id, version, reviewer, reason, at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT (listing_id, version) DO UPDATE SET reviewer = excluded.reviewer, reason = excluded.reason, at = excluded.at")
      .bind(listing, version, st.s.person.github_id, reason, t),
    staffAudit(ctx, st, "release.flag", `release:${listing}@${version}`, reason, { verdict: rel!.verdict }),
  ]);
  return json({ release: { listing_id: listing, version, flagged: true, reason } });
}

// ---- roles (owner only) ----------------------------------------------------------------------------------------

export async function getRoles(ctx: Ctx): Promise<Response> {
  await requireRole(ctx, "roles.manage");
  const rows = (await ctx.env.DB.prepare(
    "SELECT r.github_id, p.login, r.role, r.granted_by, r.granted_at, p.two_factor FROM admin_roles r JOIN persons p ON p.github_id = r.github_id ORDER BY r.role, p.login",
  ).all<{ github_id: number; login: string; role: Role; granted_by: string; granted_at: number; two_factor: number | null }>()).results;
  const seed = admins(ctx.env);
  return json({
    roles: rows.filter((r) => r.granted_by !== "ADMINS" || seed.has(r.login.toLowerCase())).map((r) => ({ ...r, seeded: r.granted_by === "ADMINS", two_factor: r.two_factor === 1 })),
  });
}

/** {login, role: owner|admin|reviewer|support|none, reason}: grant, change or take away a role. */
export async function postRole(ctx: Ctx): Promise<Response> {
  const st = await requireRoleWrite(ctx, "roles.manage");
  const { text: reason, body } = await field(ctx, "reason", true);
  const login = str(body.login, "login", 39);
  const role = body.role;
  if (role !== "none" && !(ROLES as readonly unknown[]).includes(role)) fail(400, "bad-field", `'role' is one of ${ROLES.join(", ")} or none.`);
  const db = ctx.env.DB;
  const p = await db.prepare("SELECT github_id, login, two_factor FROM persons WHERE lower(login) = lower(?)").bind(login)
    .first<{ github_id: number; login: string; two_factor: number | null }>();
  if (!p) fail(404, "no-person", `${login} has not signed in to the hub yet.`);
  if (p!.github_id === st.s.person.github_id) fail(403, "own-role", "You cannot change your own role.");
  if (admins(ctx.env).has(p!.login.toLowerCase())) fail(409, "seeded", `${p!.login} is an owner through the ADMINS variable; change it there.`);
  if (role !== "none" && p!.two_factor !== 1) fail(409, "two-factor-needed", `${p!.login} has no two-factor authentication on GitHub.`);
  const before = await roleOf(ctx.env, p!);
  const t = now();
  await db.batch([
    role === "none"
      ? db.prepare("DELETE FROM admin_roles WHERE github_id = ?").bind(p!.github_id)
      : db.prepare("INSERT INTO admin_roles (github_id, role, granted_by, granted_at) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT (github_id) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by, granted_at = excluded.granted_at")
        .bind(p!.github_id, role as string, String(st.s.person.github_id), t),
    staffAudit(ctx, st, "role.set", `person:${p!.github_id}`, reason, { login: p!.login, from: before, to: role }),
  ]);
  return json({ person: { github_id: p!.github_id, login: p!.login }, role: role === "none" ? null : role });
}
