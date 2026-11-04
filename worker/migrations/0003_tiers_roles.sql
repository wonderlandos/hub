-- SPDX-License-Identifier: GPL-2.0-or-later
-- Migration 0003: certificate tiers (origin, trusted), revocations and downgrades, admin roles,
-- reviewer flags, listing metadata from the package, and file certificates. Only adds.

-- Which certificate a request asks for (hub-index request.schema.json "tier"). Requests before this
-- migration all went through an admin: trusted. gates: the origin policy's checks and their values (JSON).
ALTER TABLE cert_requests ADD COLUMN tier TEXT NOT NULL DEFAULT 'trusted' CHECK (tier IN ('origin','trusted'));
ALTER TABLE cert_requests ADD COLUMN gates TEXT;
-- A trusted request names the subject's live origin certificate; the ca job copies it into the trusted certificate.
ALTER TABLE cert_requests ADD COLUMN origin_cert TEXT;
CREATE INDEX cert_requests_tier ON cert_requests (kind, subject_id, tier, created_at);

-- The tier of an issued certificate, and its revocation once the ca job reported it.
ALTER TABLE certs ADD COLUMN tier TEXT NOT NULL DEFAULT 'trusted' CHECK (tier IN ('origin','trusted'));
ALTER TABLE certs ADD COLUMN revoked_at INTEGER;
ALTER TABLE certs ADD COLUMN revoke_reason TEXT;
-- trusted: the origin certificate it builds on.
ALTER TABLE certs ADD COLUMN origin_cert TEXT;

-- When GitHub last said whether the person has two-factor authentication (sign-in, and hourly for admins).
ALTER TABLE persons ADD COLUMN two_factor_checked_at INTEGER;

-- Admin panel roles. Rows granted by 'ADMINS' are the seed from the variable and count only while the login is in it.
CREATE TABLE admin_roles (
  github_id  INTEGER PRIMARY KEY REFERENCES persons (github_id),
  role       TEXT NOT NULL CHECK (role IN ('owner','admin','reviewer','support')),
  granted_by TEXT NOT NULL,              -- GitHub id of the owner who granted it, or 'ADMINS'
  granted_at INTEGER NOT NULL
);

-- A revocation (key-compromise, abuse) or a downgrade (a trusted certificate revoked as superseded) an admin asked
-- for. The ca job fetches it as a revoke request file (requests/<id>.json) and reports it done. grp joins the rows of
-- one action: revoking a subject revokes every active certificate it holds. abuse needs a second admin.
CREATE TABLE revocations (
  id             TEXT PRIMARY KEY,       -- v-<hex>
  grp            TEXT NOT NULL,
  serial         TEXT NOT NULL REFERENCES certs (serial),
  action         TEXT NOT NULL CHECK (action IN ('revoke','downgrade')),
  reason         TEXT NOT NULL CHECK (reason IN ('key-compromise','abuse','superseded')),
  note           TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','done')),
  requested_by   INTEGER NOT NULL REFERENCES persons (github_id),
  approvers      TEXT NOT NULL DEFAULT '[]', -- JSON list of admin logins (approved_by of the request file)
  approved_at    INTEGER,
  dispatched_at  INTEGER,
  dispatch_error TEXT,
  done_at        INTEGER,
  created_at     INTEGER NOT NULL
);
CREATE INDEX revocations_grp ON revocations (grp);
CREATE INDEX revocations_serial ON revocations (serial);

-- A reviewer flagged a release: it stays listed with verdict flag and the reviewer's reason as a finding.
CREATE TABLE release_flags (
  listing_id TEXT NOT NULL,
  version    TEXT NOT NULL,
  reviewer   INTEGER NOT NULL REFERENCES persons (github_id),
  reason     TEXT NOT NULL,
  at         INTEGER NOT NULL,
  PRIMARY KEY (listing_id, version),
  FOREIGN KEY (listing_id, version) REFERENCES releases (listing_id, version)
);

-- What the check read from the package for the store page: name, summary, description, and references (sha256,
-- type, size) to the icon and screenshots the pipeline put on the CDN. No image bytes are kept here.
CREATE TABLE release_meta (
  listing_id  TEXT NOT NULL,
  version     TEXT NOT NULL,
  name        TEXT,
  summary     TEXT,
  description TEXT,
  icon        TEXT,                      -- JSON {sha256, type, width, height, size}
  screenshots TEXT,                      -- JSON list of the same
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (listing_id, version),
  FOREIGN KEY (listing_id, version) REFERENCES releases (listing_id, version)
);

-- The author's own name and summary for a listing (PATCH /api/listings/:id); they win over the package's.
CREATE TABLE listing_overrides (
  listing_id TEXT PRIMARY KEY REFERENCES listings (id),
  name       TEXT,
  summary    TEXT,
  updated_by INTEGER NOT NULL REFERENCES persons (github_id),
  updated_at INTEGER NOT NULL
);

-- The file certificate of a release: the signed statement the sign job made for this version (label wolos/release/1),
-- as the sign job reported it. Shown on each release.
CREATE TABLE file_certificates (
  listing_id TEXT NOT NULL,
  version    TEXT NOT NULL,
  serial     TEXT NOT NULL,
  url        TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  verdict    TEXT NOT NULL CHECK (verdict IN ('pass','flag')),
  run_id     TEXT,
  stored_at  INTEGER NOT NULL,
  PRIMARY KEY (listing_id, version),
  FOREIGN KEY (listing_id, version) REFERENCES releases (listing_id, version)
);
