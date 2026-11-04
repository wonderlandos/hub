// SPDX-License-Identifier: GPL-2.0-or-later
//! hubcheck: the rule analysis and the signature check of WolOS Hub (ADR 0047), one crate built
//! twice: as wasm for the browser and the Worker, and as the native command the check job runs.
//! It reads a `.wol`, a `.wolplug` or an extension from bytes and answers with the report of
//! interface I7. Pure: no file, network, clock, process or unsafe code; every input is size-capped
//! before it is read. A clean result means only that no rule broke.
#![forbid(unsafe_code)]

pub mod api;
pub mod doctrine;
pub mod files;
#[cfg(feature = "dev")]
pub mod fixtures;
#[cfg(target_arch = "wasm32")]
mod glue;
pub mod manifest;
pub mod rules;
pub mod tar;
pub mod toml;
pub mod trust;

pub use files::check;
pub use manifest::validate_manifest;
pub use rules::Kind;
pub use trust::{Anchors, RevokedList, StoreFile, Trusted, inspect, verify, verify_seen};
pub use woltrust::{CertInfo, Finding, Report, Trust, Verdict};
