// SPDX-License-Identifier: GPL-2.0-or-later
//! The report of interface I7 as hubcheck prints it: the report of the trust crate
//! (`{verdict, findings, trust, cert?, origin?}`) plus `file`, the id and version the manifest
//! gives, so the pipeline can compare them with the listing.
use serde::{Deserialize, Serialize};
use woltrust::{CertInfo, Finding, Origin, Trust, Verdict};

/// What the file says it is, read from its manifest (`Info.json`, `plugin.toml`, `extension.toml`).
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FileId {
    /// The id, when it has the form the system accepts.
    pub id: String,
    /// The version, when it has the form the system accepts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

impl FileId {
    /// The id and version a manifest gave (each empty when absent or malformed); none without an id.
    pub fn of(id: &str, version: &str) -> Option<FileId> {
        (!id.is_empty()).then(|| FileId {
            id: id.to_owned(),
            version: (!version.is_empty()).then(|| version.to_owned()),
        })
    }
}

/// Interface I7.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Report {
    /// The automatic check.
    pub verdict: Verdict,
    /// What it found, plus one trust sentence when the file is not plainly trusted.
    pub findings: Vec<Finding>,
    /// What the signature is worth.
    pub trust: Trust,
    /// The signing certificate, when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cert: Option<CertInfo>,
    /// Where the release comes from, when its signature carries an origin that checked out
    /// (the repository's owner is the certificate's login or organisation).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,
    /// The id and version from the manifest, when it gave an id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<FileId>,
}

impl Report {
    /// JSON text of the report (key order as declared, no spaces).
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}
