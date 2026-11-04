-- SPDX-License-Identifier: GPL-2.0-or-later
-- Migration 0004: withdrawn versions (feeding the pipeline's withdrawn-version revocation) and the terms a certificate
-- request was made under. Only adds.

-- The Trust Terms and the Certificate Terms (version and SHA-256 of each) accepted with the request, JSON.
ALTER TABLE cert_requests ADD COLUMN terms TEXT;

-- An admin withdrew one version: its file certificate (the release statement) goes on the revocation list with reason
-- withdrawn-version. The ca job fetches it as a revoke request file (requests/<id>.json) and reports it done.
CREATE TABLE version_withdrawals (
  id             TEXT PRIMARY KEY,       -- v-<hex>, like the revocations
  listing_id     TEXT NOT NULL,
  version        TEXT NOT NULL,
  serial         TEXT NOT NULL,          -- the file certificate's serial
  reason         TEXT NOT NULL,          -- the admin's words
  status         TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','done')),
  requested_by   INTEGER NOT NULL REFERENCES persons (github_id),
  approvers      TEXT NOT NULL,          -- JSON list of admin logins
  dispatched_at  INTEGER,
  dispatch_error TEXT,
  done_at        INTEGER,
  created_at     INTEGER NOT NULL,
  UNIQUE (listing_id, version),
  FOREIGN KEY (listing_id, version) REFERENCES releases (listing_id, version)
);
