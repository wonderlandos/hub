// SPDX-License-Identifier: GPL-2.0-or-later
// Reports against a listing. Only the reporter and moderators can read a report.

import type { Ctx } from "./ctx";
import { now } from "./env";
import { fail, json, readJson, sameOrigin, str } from "./http";
import { requireSession } from "./session";
import { limit, RULES } from "./ratelimit";
import { validId } from "./listings";
import { audit } from "./audit";

export const REASONS = ["malware", "impersonation", "broken", "license", "conduct"] as const;
export const MIN_ACCOUNT_AGE = 7 * 86400;

interface ReportRow {
  id: number; listing_id: string; version: string | null; reporter: number; reason: string; text: string;
  state: string; moderator: number | null; action: string | null; created_at: number; decided_at: number | null;
}

const view = (r: ReportRow) => ({
  id: r.id, listing_id: r.listing_id, version: r.version, reporter: r.reporter, reason: r.reason, text: r.text,
  state: r.state, action: r.action, created_at: r.created_at, decided_at: r.decided_at,
});

export async function postReport(ctx: Ctx): Promise<Response> {
  sameOrigin(ctx.req, ctx.env);
  const s = await requireSession(ctx);
  const age = now() - (s.person.gh_created ?? s.person.first_seen);
  if (age < MIN_ACCOUNT_AGE) fail(403, "account-too-new", "Reports need a GitHub account at least 7 days old.");
  await limit(ctx.env, RULES.reports, s.person.github_id);
  const b = await readJson(ctx.req);
  const listing = str(b.listing_id, "listing_id", 128).toLowerCase();
  if (!validId(listing)) fail(404, "no-listing", "There is no listing with that id.");
  const reason = str(b.reason, "reason", 32) as (typeof REASONS)[number];
  if (!REASONS.includes(reason)) fail(400, "bad-reason", `reason is one of ${REASONS.join(", ")}.`);
  const text = str(b.text, "text", 2000);
  const version = b.version === undefined || b.version === null ? null : str(b.version, "version", 64);
  const db = ctx.env.DB;
  if (!(await db.prepare("SELECT 1 FROM listings WHERE id = ?").bind(listing).first())) {
    fail(404, "no-listing", "There is no listing with that id.");
  }
  const res = await db.prepare(
    "INSERT INTO reports (listing_id, version, reporter, reason, text, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
  ).bind(listing, version, s.person.github_id, reason, text, now()).first<{ id: number }>();
  await audit(db, "person", null, "report.open", `report:${res!.id}`, { listing, reason }).run(); // reporter not in the log
  const row = await db.prepare("SELECT * FROM reports WHERE id = ?").bind(res!.id).first<ReportRow>();
  return json({ report: view(row!) }, 201);
}

export async function getReport(ctx: Ctx, id: string): Promise<Response> {
  const s = await requireSession(ctx);
  const n = /^[1-9][0-9]{0,15}$/.test(id) ? Number(id) : 0;
  const r = n ? await ctx.env.DB.prepare("SELECT * FROM reports WHERE id = ?").bind(n).first<ReportRow>() : null;
  const may = r && (r.reporter === s.person.github_id || s.person.role === "moderator");
  if (!may) fail(404, "no-report", "There is no report with that number that you can see.");
  return json({ report: view(r!) });
}
