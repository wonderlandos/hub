// SPDX-License-Identifier: GPL-2.0-or-later
// The hub admin panel's API. Admins are the GitHub logins in the variable ADMINS (the same list as
// hub-index's CA_APPROVERS). Every action is written to audit_log. An admin never approves a
// certificate request for themselves (or for an organisation they belong to).

import type { Ctx } from "./ctx";
import type { Env } from "./env";
import { admins, now } from "./env";
import { fail, json, readJson, sameOrigin, str } from "./http";
import { requireSession, type Person, type Session } from "./session";
import { limit, RULES } from "./ratelimit";
import { audit } from "./audit";
import { log } from "./log";
import { REQUEST_ID, requestView, type RequestRow } from "./certs";
import { dispatchCa } from "./ghapp";

export const isAdmin = (env: Env, p: Person) => admins(env).has(p.login.toLowerCase());

export async function requireAdmin(ctx: Ctx): Promise<Session> {
  const s = await requireSession(ctx);
  if (!isAdmin(ctx.env, s.person)) fail(403, "not-admin", "Only a hub admin can do this.");
  return s;
}

/** POSTs of the panel: from the hub's own pages, counted per person. */
async function adminWrite(ctx: Ctx): Promise<Session> {
  sameOrigin(ctx.req, ctx.env);
  const s = await requireAdmin(ctx);
  await limit(ctx.env, RULES.writePerson, s.person.github_id);
  return s;
}

/** An optional note or reason from the body, at most 500 characters. */
async function note(ctx: Ctx, field: string, required: boolean): Promise<string | null> {
  const ct = ctx.req.headers.get("content-type") ?? "";
  const b = ct.toLowerCase().startsWith("application/json") ? await readJson(ctx.req) : {};
  if (b[field] === undefined || b[field] === null || b[field] === "") {
    if (required) fail(400, "bad-field", `Say why in '${field}'.`);
    return null;
  }
  return str(b[field], field, 500);
}

interface ReportRow {
  id: number; listing_id: string; version: string | null; reporter: number; reason: string; text: string;
  state: string; created_at: number; listing_name: string | null; listing_status: string | null;
}

export async function queue(ctx: Ctx): Promise<Response> {
  await requireAdmin(ctx);
  const db = ctx.env.DB;
  const reqs = (await db.prepare(
    "SELECT * FROM cert_requests WHERE status IN ('pending','approved') ORDER BY created_at, id LIMIT 200",
  ).all<RequestRow>()).results;
  const reports = (await db.prepare(
    `SELECT r.id, r.listing_id, r.version, r.reporter, r.reason, r.text, r.state, r.created_at, l.name AS listing_name, l.status AS listing_status
     FROM reports r LEFT JOIN listings l ON l.id = r.listing_id WHERE r.state = 'open' ORDER BY r.created_at, r.id LIMIT 200`,
  ).all<ReportRow>()).results;
  return json({
    requests: await Promise.all(reqs.map((r) => requestView(ctx.env, r, true))),
    reports: reports.map((r) => ({
      id: r.id, listing: { id: r.listing_id, name: r.listing_name, status: r.listing_status }, version: r.version,
      reporter: r.reporter, reason: r.reason, text: r.text, created_at: r.created_at,
    })),
  });
}

async function loadRequest(ctx: Ctx, id: string): Promise<RequestRow> {
  const row = REQUEST_ID.test(id)
    ? await ctx.env.DB.prepare("SELECT * FROM cert_requests WHERE id = ?").bind(id).first<RequestRow>() : null;
  if (!row) fail(404, "no-request", "There is no certificate request with this id.");
  return row!;
}

/** The approver may not be the subject, the one who asked, or a member of the organisation asking. */
async function notOwn(ctx: Ctx, s: Session, row: RequestRow): Promise<void> {
  const me = s.person.github_id;
  const own = row.requested_by === me || (row.kind === "person" && row.subject_id === me) ||
    (row.kind === "org" && !!(await ctx.env.DB.prepare("SELECT 1 FROM memberships WHERE github_org_id = ? AND github_id = ?")
      .bind(row.subject_id, me).first()));
  if (own) fail(403, "own-request", "You cannot approve a certificate for yourself. Another admin has to.");
}

/** Approve, then start the ca workflow. Approving an approved request that has no certificate yet
 * starts the workflow again (after a failed dispatch); the first approver stays approved_by. */
