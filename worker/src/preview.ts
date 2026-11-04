// SPDX-License-Identifier: GPL-2.0-or-later
// What the sign pipeline will publish: the newest checked, not yanked release of every
// listing that is not withdrawn. Read only; the pipeline signs, the Worker never does.

import type { Ctx } from "./ctx";
import type { Env } from "./env";
import { now } from "./env";
import { json } from "./http";

interface Row {
  id: string; kind: "app" | "plugin" | "extension"; host: string | null; name: string; summary: string; license: string;
  owner_kind: string; owner_id: number; owner_login: string | null; repo: string; repo_id: number;
  version: string; tag: string; commit_sha: string | null; asset_url: string; size: number | null; sha256: string;
  trust: string; verdict: string; first_seen: number; findings: string | null;
}

export const MAX_ENTRIES = 5000;

export async function buildIndex(env: Env) {
  const rows = (await env.DB.prepare(
    `SELECT l.id, l.kind, l.host, l.name, l.summary, l.license, l.owner_kind, l.owner_id, l.repo, l.repo_id,
       CASE l.owner_kind WHEN 'org' THEN o.login WHEN 'person' THEN p.login ELSE 'wonderlandos' END AS owner_login,
       r.version, r.tag, r.commit_sha, r.asset_url, r.size, r.sha256, r.trust, r.verdict, r.first_seen,
       (SELECT v.findings FROM verdicts v WHERE v.listing_id = r.listing_id AND v.version = r.version ORDER BY v.id DESC LIMIT 1) AS findings
     FROM listings l
     JOIN releases r ON r.listing_id = l.id
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
    const entry = {
      id: r.id, name: r.name, version: r.version, summary: r.summary, author: r.owner_login, license: r.license,
      url: r.asset_url, sha256: r.sha256, size: r.size, trust: r.trust, verdict: r.verdict, findings,
      owner: { kind: r.owner_kind, github_id: r.owner_id, login: r.owner_login },
      source: { repo: r.repo, repo_id: r.repo_id, tag: r.tag, commit: r.commit_sha },
      first_seen: r.first_seen, yanked: false,
      ...(r.kind === "extension" ? { host: r.host } : {}),
    };
    (r.kind === "app" ? out.apps : r.kind === "plugin" ? out.plugins : out.extensions).push(entry);
  }
  return { format: 1, preview: true, generated: now(), ...out };
}

export async function getPreview(ctx: Ctx): Promise<Response> {
  return json(await buildIndex(ctx.env), 200, { "cache-control": "public, max-age=60" });
}
