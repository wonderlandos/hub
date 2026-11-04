// SPDX-License-Identifier: GPL-2.0-or-later
// What the sign pipeline will publish: the newest checked, not yanked release of every
// listing that is not withdrawn. Read only; the pipeline signs, the Worker never does.
// Entries keep today's 0.12 fields and gain, when the check reported them: kinds and permissions
// (plugins only, as 0.12 reads them), min_wolos, and cert (the signing certificate's serial, for
// trust wolos, trusted or origin; trust comes from hubcheck's report, pipeline.ts indexTrust), and the store page's
// description, icon and screenshots from the package (release_meta; name and summary: the author's override, else the
// package's, else the registered ones). A release a reviewer flagged shows verdict flag with the reason as its first
// finding. Withdrawn listings (taken down, or their repository changed hands) are left out of the lists and named in
// "withdrawn", so the sign job can mark them.

import type { Ctx } from "./ctx";
import type { Env } from "./env";
import { now } from "./env";
import { json } from "./http";
import { indexTrust } from "./pipeline";
import { pictureView, shown } from "./listings";
import type { Picture } from "./pipeline";

interface Row {
  id: string; kind: "app" | "plugin" | "extension"; host: string | null; name: string; summary: string; license: string;
  owner_kind: string; owner_id: number; owner_login: string | null; repo: string; repo_id: number;
  version: string; tag: string; commit_sha: string | null; asset_url: string; size: number | null; sha256: string;
  trust: string; verdict: string; first_seen: number; findings: string | null;
  kinds: string | null; permissions: string | null; min_wolos: string | null; cert: string | null; signature: string | null;
  flag_reason: string | null; o_name: string | null; o_summary: string | null; has_override: number | null;
  m_name: string | null; m_summary: string | null; m_description: string | null; m_icon: string | null; m_screenshots: string | null;
  version_withdrawn: number | null;
}
interface WithdrawnRow { id: string; kind: string; at: number; reason: string | null }

const list = (j: string | null): string[] | undefined => {
  if (j === null) return undefined;
  try { const v = JSON.parse(j); return Array.isArray(v) ? v : undefined; } catch { return undefined; }
};

const obj = (j: string | null): Record<string, unknown> | undefined => {
  if (j === null) return undefined;
  try { const v = JSON.parse(j); return v && typeof v === "object" && !Array.isArray(v) ? v : undefined; } catch { return undefined; }
};
const arr = (j: string | null): unknown[] | undefined => {
  if (j === null) return undefined;
  try { const v = JSON.parse(j); return Array.isArray(v) ? v : undefined; } catch { return undefined; }
};

export const MAX_ENTRIES = 5000;

