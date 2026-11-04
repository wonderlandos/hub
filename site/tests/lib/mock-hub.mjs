// SPDX-License-Identifier: GPL-2.0-or-later
// A mocked Worker for the browser tests: just enough of the hub's routes, with state the test moves along (sign-in,
// agreements, installation, the listing, the stages of a version, the admin queue). Every answer waits `latency` ms, so a
// page that asks six times in a row is slower than one that asks once. Nothing here is shown to a visitor.
export function mockHub({ latency = 0 } = {}) {
  const T = 1793577600;
  const S = {
    in: false, calls: [], latency,
    accepted: { cla: false, publisher: false },
    installed: false, repos: [], listings: [], versions: {}, intake: {},
    admin: { revocations: [], requests: [{ id: "r-1", kind: "person", tier: "origin", status: "pending", subject: { login: "dave", name: "Dave Roe" }, namespaces: ["dave."], created_at: T }], attention: [], done: [] },
  };
  const ME = () => ({ github_id: 5310001, login: "alicedoe", name: "Alice Doe", avatar: null, role: "member", admin: true, admin_role: "owner", two_factor: true,
    cla: { current: "1", accepted: S.accepted.cla ? "1" : null, ok: S.accepted.cla }, terms: { publisher: { current: "1", accepted: S.accepted.publisher ? "1" : null, ok: S.accepted.publisher }, trust: { current: "1", accepted: null, ok: false } },
    certs: { origin: "none", trusted: "none" }, orgs: [] });
  const STAGES = (st) => ["received", "checked", "signed", "published"].map((key, i) => ({ key, state: st[i], at: st[i] === "done" ? T + i * 60 : null }));
  const HEAD = {
    "waiting-release": { title: "Waiting for your release", sentence: "The hub saw the tag v1.0.0 on alicedoe/notes. A version is received when you publish a release for that tag with a file named alicedoe.notes-*.wol attached.", fix: "On GitHub, publish a release for v1.0.0 and attach alicedoe.notes-1.0.0.wol." },
    "no-asset": { title: "No file found in the release", sentence: "The release v1.0.0 has no file named alicedoe.notes-*.wol.", fix: "Attach the file to the release on GitHub, then press Check again." },
    checking: { title: "Being checked", sentence: "The hub has your file and is checking it. This usually takes about fifteen minutes.", fix: null },
    signing: { title: "Checked, waiting to be signed", sentence: "The check is done. The hub signs and lists new versions every hour.", fix: null },
    published: { title: "Published", sentence: "Notes 1.0.0 is listed on the hub and offered to install.", fix: null },
    blocked: { title: "Not listed", sentence: "The check found something that stops this version from being listed.", fix: "Fix the points below, then publish a new version with a new tag. A version that was checked is never replaced." },
  };
  const PHASES = {
    "waiting-release": [["waiting", "waiting", "waiting", "waiting"], "working"], "no-asset": [["failed", "skipped", "skipped", "skipped"], "failed"],
    checking: [["done", "current", "waiting", "waiting"], "working"], signing: [["done", "done", "current", "waiting"], "working"],
    published: [["done", "done", "done", "done"], "published"], blocked: [["done", "failed", "skipped", "skipped"], "failed"],
  };
  const statusBody = (v) => {
    const code = S.versions[v] || "waiting-release"; const [st, outcome] = PHASES[code];
    return { listing: { id: "alicedoe.notes", name: "Notes", kind: "app", repo: "alicedoe/notes", asset: "alicedoe.notes-*.wol", owner: { kind: "person", login: "alicedoe" } },
      version: v, tag: "v" + v, prerelease: false, stages: STAGES(st), outcome, headline: { code, ...HEAD[code] },
      findings: code === "blocked" ? [{ rule: "pkg/wide", sentence: "The package asks to read all your files.", fix: null }] : [],
      file: code === "waiting-release" || code === "no-asset" ? null : { name: `alicedoe.notes-${v}.wol`, url: "https://example.invalid/f", size: 2400000, sha256: "9f".repeat(32) },
      signature: code === "published" ? { statement: { serial: "3f2a91bc3f2a91bc", url: "/x", at: T + 200, sentence: "Signed by WolOS Hub (statement 3f2a91bc)." }, author: { trust: "community", sentence: "Your own signature: none. This version shows as Community: nobody vouches for who made it." } } : null,
      listed_path: code === "published" ? "/apps/alicedoe.notes/" : null, poll: outcome === "working" ? 5 : null, can: { recheck: outcome !== "published" }, since: T };
  };
  const overview = (as) => {
    const ls = S.listings.map((l) => ({ ...l, versions: Object.keys(S.versions).map((v) => {
      const b = statusBody(v);
      return { version: v, tag: "v" + v, first_seen: T, checked_at: T, prerelease: false, trust: "community", stages: b.stages, outcome: b.outcome, headline: { code: b.headline.code, title: b.headline.title }, findings: b.findings };
    }) }));
    const att = [];
    for (const [v, code] of Object.entries(S.versions)) if (code === "blocked") att.push({ level: "bad", text: `Notes ${v} was not listed.`, href: `/status?l=alicedoe.notes&v=${v}` });
    return { me: ME(), account: { kind: "person", login: "alicedoe", id: 5310001, role: "owner" }, accounts: [{ kind: "person", login: "alicedoe", role: "owner" }],
      listings: ls, attention: att, reports: [], certs: { states: { origin: "none", trusted: "none" }, refused: {}, list: [] },
      agreements: [{ doc: "cla", name: "Contributor Licence Agreement", url: "/terms/cla", current: "1", ok: S.accepted.cla, per_request: false, accepted: S.accepted.cla ? [{ version: "1", sha256: "ab".repeat(32), accepted_at: T, by: "alicedoe" }] : [] }],
      members: [], generated: T };
  };
  const text = { cla: "Contributor Licence Agreement. Version 1, effective 2026-11-04. You keep your work.", publisher: "Publisher Agreement. Version 1, effective 2026-11-04. Your code stays yours.", trust: "Trust Terms. Version 1, effective 2026-11-04." };
  const handler = (req, res, url) => {
    const p = url.pathname; S.calls.push(req.method + " " + p + url.search);
    const send = (code, body, headers = {}) => setTimeout(() => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(body === null ? "" : JSON.stringify(body)); }, S.latency);
    let data = ""; req.on("data", (c) => (data += c));
    req.on("end", () => {
      const body = data ? JSON.parse(data) : {};
      if (p === "/auth/login") { S.in = true; res.writeHead(302, { location: url.searchParams.get("next") || "/" }); return res.end(); }
      if (p === "/auth/logout") { S.in = false; return send(200, { signed_in: false }); }
      const need = () => (S.in ? false : (send(401, { error: "signed-out", sentence: "Sign in with GitHub first." }), true));
      if (p === "/api/me") return need() || send(200, ME());
      if (p === "/api/my/overview") return need() || send(200, overview(url.searchParams.get("as")));
      let m;
      if ((m = p.match(/^\/api\/terms\/(\w+)$/))) {
        if (req.method === "POST") { if (need()) return; S.accepted[m[1]] = true; return send(200, { terms: {} }); }
        return send(200, { doc: m[1], version: "1", text: text[m[1]], sha256: "ab".repeat(32) });
      }
      if (p === "/api/repos") return need() || send(200, { installed: S.installed, repos: S.repos });
      if (p === "/api/listings" && req.method === "POST") {
        if (need()) return;
        if (!body.license) return send(400, { error: "bad-license", sentence: "Give the licence as an SPDX expression, like GPL-2.0-or-later." });
        const l = { id: body.id, name: body.name, summary: body.summary, kind: body.kind, host: null, repo: body.repo, asset: body.asset, license: body.license, status: "draft", created_at: T };
        S.listings.push(l); S.repos.forEach((r) => { if (r.full_name === body.repo) { r.connected = l.id; r.note = "connected"; } });
        S.posted = body; return send(201, { ...l, source: { repo: body.repo, asset: body.asset } });
      }
      if ((m = p.match(/^\/api\/listings\/([^/]+)\/versions\/([^/]+)\/status$/))) {
        const v = m[2].replace(/^v/, "");
        if (!S.versions[v] && !S.intake[v]) return send(404, { error: "no-version", sentence: "The hub has no version or tag with that name for this listing." });
        return send(200, statusBody(v));
      }
      if ((m = p.match(/^\/api\/listings\/([^/]+)\/recheck$/))) { S.rechecked = body.tag; S.versions[body.tag.replace(/^v/, "")] = "checking"; return send(200, { outcome: "pending" }); }
      if (p === "/api/admin/queue") return send(200, { role: "owner", can: ["request.approve", "request.refuse", "release.flag", "release.withdraw", "report.resolve", "cert.revoke", "audit.read", "users.read", "users.ban", "sessions.revoke", "listings.manage", "health.read"],
        session: { fresh_for: 700, step_up_after: 900, session: "abcdef012345", auth_at: T }, requests: S.admin.requests, attention: S.admin.attention, revocations: S.admin.revocations, reports: [], withdrawals: [] });
      // The second script's tabs (admin-more.js): people, the trail, health.
      if (p === "/api/admin/users") return send(200, { users: url.searchParams.get("q") === "mal" ? [{ github_id: 5310009, login: "mallory", name: "Mal Lory", two_factor: true, banned: false, sessions: 2, listings: 1, role: null, first_seen: T, last_seen: T }] : [] });
      if (p === "/api/admin/users/5310009") return send(200, { user: { github_id: 5310009, login: "mallory", name: "Mal Lory", two_factor: true, banned: false, sessions: 2, listings: 1, role: null, first_seen: T, last_seen: T },
        sessions: [{ ref: "0123456789ab", browser: "Firefox on Linux", place: "198.51.100.0/24", colo: "GRU", signed_in_at: T, last_seen: T, account: null, admin: false, moved: false, current: false },
          { ref: "ba9876543210", browser: "Chrome on Android", place: "198.18.77.0/24", colo: null, signed_in_at: T, last_seen: T, account: null, admin: false, moved: true, moved_to: "203.0.113.0/24, Safari on Mac", current: false }],
        listings: [{ id: "mallory.tool", kind: "app", name: "Tool", status: "listed", repo: "mallory/tool", created_at: T }], actions: [{ id: 9, at: T, action: "sign-in", target: "person:5310009", result: "ok" }], ban_reason: null });
      if ((m = p.match(/^\/api\/admin\/users\/(\d+)\/(ban|unban|sessions\/revoke)$/))) { S.admin.done.push([m[2], m[1], body]); return send(200, { sentence: m[2] === "ban" ? "mallory is banned. Their sessions ended." : "Done." }); }
      if (p === "/api/admin/audit") return send(200, { entries: [{ id: 3, at: T, actor_kind: "person", actor_id: "5310001", actor_login: "alicedoe", action: "role.set", target: "person:5310009", detail: { reason: "helps", to: "support" }, session: "abcdef012345", ip_prefix: "198.51.100.0/24", colo: "GRU", before: null, after: null, result: "ok" },
        { id: 2, at: T - 60, actor_kind: "person", actor_id: "5310009", actor_login: "mallory", action: "session.moved", target: "person:5310009", detail: { from: "198.51.100.0/24, Firefox on Linux", to: "203.0.113.0/24, Safari on Mac" }, session: "ba9876543210", ip_prefix: "203.0.113.0/24", colo: null, before: null, after: null, result: "flagged" }].filter((e) => !url.searchParams.get("action") || e.action.startsWith(url.searchParams.get("action"))), next: null });
      if (p === "/api/admin/health") return send(200, { generated: T, sessions: { n: 3, moved: 1, admin: 1, moved_7d: 1 }, rate_limits: [{ rule: "sign-in", hits: 12, keys: 4 }], errors_7d: 0, errors_on: true, webhooks: [], intake: [], audit_24h: [{ action: "sign-in", n: 3, not_ok: 0 }] });
      if ((m = p.match(/^\/api\/admin\/requests\/([^/]+)\/(approve|refuse)$/))) { S.admin.done.push([m[2], m[1], body]); return send(200, { sentence: m[2] === "approve" ? "Approved. The certificate is being issued now." : "Refused." }); }
      if ((m = p.match(/^\/api\/admin\/releases\/([^/]+)\/([^/]+)\/(flag|withdraw)$/))) { S.admin.done.push([m[3], m[1], m[2], body]); return send(200, { sentence: "Done." }); }
      if ((m = p.match(/^\/api\/admin\/revocations\/([^/]+)\/approve$/))) { S.admin.done.push(["second", m[1], body]); return send(200, { sentence: "Approved. The revocation starts now." }); }
      if (p === "/api/debug/errors") return send(404, { error: "not-found", sentence: "There is nothing at this address." });
      send(404, { error: "not-found", sentence: "There is nothing at this address." });
    });
  };
  return { S, handler, T };
}
