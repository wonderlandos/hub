-- SPDX-License-Identifier: GPL-2.0-or-later
-- Migration 0002: release facts from the check, takedowns, certificate requests, certificates, terms acceptances. Only adds.

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
