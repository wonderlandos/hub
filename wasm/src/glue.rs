// SPDX-License-Identifier: GPL-2.0-or-later
//! The browser and Worker surface (wasm-bindgen). Every function returns the JSON text of the
//! native command, so both print the same bytes. `now` is Unix seconds, passed in: the module has no clock.
use wasm_bindgen::prelude::*;

/// Rule analysis of a file. `kind`: `app`, `plugin` or `extension`.
#[wasm_bindgen]
pub fn check(bytes: &[u8], kind: &str) -> String {
    crate::api::check_json(bytes, kind)
}

/// Rule analysis of a manifest alone (`Info.json`, `plugin.toml`, `extension.toml`).
#[wasm_bindgen]
pub fn validate_manifest(text: &str, kind: &str) -> String {
    crate::api::manifest_json(text, kind)
}

/// The signature of a file against a store (JSON text: roots, intermediates, revoked lists).
/// `file_cert`: the index entry's file certificate (bytes of its text), optional.
#[wasm_bindgen]
pub fn verify(
    bytes: &[u8],
    kind: &str,
    store: &str,
    now: f64,
    file_cert: Option<Vec<u8>>,
) -> String {
    crate::api::verify_json(bytes, kind, store, secs(now), None, file_cert.as_deref())
}

/// A trust store loaded once (the roots' signatures are checked then), for many files.
#[wasm_bindgen]
pub struct Verifier {
    inner: crate::api::Loaded,
}

#[wasm_bindgen]
impl Verifier {
    /// Loads the store file (JSON text) at `now` (Unix seconds).
    #[wasm_bindgen(constructor)]
    pub fn new(store: &str, now: f64) -> Result<Verifier, JsError> {
        crate::api::Loaded::new(store, secs(now))
            .map(|inner| Verifier { inner })
            .map_err(|e| JsError::new(&e))
    }

    /// The signature of a file against the loaded store, as JSON (`file_cert` optional).
    pub fn verify(&self, bytes: &[u8], kind: &str, file_cert: Option<Vec<u8>>) -> String {
        self.inner.verify_json(bytes, kind, file_cert.as_deref())
    }
}

/// Rules and signature in one report (`file_cert` optional, as in `verify`).
#[wasm_bindgen]
pub fn inspect(
    bytes: &[u8],
    kind: &str,
    store: &str,
    now: f64,
    file_cert: Option<Vec<u8>>,
) -> String {
    crate::api::inspect_json(bytes, kind, store, secs(now), None, file_cert.as_deref())
}

/// Replays one vector of the trust crate: empty text when it matches the recorded result.
#[cfg(feature = "dev")]
#[wasm_bindgen]
pub fn replay_vector(pki: &str, vector: &str) -> String {
    crate::api::replay_vector(pki, vector)
}

/// Replays one file certificate vector: empty text when it matches the recorded result.
#[cfg(feature = "dev")]
#[wasm_bindgen]
pub fn replay_filecert_vector(vector: &str) -> String {
    crate::api::replay_filecert_vector(vector)
}

/// The module version.
#[wasm_bindgen]
pub fn version() -> String {
    crate::api::version()
}

fn secs(now: f64) -> u64 {
    if now.is_finite() && now >= 0.0 {
        now as u64
    } else {
        0
    }
}