export async function buildIndex(env: Env) {
  const rows = (await env.DB.prepare(
    `SELECT l.id, l.kind, l.host, l.name, l.summary, l.license, l.owner_kind, l.owner_id, l.repo, l.repo_id,
       CASE l.owner_kind WHEN 'org' THEN o.login WHEN 'person' THEN p.login ELSE 'wonderlandos' END AS owner_login,
       r.version, r.tag, r.commit_sha, r.asset_url, r.size, r.sha256, r.trust, r.verdict, r.first_seen,
       (SELECT v.findings FROM verdicts v WHERE v.listing_id = r.listing_id AND v.version = r.version ORDER BY v.id DESC LIMIT 1) AS findings,
       f.kinds, f.permissions, f.min_wolos, f.cert, f.signature, g.reason AS flag_reason,
       ov.name AS o_name, ov.summary AS o_summary, (ov.listing_id IS NOT NULL) AS has_override,
       m.name AS m_name, m.summary AS m_summary, m.description AS m_description, m.icon AS m_icon, m.screenshots AS m_screenshots,
       (SELECT 1 FROM version_withdrawals w WHERE w.listing_id = r.listing_id AND w.version = r.version) AS version_withdrawn
     FROM listings l
     JOIN releases r ON r.listing_id = l.id
     LEFT JOIN release_facts f ON f.listing_id = r.listing_id AND f.version = r.version
     LEFT JOIN release_flags g ON g.listing_id = r.listing_id AND g.version = r.version
     LEFT JOIN release_meta m ON m.listing_id = r.listing_id AND m.version = r.version
     LEFT JOIN listing_overrides ov ON ov.listing_id = l.id
     LEFT JOIN orgs o ON l.owner_kind = 'org' AND o.github_org_id = l.owner_id
     LEFT JOIN persons p ON l.owner_kind = 'person' AND p.github_id = l.owner_id
     WHERE l.status IN ('checking', 'listed') AND r.verdict IN ('pass', 'flag') AND r.yanked_at IS NULL
       AND r.prerelease = 0 AND r.sha256 IS NOT NULL
     ORDER BY l.id, r.first_seen DESC, r.version DESC
     LIMIT ?`,
  ).bind(MAX_ENTRIES * 4).all<Row>()).results;
  const out = { apps: [] as unknown[], plugins: [] as unknown[], extensions: [] as unknown[] };
  let last = "";
  for (const r of rows) {
    if (r.id === last) continue; // newest release per listing only
    last = r.id;
    let findings: unknown[] = [];
    try { findings = JSON.parse(r.findings ?? "[]"); } catch { /* stored by us; never fails */ }
    const verdict = r.flag_reason ? "flag" : r.verdict;
    if (r.flag_reason) findings = [{ rule: "hub/reviewer-flag", sentence: r.flag_reason, evidence: "" }, ...findings];
    const { name, summary } = shown(r, r.has_override ? { name: r.o_name, summary: r.o_summary } : null, { name: r.m_name, summary: r.m_summary });
    const iconRaw = obj(r.m_icon);
    const icon = iconRaw ? pictureView(iconRaw as unknown as Picture) : undefined;
    const screenshots = arr(r.m_screenshots)?.map((p) => pictureView(p as Picture));
    const kinds = r.kind === "plugin" ? list(r.kinds) : undefined;
    const permissions = r.kind === "plugin" ? list(r.permissions) : undefined;
    const trust = indexTrust(r.signature, r.trust);
    const signed = r.cert && trust !== "community" ? r.cert : undefined;
    const entry = {
      id: r.id, name, version: r.version, summary, author: r.owner_login, license: r.license,
      ...(kinds ? { kinds } : {}), ...(permissions ? { permissions } : {}), ...(r.min_wolos ? { min_wolos: r.min_wolos } : {}),
      url: r.asset_url, sha256: r.sha256, size: r.size, trust, ...(signed ? { cert: signed } : {}), verdict, findings,
      owner: { kind: r.owner_kind, github_id: r.owner_id, login: r.owner_login },
      source: { repo: r.repo, repo_id: r.repo_id, tag: r.tag, commit: r.commit_sha },
      first_seen: r.first_seen, yanked: false,
      ...(r.kind === "extension" ? { host: r.host } : {}),
      // A version the hub withdrew (index.schema.json "withdrawn": true): shown, never installed.
      ...(r.version_withdrawn ? { withdrawn: true } : {}),
      ...(r.m_description ? { description: r.m_description } : {}), ...(icon ? { icon } : {}), ...(screenshots?.length ? { screenshots } : {}),
    };
    (r.kind === "app" ? out.apps : r.kind === "plugin" ? out.plugins : out.extensions).push(entry);
  }
  const withdrawn = (await env.DB.prepare(
    `SELECT l.id, l.kind, coalesce(t.at, l.updated_at) AS at, CASE WHEN t.listing_id IS NULL THEN 'transferred' ELSE 'takedown' END AS reason
     FROM listings l LEFT JOIN takedowns t ON t.listing_id = l.id
     WHERE l.status = 'withdrawn' AND EXISTS (SELECT 1 FROM releases r WHERE r.listing_id = l.id AND r.verdict IN ('pass', 'flag'))
     ORDER BY l.id LIMIT ?`,
  ).bind(MAX_ENTRIES).all<WithdrawnRow>()).results;
  return { format: 1, preview: true, generated: now(), ...out, withdrawn };
}

export async function getPreview(ctx: Ctx): Promise<Response> {
  return json(await buildIndex(ctx.env), 200, { "cache-control": "public, max-age=60" });
}
