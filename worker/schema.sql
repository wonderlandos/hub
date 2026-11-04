-- SPDX-License-Identifier: GPL-2.0-or-later
-- WolOS Hub, D1 schema (I5). The cumulative schema: every file in migrations/
-- applied in order must give exactly these tables (test/schema.test.ts).
-- Migrations only add: new tables, new columns with defaults, new indexes.
-- Times are Unix seconds. GitHub ids are numeric and never reused; logins can change.

-- A person who signed in with GitHub.
CREATE TABLE persons (
  github_id      INTEGER PRIMARY KEY,
  login          TEXT NOT NULL,
  name           TEXT,
  avatar         TEXT,
  gh_created     INTEGER,               -- GitHub account creation time
  two_factor     INTEGER,               -- 1, 0, or NULL when GitHub did not say
  role           TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','moderator','ca-operator')),
  sessions_after INTEGER NOT NULL DEFAULT 0, -- sessions issued before this are void (sign out, ban)
  banned_at      INTEGER,
  first_seen     INTEGER NOT NULL,
  last_seen      INTEGER NOT NULL
);
CREATE INDEX persons_login ON persons (login);

-- A GitHub organisation linked to the hub by one of its owners.
CREATE TABLE orgs (
  github_org_id INTEGER PRIMARY KEY,
  login         TEXT NOT NULL,
  name          TEXT,
  avatar        TEXT,
  linked_by     INTEGER NOT NULL REFERENCES persons (github_id),
  linked_at     INTEGER NOT NULL
);
CREATE INDEX orgs_login ON orgs (login);

-- Organisation roles as GitHub reported them at synced_at. A cache, never the authority:
-- gated actions ask GitHub again.
CREATE TABLE memberships (
  github_org_id INTEGER NOT NULL,
  github_id     INTEGER NOT NULL REFERENCES persons (github_id),
  org_login     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','member')),
  synced_at     INTEGER NOT NULL,
  PRIMARY KEY (github_org_id, github_id)
);
CREATE INDEX memberships_person ON memberships (github_id);

-- Every CLA acceptance, for a person or for an organisation. No IP address is stored.
CREATE TABLE cla_acceptances (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('person','org')),
  subject_id   INTEGER NOT NULL,
  version      TEXT NOT NULL,
  sha256       TEXT NOT NULL,           -- of the CLA text accepted
  accepted_by  INTEGER NOT NULL REFERENCES persons (github_id),
  accepted_at  INTEGER NOT NULL,
  UNIQUE (subject_kind, subject_id, version)
);

-- An app, plugin or extension, bound to one GitHub repository its owner owns.
CREATE TABLE listings (
  id         TEXT PRIMARY KEY,           -- the app or plugin id, inside the owner's namespace
  kind       TEXT NOT NULL CHECK (kind IN ('app','plugin','extension')),
  host       TEXT,                       -- extensions: the app id it extends
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('person','org','wolos')),
  owner_id   INTEGER NOT NULL,
  repo_id    INTEGER NOT NULL,           -- numeric, survives renames
  repo       TEXT NOT NULL,              -- owner/name as last seen
  asset      TEXT NOT NULL,              -- release asset name; one '*' allowed (e.g. 'alice.notes-*.wol')
  name       TEXT NOT NULL,
  summary    TEXT NOT NULL,
  license    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','checking','listed','withdrawn')),
  created_by INTEGER NOT NULL REFERENCES persons (github_id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX listings_repo ON listings (repo_id);
CREATE INDEX listings_owner ON listings (owner_kind, owner_id);

-- A published GitHub release of a listing. The release pointer is tag + asset name + sha256;
-- sha256 and size are filled in by the check pipeline, never by the Worker.
CREATE TABLE releases (
  listing_id  TEXT NOT NULL REFERENCES listings (id),
  version     TEXT NOT NULL,
  tag         TEXT NOT NULL,
  commit_sha  TEXT,
  asset_name  TEXT NOT NULL,
  asset_url   TEXT NOT NULL,
  size        INTEGER,                   -- as GitHub reported it; the pipeline confirms
  sha256      TEXT,
  trust       TEXT NOT NULL DEFAULT 'community' CHECK (trust IN ('wolos','verified','community')),
  verdict     TEXT NOT NULL DEFAULT 'pending' CHECK (verdict IN ('pending','pass','flag','block','not-checked')),
  prerelease  INTEGER NOT NULL DEFAULT 0,
  first_seen  INTEGER NOT NULL,
  checked_at  INTEGER,
  yanked_at   INTEGER,
  PRIMARY KEY (listing_id, version)
);
CREATE INDEX releases_verdict ON releases (verdict);

-- Every verdict the check pipeline posted (a log; releases.verdict holds the latest).
CREATE TABLE verdicts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  TEXT NOT NULL,
  version     TEXT NOT NULL,
  verdict     TEXT NOT NULL CHECK (verdict IN ('pass','flag','block','not-checked')),
  sha256      TEXT,
  size        INTEGER,
  findings    TEXT NOT NULL DEFAULT '[]', -- JSON [{rule, sentence, evidence}]
  run_id      TEXT,                       -- the Actions run that posted it
  workflow_sha TEXT,
  posted_at   INTEGER NOT NULL,
  UNIQUE (listing_id, version, run_id)
);

