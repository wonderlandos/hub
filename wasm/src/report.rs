// SPDX-License-Identifier: GPL-2.0-or-later
//! The report of interface I7 as hubcheck prints it: the report of the trust crate
//! (`{verdict, findings, trust, cert?, origin?}`) plus `file`, the id and version the manifest
//! gives, so the pipeline can compare them with the listing. Trust and the certificate follow the
//! two certificate classes of the lead's decision (02:18Z, TRUST-core-4 #plan 7293): an `origin`
//! certificate says who made a file, a `trusted` one also vouches for the maker.
use serde::{Deserialize, Serialize};
use woltrust::{Finding, Level, Origin, Verdict};

/// The class of an author's certificate: body field `"class"`, absent = `origin` (TRUST-core-4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Class {
    /// Says who made the file.
    Origin,
    /// Also vouches for the maker (needs its `origin_cert`).
    Trusted,
}

impl Class {
    /// The class named by a certificate body (the exact signed JSON): `trusted` only when the body
    /// says so, anything else is `origin` (the fail-safe default).
    pub fn of_body(body: &[u8]) -> Class {
        let v: Option<serde_json::Value> = serde_json::from_slice(body).ok();
        match v
            .as_ref()
            .and_then(|v| v.get("class"))
            .and_then(serde_json::Value::as_str)
        {
            Some("trusted") => Class::Trusted,
            _ => Class::Origin,
        }
    }
}

/// What the signature is worth: `wolos | trusted | origin | community | withdrawn | invalid`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Trust {
    /// Made by WolOS (Packages CA chain).
    Wolos,
    /// Signed with a `trusted` certificate.
    Trusted,
    /// Signed with an `origin` certificate: the maker is known, nobody vouches beyond that.
    Origin,
    /// Nobody vouches: no signature, an expired certificate or a list too old to rely on.
    Community,
    /// The certificate was withdrawn.
    Withdrawn,
    /// The signature is present and wrong.
    Invalid,
}

impl Trust {
    /// The value for woltrust's verdict and, for an author's certificate, its class (`verified`
    /// becomes `trusted` or `origin`; the other values are the same).
    pub fn of(t: woltrust::Trust, class: Option<Class>) -> Trust {
        match t {
            woltrust::Trust::Wolos => Trust::Wolos,
            woltrust::Trust::Verified if class == Some(Class::Trusted) => Trust::Trusted,
            woltrust::Trust::Verified => Trust::Origin,
            woltrust::Trust::Community => Trust::Community,
            woltrust::Trust::Withdrawn => Trust::Withdrawn,
            woltrust::Trust::Invalid => Trust::Invalid,
        }
    }
}

/// Who signed, as shown: woltrust's certificate info plus `class`.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CertInfo {
    /// Serial of the signing certificate.
    pub serial: String,
    /// GitHub id, login and name (or the label of a WolOS signer), and `org` when there is one.
    pub subject: woltrust::cert::Subject,
    /// How the maker is shown (`wolos` or `verified`).
    pub level: Level,
    /// `origin` or `trusted`; omitted for WolOS signers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class: Option<Class>,
    /// When the hub verified the subject.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verified_at: Option<u64>,
}

impl CertInfo {
    /// woltrust's info with the class of the certificate (none for a WolOS signer).
    pub fn of(c: woltrust::CertInfo, class: Option<Class>) -> CertInfo {
        CertInfo {
            class: if c.level == Level::Wolos { None } else { class },
            serial: c.serial,
            subject: c.subject,
            level: c.level,
            verified_at: c.verified_at,
        }
    }
}

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
