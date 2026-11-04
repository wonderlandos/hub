// SPDX-License-Identifier: GPL-2.0-or-later
//! The text interface shared by the browser module and the command line: every function takes
//! plain arguments and returns the JSON text of interface I7, so the two print the same bytes.
use crate::rules::{self, Kind};
use crate::trust::{self, StoreFile};
use woltrust::Report;

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
/// (roots, intermediates, revoked lists) as JSON text.
pub fn verify_json(
    bytes: &[u8],
    kind: &str,
    store: &str,
    now: u64,
    first_seen: Option<u64>,
) -> String {
    let Some(k) = Kind::parse(kind) else {
        return kind_problem(kind);
    };
    let s: StoreFile = match serde_json::from_str(store) {
        Ok(s) => s,
        Err(e) => return store_problem(&e.to_string()),
    };
    trust::verify_seen(bytes, k, &s.anchors, &s.revoked, now, first_seen).to_json()
}

/// Rules and signature in one I7 report.
pub fn inspect_json(
    bytes: &[u8],
    kind: &str,
    store: &str,
    now: u64,
    first_seen: Option<u64>,
) -> String {
    let Some(k) = Kind::parse(kind) else {
        return kind_problem(kind);
    };
    let s: StoreFile = match serde_json::from_str(store) {
        Ok(s) => s,
        Err(e) => return store_problem(&e.to_string()),
    };
    trust::inspect(bytes, k, &s.anchors, &s.revoked, now, first_seen).to_json()
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

    /// `verify` against the loaded store, as JSON.
    pub fn verify_json(&self, bytes: &[u8], kind: &str) -> String {
        match Kind::parse(kind) {
            Some(k) => trust::verify_in(bytes, k, &self.store, self.now, None).to_json(),
            None => kind_problem(kind),
        }
    }
}