export async function approveRequest(ctx: Ctx, id: string): Promise<Response> {
  const s = await adminWrite(ctx);
  const row = await loadRequest(ctx, id);
  await notOwn(ctx, s, row);
  if (row.status === "issued" || row.status === "refused") fail(409, "request-closed", `Request ${id} is ${row.status}.`);
  const db = ctx.env.DB;
  const t = now();
  if (row.status === "pending") {
    const res = await db.batch([
      db.prepare("UPDATE cert_requests SET status = 'approved', decided_by = ?, decided_login = ?, decided_at = ? WHERE id = ? AND status = 'pending'")
        .bind(s.person.github_id, s.person.login, t, id),
      audit(db, "person", s.person.github_id, "cert.approve", `request:${id}`, { subject: row.subject_id, kind: row.kind }),
    ]);
    if (!res[0].meta.changes) fail(409, "request-changed", `Request ${id} changed meanwhile. Reload the queue.`);
  }
  let dispatched = true, error: string | null = null;
  try {
    await dispatchCa(ctx.env, id);
  } catch (e) {
    dispatched = false;
    error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    log("cert.dispatch-failed", { request: id, message: error });
  }
  await db.batch([
    dispatched
      ? db.prepare("UPDATE cert_requests SET dispatched_at = ?, dispatch_error = NULL WHERE id = ?").bind(now(), id)
      : db.prepare("UPDATE cert_requests SET dispatch_error = ? WHERE id = ?").bind(error, id),
    audit(db, "person", s.person.github_id, dispatched ? "cert.dispatch" : "cert.dispatch-failed", `request:${id}`, error ? { error } : {}),
  ]);
  const fresh = await loadRequest(ctx, id);
  return json({
    request: await requestView(ctx.env, fresh, true), dispatched,
    sentence: dispatched ? "Approved. The certificate is being issued now." : "Approved, but the issuing workflow could not be started. Approve again to retry.",
  }, dispatched ? 200 : 202);
}

export async function refuseRequest(ctx: Ctx, id: string): Promise<Response> {
  const s = await adminWrite(ctx);
  const reason = await note(ctx, "reason", true);
  const row = await loadRequest(ctx, id);
  if (row.status !== "pending" && row.status !== "approved") fail(409, "request-closed", `Request ${id} is ${row.status}.`);
  const db = ctx.env.DB;
  const res = await db.batch([
    db.prepare("UPDATE cert_requests SET status = 'refused', decided_by = ?, decided_login = ?, decided_at = ?, reason = ? WHERE id = ? AND status IN ('pending','approved')")
      .bind(s.person.github_id, s.person.login, now(), reason, id),
    audit(db, "person", s.person.github_id, "cert.refuse", `request:${id}`, { subject: row.subject_id }),
  ]);
  if (!res[0].meta.changes) fail(409, "request-changed", `Request ${id} changed meanwhile. Reload the queue.`);
  return json({ request: await requestView(ctx.env, await loadRequest(ctx, id), true) });
}

async function openReport(ctx: Ctx, id: string): Promise<{ id: number; listing_id: string }> {
  const n = /^[1-9][0-9]{0,15}$/.test(id) ? Number(id) : 0;
  const r = n ? await ctx.env.DB.prepare("SELECT id, listing_id, state FROM reports WHERE id = ?").bind(n).first<{ id: number; listing_id: string; state: string }>() : null;
  if (!r) fail(404, "no-report", "There is no report with that number.");
  if (r!.state !== "open") fail(409, "report-closed", `Report ${n} is already ${r!.state}.`);
  return r!;
}

/** Closes a report without action on the listing. */
export async function resolveReport(ctx: Ctx, id: string): Promise<Response> {
  const s = await adminWrite(ctx);
  const text = await note(ctx, "note", false);
  const r = await openReport(ctx, id);
  const db = ctx.env.DB;
  await db.batch([
    db.prepare("UPDATE reports SET state = 'dismissed', moderator = ?, action = 'resolved', decided_at = ? WHERE id = ? AND state = 'open'")
      .bind(s.person.github_id, now(), r.id),
    audit(db, "person", s.person.github_id, "report.resolve", `report:${r.id}`, { listing: r.listing_id, ...(text ? { note: text } : {}) }),
  ]);
  return json({ report: { id: r.id, state: "dismissed", action: "resolved" } });
}

/** Withdraws the listing: it leaves the next signed index and is named in the export's "withdrawn". */
export async function takedown(ctx: Ctx, id: string): Promise<Response> {
  const s = await adminWrite(ctx);
  const text = await note(ctx, "note", false);
  const r = await openReport(ctx, id);
  const db = ctx.env.DB;
  const t = now();
  await db.batch([
    db.prepare("UPDATE reports SET state = 'actioned', moderator = ?, action = 'takedown', decided_at = ? WHERE id = ? AND state = 'open'")
      .bind(s.person.github_id, t, r.id),
    db.prepare("UPDATE listings SET status = 'withdrawn', updated_at = ? WHERE id = ?").bind(t, r.listing_id),
    db.prepare(
      "INSERT INTO takedowns (listing_id, report_id, admin, note, at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT (listing_id) DO UPDATE SET report_id = excluded.report_id, admin = excluded.admin, note = excluded.note, at = excluded.at",
    ).bind(r.listing_id, r.id, s.person.github_id, text, t),
    audit(db, "person", s.person.github_id, "listing.takedown", `listing:${r.listing_id}`, { report: r.id, ...(text ? { note: text } : {}) }),
  ]);
  return json({ report: { id: r.id, state: "actioned", action: "takedown" }, listing: { id: r.listing_id, status: "withdrawn" } });
}
