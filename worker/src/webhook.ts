// SPDX-License-Identifier: GPL-2.0-or-later
// GitHub App webhooks: signature-verified, idempotent by delivery id and by (listing, version).
// The Worker records where a release's file is; it never downloads or hashes it.

import type { Ctx } from "./ctx";
import { now } from "./env";
import { same, webhookSignature } from "./crypto";
import { fail, HttpError, json, LIMITS, readBody } from "./http";
import { limit, RULES } from "./ratelimit";
import { assetMatches, type ListingRow } from "./listings";
import { audit } from "./audit";
import { log } from "./log";

const DELIVERY = /^[0-9a-fA-F-]{8,64}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;

interface Asset { name: string; browser_download_url: string; size: number; state?: string }
interface ReleasePayload {
  action: string;
  release?: { tag_name: string; draft: boolean; prerelease: boolean; assets?: Asset[] };
  repository?: { id: number; full_name: string; owner?: { id: number; login: string } };
  changes?: unknown;
}

export const versionOf = (tag: string) => tag.replace(/^v(?=\d)/, "");

export async function webhook(ctx: Ctx): Promise<Response> {
  const raw = await readBody(ctx.req, LIMITS.webhook);
  const sig = ctx.req.headers.get("x-hub-signature-256") ?? "";
  if (!sig || !same(sig, await webhookSignature(ctx.env.WEBHOOK_SECRET, raw))) {
    fail(401, "bad-signature", "The webhook signature does not match.");
  }
  const delivery = ctx.req.headers.get("x-github-delivery") ?? "";
  const event = ctx.req.headers.get("x-github-event") ?? "";
  if (!DELIVERY.test(delivery) || !/^[a-z_]{1,64}$/.test(event)) fail(400, "bad-delivery", "Missing delivery id or event name.");
  const db = ctx.env.DB;
  if (await db.prepare("SELECT 1 FROM deliveries WHERE id = ?").bind(delivery).first()) {
    return json({ ok: true, duplicate: true });
  }
  let p: ReleasePayload;
  try {
    p = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return fail(400, "bad-json", "The webhook body is not JSON.");
  }
  const seen = db.prepare("INSERT OR IGNORE INTO deliveries (id, event, seen_at) VALUES (?, ?, ?)").bind(delivery, event, now());
  const stmts: D1PreparedStatement[] = [];
  const outcome: Record<string, string> = {};

  if (event === "release" && p.release && p.repository && (p.action === "published" || p.action === "deleted")) {
    const listings = (await db.prepare("SELECT * FROM listings WHERE repo_id = ? AND status != 'withdrawn'")
      .bind(p.repository.id).all<ListingRow>()).results;
    const rel = p.release;
    const version = versionOf(rel.tag_name);
    for (const l of listings) {
      if (p.action === "deleted") {
        stmts.push(db.prepare("UPDATE releases SET yanked_at = ? WHERE listing_id = ? AND tag = ? AND yanked_at IS NULL").bind(now(), l.id, rel.tag_name));
        stmts.push(audit(db, "github", delivery, "release.deleted", `listing:${l.id}`, { tag: rel.tag_name }));
        outcome[l.id] = "yanked";
        continue;
      }
      if (rel.draft) { outcome[l.id] = "draft"; continue; }
      if (!VERSION.test(version)) {
        stmts.push(audit(db, "github", delivery, "release.bad-tag", `listing:${l.id}`, { tag: rel.tag_name.slice(0, 80) }));
        outcome[l.id] = "bad-tag";
        continue;
      }
      const assets = (rel.assets ?? []).filter((a) => a.state !== "starter" && assetMatches(l.asset, a.name));
      if (assets.length !== 1) {
        const why = assets.length ? "ambiguous-asset" : "no-asset";
        stmts.push(audit(db, "github", delivery, `release.${why}`, `listing:${l.id}`, { tag: rel.tag_name, pattern: l.asset }));
        outcome[l.id] = why;
        continue;
      }
      try {
        await limit(ctx.env, RULES.releases, `${l.owner_kind}:${l.owner_id}`);
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        stmts.push(audit(db, "github", delivery, "release.rate-limited", `listing:${l.id}`, { tag: rel.tag_name }));
        outcome[l.id] = "rate-limited";
        continue;
      }
      const a = assets[0];
      stmts.push(db.prepare(
        "INSERT OR IGNORE INTO releases (listing_id, version, tag, asset_name, asset_url, size, prerelease, first_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(l.id, version, rel.tag_name, a.name, a.browser_download_url, Number.isFinite(a.size) ? a.size : null, rel.prerelease ? 1 : 0, now()));
      stmts.push(db.prepare("UPDATE listings SET status = 'checking', updated_at = ? WHERE id = ? AND status = 'draft'").bind(now(), l.id));
      stmts.push(audit(db, "github", delivery, "release.pending", `listing:${l.id}`, { version, tag: rel.tag_name, asset: a.name }));
      outcome[l.id] = "pending";
    }
  } else if (event === "repository" && p.repository && (p.action === "renamed" || p.action === "transferred")) {
    if (p.action === "renamed") {
      stmts.push(db.prepare("UPDATE listings SET repo = ?, updated_at = ? WHERE repo_id = ?").bind(p.repository.full_name, now(), p.repository.id));
    } else {
      // A repository that changed hands no longer proves who made the listing.
      stmts.push(db.prepare("UPDATE listings SET status = 'withdrawn', updated_at = ? WHERE repo_id = ?").bind(now(), p.repository.id));
    }
    stmts.push(audit(db, "github", delivery, `repository.${p.action}`, `repo:${p.repository.id}`, { repo: p.repository.full_name }));
    outcome.repository = p.action;
  }
  await db.batch([seen, ...stmts]);
  log("webhook", { event, action: p.action, outcome });
  return json({ ok: true, outcome });
}
