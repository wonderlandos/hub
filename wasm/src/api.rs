// SPDX-License-Identifier: GPL-2.0-or-later
//! The text interface shared by the browser module and the command line: every function takes
//! plain arguments and returns the JSON text of interface I7, so the two print the same bytes.
use crate::report::Report;
use crate::rules::{self, Kind};
use crate::trust::{self, StoreFile};

fn kind_problem(kind: &str) -> String {
    rules::input_problem(
        "input/kind",
        "The kind of file must be app, plugin or extension.",
        kind,
    )
    .to_json()
}

/// `check(bytes, kind)`: the rule analysis as I7 JSON.
pub fn check_json(bytes: &[u8], kind: &str) -> String {
    match Kind::parse(kind) {
        Some(k) => crate::files::check(bytes, k).to_json(),
        None => kind_problem(kind),
    }
}

/// `validate_manifest(text, kind)` as I7 JSON.
pub fn manifest_json(text: &str, kind: &str) -> String {
    match Kind::parse(kind) {
        Some(k) => crate::manifest::validate_manifest(text, k).to_json(),
        None => kind_problem(kind),
    }
}

fn store_problem(why: &str) -> String {
    rules::input_problem("input/store", "The trust store could not be read.", why).to_json()
}

/// `verify(bytes, store, revoked, now)`: the signature as JSON (`Trusted`). `store` is the store file
/// (roots, intermediates, revoked lists) as JSON text; `file_cert` the index entry's file
/// certificate (its text), when the release has one.
pub fn verify_json(
    bytes: &[u8],
    kind: &str,
    store: &str,
    now: u64,
    first_seen: Option<u64>,
    file_cert: Option<&[u8]>,
) -> String {
    let Some(k) = Kind::parse(kind) else {
        return kind_problem(kind);
    };
    let s: StoreFile = match serde_json::from_str(store) {
        Ok(s) => s,
        Err(e) => return store_problem(&e.to_string()),
    };
    let st = trust::store(&s.anchors, &s.revoked, now);
    let t = trust::verify_in(bytes, k, &st, now, first_seen);
    match file_cert {
        Some(fc) => trust::with_file_cert(t, bytes, k, &st, fc),
        None => t,
    }
    .to_json()
}

/// Rules and signature in one I7 report (`file_cert` as in [`verify_json`]).
pub fn inspect_json(
    bytes: &[u8],
    kind: &str,
    store: &str,
    now: u64,
    first_seen: Option<u64>,
    file_cert: Option<&[u8]>,
) -> String {
    let Some(k) = Kind::parse(kind) else {
        return kind_problem(kind);
    };
    let s: StoreFile = match serde_json::from_str(store) {
        Ok(s) => s,
        Err(e) => return store_problem(&e.to_string()),
    };
    let st = trust::store(&s.anchors, &s.revoked, now);
    trust::inspect_in(bytes, k, &st, now, first_seen, file_cert).to_json()
}

/// Replays one test vector of the trust crate (`pki.json` and one vector file as text): empty text
/// when the result is the recorded one, else the difference.
#[cfg(any(feature = "dev", test))]
pub fn replay_vector(pki: &str, vector: &str) -> String {
    let pki: woltrust::vectors::PkiFile = match serde_json::from_str(pki) {
        Ok(p) => p,
        Err(e) => return format!("pki.json: {e}"),
    };
    let v: woltrust::vectors::Vector = match serde_json::from_str(vector) {
        Ok(v) => v,
        Err(e) => return format!("vector: {e}"),
    };
    woltrust::vectors::check(&v, &pki).err().unwrap_or_default()
}

/// Replays one file certificate vector of the trust crate (its text): empty text when the result
/// is the recorded one, else the difference.
#[cfg(any(feature = "dev", test))]
pub fn replay_filecert_vector(vector: &str) -> String {
    match serde_json::from_str::<woltrust::filecert_vectors::FileCertVector>(vector) {
        Ok(v) => woltrust::filecert_vectors::check(&v)
            .err()
            .unwrap_or_default(),
        Err(e) => format!("vector: {e}"),
    }
}

/// The crate version, for the page that shows it.
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

/// The report type, re-exported for callers that parse the JSON back.
pub type ReportOf = Report;

/// A store loaded once, for many files: the JSON of the store file and the time.
pub struct Loaded {
    store: woltrust::Store,
    now: u64,
}

impl Loaded {
    /// Loads the store file (JSON text) at `now`.
    pub fn new(store: &str, now: u64) -> Result<Loaded, String> {
        let s: StoreFile = serde_json::from_str(store).map_err(|e| e.to_string())?;
        Ok(Loaded {
            store: trust::store(&s.anchors, &s.revoked, now),
            now,
        })
    }

    /// `verify` against the loaded store, as JSON (`file_cert` as in [`verify_json`]).
    pub fn verify_json(&self, bytes: &[u8], kind: &str, file_cert: Option<&[u8]>) -> String {
        let Some(k) = Kind::parse(kind) else {
            return kind_problem(kind);
        };
        let t = trust::verify_in(bytes, k, &self.store, self.now, None);
        match file_cert {
            Some(fc) => trust::with_file_cert(t, bytes, k, &self.store, fc),
            None => t,
        }
        .to_json()
    }
}
