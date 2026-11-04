// SPDX-License-Identifier: GPL-2.0-or-later
// The contributor licence agreement. Versioned: a new version must be accepted again
// before the next publish. The text is the lead's; until then a placeholder.

import type { Ctx } from "./ctx";
import type { Env } from "./env";
import { now } from "./env";
import { sha256hex } from "./crypto";
import { fail, json, readJson, sameOrigin, str } from "./http";
import { requireSession } from "./session";
import { audit } from "./audit";

export const CLAS: Record<string, string> = {
  "0-placeholder": "CLA text to come from the lead.",
};

export interface Cla { version: string; text: string; sha256: string }

export async function currentCla(env: Env): Promise<Cla> {
  const version = env.CLA_VERSION ?? "0-placeholder";
  const text = CLAS[version];
  if (text === undefined) throw new Error("CLA_VERSION names no known text");
  return { version, text, sha256: await sha256hex(text) };
}

export interface ClaStatus { current: string; accepted: string | null; accepted_at: number | null; ok: boolean }

export async function claStatus(env: Env, kind: "person" | "org", id: number): Promise<ClaStatus> {
  const cla = await currentCla(env);
  const row = await env.DB.prepare(
    "SELECT version, accepted_at FROM cla_acceptances WHERE subject_kind = ? AND subject_id = ? ORDER BY accepted_at DESC, id DESC LIMIT 1",
  ).bind(kind, id).first<{ version: string; accepted_at: number }>();
  return { current: cla.version, accepted: row?.version ?? null, accepted_at: row?.accepted_at ?? null, ok: row?.version === cla.version };
}

/** Throws unless the subject accepted the current CLA. */
export async function requireCla(env: Env, kind: "person" | "org", id: number): Promise<void> {
  const s = await claStatus(env, kind, id);
  if (!s.ok) {
    fail(403, kind === "person" ? "cla-needed" : "org-cla-needed",
      kind === "person"
        ? `Accept the contributor agreement (version ${s.current}) before you publish.`
        : `An owner of this organisation must accept the contributor agreement (version ${s.current}) first.`);
  }
}

/** Checks that the body names the current version and the hash of its text. */
export async function acceptedBody(env: Env, body: Record<string, unknown>): Promise<Cla> {
  const cla = await currentCla(env);
  const v = str(body.cla_version ?? body.version, "version", 64);
  const h = str(body.cla_sha256 ?? body.sha256, "sha256", 64);
  if (v !== cla.version || h !== cla.sha256) {
    fail(409, "cla-changed", "The contributor agreement changed. Read the current version and accept it again.");
  }
  return cla;
}

export async function getCla(ctx: Ctx): Promise<Response> {
  const cla = await currentCla(ctx.env);
  return json(cla, 200, { "cache-control": "public, max-age=300" });
}

export async function postCla(ctx: Ctx): Promise<Response> {
  sameOrigin(ctx.req, ctx.env);
  const s = await requireSession(ctx);
  const cla = await acceptedBody(ctx.env, await readJson(ctx.req));
  const db = ctx.env.DB;
  await db.batch([
    db.prepare(
      "INSERT OR IGNORE INTO cla_acceptances (subject_kind, subject_id, version, sha256, accepted_by, accepted_at) VALUES ('person', ?, ?, ?, ?, ?)",
    ).bind(s.person.github_id, cla.version, cla.sha256, s.person.github_id, now()),
    audit(db, "person", s.person.github_id, "cla.accept", `person:${s.person.github_id}`, { version: cla.version }),
  ]);
  return json({ cla: await claStatus(ctx.env, "person", s.person.github_id) });
}