-- A report against a listing.
CREATE TABLE reports (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings (id),
  version    TEXT,
  reporter   INTEGER NOT NULL REFERENCES persons (github_id),
  reason     TEXT NOT NULL CHECK (reason IN ('malware','impersonation','broken','license','conduct')),
  text       TEXT NOT NULL,
  state      TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','dismissed','actioned')),
  moderator  INTEGER,
  action     TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX reports_state ON reports (state);

-- Every change of state, with who did it. Published without reporters' ids.
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('person','github','pipeline','system')),
  actor_id   TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  detail     TEXT NOT NULL DEFAULT '{}'
);

-- GitHub webhook delivery ids already handled (idempotency); purged after 30 days.
CREATE TABLE deliveries (
  id      TEXT PRIMARY KEY,
  event   TEXT NOT NULL,
  seen_at INTEGER NOT NULL
);

-- Rate limit counters, one row per key and window; purged daily.
CREATE TABLE rate_counters (
  key    TEXT NOT NULL,
  win    INTEGER NOT NULL,
  count  INTEGER NOT NULL,
  PRIMARY KEY (key, win)
);

-- What the check found inside a release file (hubcheck's report, through the verdict): the
-- plugin kinds and permissions, the WolOS version it needs, and the signature. Shown in the index.
CREATE TABLE release_facts (
  listing_id  TEXT NOT NULL,
  version     TEXT NOT NULL,
  kinds       TEXT,                      -- JSON list; plugins
  permissions TEXT,                      -- JSON list; plugins
  min_wolos   TEXT,
  signature   TEXT CHECK (signature IN ('wolos','verified','community','withdrawn','invalid')),
  cert        TEXT,                      -- serial of the certificate that signed the file
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (listing_id, version),
  FOREIGN KEY (listing_id, version) REFERENCES releases (listing_id, version)
);

-- A listing a hub admin took down after a report. The sign job leaves it out of the index.
CREATE TABLE takedowns (
  listing_id TEXT PRIMARY KEY REFERENCES listings (id),
  report_id  INTEGER REFERENCES reports (id),
  admin      INTEGER NOT NULL REFERENCES persons (github_id),
  note       TEXT,
  at         INTEGER NOT NULL
);

-- A certificate request (ADR 0046): the woltrust request a person sent, as the hub checked it.
-- pending -> approved (a hub admin, never the subject) -> issued (the ca workflow reported it), or refused.
CREATE TABLE cert_requests (
  id             TEXT PRIMARY KEY,       -- r-<hex>; the file is hub-index requests/<id>.json
  kind           TEXT NOT NULL CHECK (kind IN ('person','org')),
  subject_id     INTEGER NOT NULL,       -- GitHub id of the person or the organisation
  login          TEXT NOT NULL,          -- as GitHub said at the request
  requested_by   INTEGER NOT NULL REFERENCES persons (github_id),
  ed25519        TEXT NOT NULL,          -- the new signing key, base64url
  body           TEXT NOT NULL,          -- JSON: the request file without id, verified_at and the approval
  verified_at    INTEGER NOT NULL,       -- when the hub last checked the account with GitHub
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','issued','refused')),
  decided_by     INTEGER REFERENCES persons (github_id),
  decided_login  TEXT,                   -- the admin's login at the decision (approved_by)
  decided_at     INTEGER,
  reason         TEXT,                   -- why it was refused
  dispatched_at  INTEGER,                -- when the ca workflow was started
  dispatch_error TEXT,
  serial         TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX cert_requests_status ON cert_requests (status);
CREATE INDEX cert_requests_subject ON cert_requests (kind, subject_id);

-- Every certificate the Authors CA issued for a hub request, as the ca workflow reported it.
CREATE TABLE certs (
  serial      TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL UNIQUE REFERENCES cert_requests (id),
  kind        TEXT NOT NULL CHECK (kind IN ('person','org')),
  subject_id  INTEGER NOT NULL,
  login       TEXT NOT NULL,
  not_before  INTEGER NOT NULL,
  not_after   INTEGER NOT NULL,
  cert        TEXT NOT NULL,             -- the exact .wolcert text
  run_id      TEXT,
  issued_at   INTEGER NOT NULL
);
CREATE INDEX certs_subject ON certs (kind, subject_id);
CREATE INDEX certs_login ON certs (login);

-- The Publisher Agreement (before the first publish) and the Trust Terms (with every certificate
-- request), accepted by a person. The CLA keeps its own table above.
CREATE TABLE terms_acceptances (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  doc         TEXT NOT NULL CHECK (doc IN ('publisher','trust')),
  github_id   INTEGER NOT NULL REFERENCES persons (github_id),
  version     TEXT NOT NULL,
  sha256      TEXT NOT NULL,             -- of the text accepted
  accepted_at INTEGER NOT NULL,
  UNIQUE (doc, github_id, version)
);
