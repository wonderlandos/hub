// SPDX-License-Identifier: GPL-2.0-or-later
//! The signature of a file, through the pure trust crate of ADR 0046 (`woltrust`): the same
//! implementation the system and the browser use, so a verdict here is the verdict there. Nothing
//! is read from disk or the clock; the roots, the intermediates, the revocation lists and the time
//! come in as arguments.
use crate::files::{self, CHAIN, WSIG};
use crate::report::{CertInfo, Class, Report, Trust};
use crate::rules::Kind;
use serde::{Deserialize, Serialize};
use woltrust::{Finding, Input, Origin, Store, Verdict};

/// Pinned roots and known intermediates, as the text of `.wolcert` files.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct Anchors {
    /// Root certificates (the system pins these in `/usr/share/wolos/trust/roots/`).
    #[serde(default)]
    pub roots: Vec<String>,
    /// Intermediates known besides those in the file's own `CHAIN`.
    #[serde(default)]
    pub intermediates: Vec<String>,
    /// Accept the shared TEST root (tests and the vectors only).
    #[serde(default)]
    pub allow_test: bool,
}

/// A revocation list and its signature file, as text.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct RevokedList {
    /// `revoked.json`.
    pub list: String,
    /// `revoked.json.wsig`.
    pub wsig: String,
}

/// The store file the command line and the browser read: anchors and lists in one object.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct StoreFile {
    /// Roots and intermediates.
    #[serde(flatten)]
    pub anchors: Anchors,
    /// Revocation lists.
    #[serde(default)]
    pub revoked: Vec<RevokedList>,
}

/// What a signature is worth, with the sentence that explains it (interface I6, `Trust`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Trusted {
    /// The value of the signature.
    pub trust: Trust,
    /// The stable reason (`ok`, `unsigned`, `expired`, `revoked-abuse`, ...).
    pub code: String,
    /// True when the answer stands on a revocation list past its end.
    pub stale: bool,
    /// `expires` of the newest list held, when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub list_expires: Option<u64>,
    /// The signing certificate, when one was found.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cert: Option<CertInfo>,
    /// Where the release comes from, when the signature carries an origin that checked out
    /// (woltrust checks the repository owner against the certificate: else `origin-mismatch`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<Origin>,
    /// The trust sentence, when the file is not plainly trusted (rule `trust/<code>`).
    pub findings: Vec<Finding>,
}

impl Trusted {
    /// JSON text (key order as declared, no spaces).
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

/// The store of woltrust for these anchors and lists at `now`.
pub fn store(anchors: &Anchors, revoked: &[RevokedList], now: u64) -> Store {
    let lists: Vec<(&[u8], &[u8])> = revoked
        .iter()
        .map(|l| (l.list.as_bytes(), l.wsig.as_bytes()))
        .collect();
    let roots: Vec<&[u8]> = anchors.roots.iter().map(String::as_bytes).collect();
    let mids: Vec<&[u8]> = anchors.intermediates.iter().map(String::as_bytes).collect();
    Store::load(&roots, &mids, &lists, now, anchors.allow_test)
}

/// The id the file's signature must be inside the namespace of: the app id of a `.wol`, the folder of
/// a `.wolplug` or an extension.
pub fn file_id(l: &files::Loaded, kind: Kind) -> Option<String> {
    if kind == Kind::App {
        let info = l.get("Info.json")?;
        let v: serde_json::Value = serde_json::from_slice(info).ok()?;
        return v.get("id")?.as_str().map(str::to_owned);
    }
    let first = l.members.first()?;
    first.name.split('/').next().map(str::to_owned)
}

fn unreadable(trust: Trust, code: &str, f: &files::Refusal) -> Trusted {
    Trusted {
        trust,
        code: code.to_owned(),
        stale: false,
        list_expires: None,
        cert: None,
        origin: None,
        findings: vec![Finding {
            rule: format!("trust/{code}"),
            sentence: if trust == Trust::Invalid {
                "The file is damaged, so its signature cannot be read.".to_owned()
            } else {
                "The file could not be looked at, so nobody vouches for it here.".to_owned()
            },
            evidence: f.evidence.clone(),
        }],
    }
}

/// Checks the signature of `bytes` (a file of `kind`) at `now`. `first_seen` is when the signed index
/// first saw this exact file, when the caller knows (it lets a certificate that has since run out
/// still count).
pub fn verify_seen(
    bytes: &[u8],
    kind: Kind,
    anchors: &Anchors,
    revoked: &[RevokedList],
    now: u64,
    first_seen: Option<u64>,
) -> Trusted {
    verify_in(bytes, kind, &store(anchors, revoked, now), now, first_seen)
}

/// [`verify_seen`] against a store that is already loaded (loading checks the roots' signatures and
/// is most of the cost, so a caller with many files loads it once).
pub fn verify_in(
    bytes: &[u8],
    kind: Kind,
    store: &Store,
    now: u64,
    first_seen: Option<u64>,
) -> Trusted {
    let l = match files::load(bytes, kind) {
        Ok(l) => l,
        Err(f) if f.unchecked => return unreadable(Trust::Community, "not-checked", &f),
        Err(f) => return unreadable(Trust::Invalid, "unreadable", &f),
    };
    let Some(content) = l.get("SHA256") else {
        let f = files::Refusal {
            rule: "file/members",
            sentence: "",
            evidence: "SHA256".to_owned(),
            unchecked: false,
        };
        return unreadable(Trust::Invalid, "unreadable", &f);
    };
    let id = file_id(&l, kind);
    let out = woltrust::verify(
        store,
        &Input {
            purpose: kind.purpose(),
            content,
            app_id: id.as_deref(),
            wsig: l.get(WSIG),
            chain: l.get(CHAIN),
            first_seen,
            now,
        },
    );
    let list_expires = out.list_expires;
    let stale = out.stale;
    let class = out
        .cert
        .as_ref()
        .map(|c| class_of(l.get(CHAIN), store, &c.serial));
    let cert = out.cert.clone().map(|c| CertInfo::of(c, class));
    let origin = out.origin.clone();
    let trust = Trust::of(out.trust, class);
    let code = out.code.as_str().to_owned();
    let report = out.report(Verdict::Pass, Vec::new());
    Trusted {
        trust,
        code,
        stale,
        list_expires,
        cert,
        origin,
        findings: report.findings,
    }
}

/// The class of the certificate `serial`, read from its signed body in the file's `CHAIN` or in the
/// store (`"class"`, absent = `origin`). Read here until woltrust reports it; the pinned woltrust
/// refuses a body with fields it does not know, so with it every signer it accepts is `origin`.
pub fn class_of(chain: Option<&[u8]>, store: &Store, serial: &str) -> Class {
    #[derive(Deserialize)]
    struct Env {
        body: String,
    }
    let from_chain = chain
        .and_then(|c| serde_json::from_slice::<Vec<Env>>(c).ok())
        .into_iter()
        .flatten()
        .take(woltrust::MAX_CHAIN_CERTS)
        .filter_map(|e| woltrust::b64::decode(&e.body, woltrust::MAX_BODY))
        .find(|b| {
            serde_json::from_slice::<serde_json::Value>(b)
                .ok()
                .is_some_and(|v| {
                    v.get("serial").and_then(serde_json::Value::as_str) == Some(serial)
                })
        });
    let body = from_chain.or_else(|| {
        store
            .intermediates
            .iter()
            .chain(store.roots.iter())
            .find(|c| c.body.serial == serial)
            .map(|c| c.body_bytes.clone())
    });
    body.map_or(Class::Origin, |b| Class::of_body(&b))
}

/// [`verify_seen`] without a first-seen time. Interface I6: `verify(bytes, store, revoked, now) -> Trust`.
pub fn verify(
    bytes: &[u8],
    kind: Kind,
    anchors: &Anchors,
    revoked: &[RevokedList],
    now: u64,
) -> Trusted {
    verify_seen(bytes, kind, anchors, revoked, now, None)
}

/// Rules and signature together: the full I7 report the check job commits. The verdict comes from
/// the rules; `trust` and `cert` from the signature. A file whose parts do not match what was
/// signed has `invalid` trust; an id reserved for WolOS that WolOS did not sign is blocked.
pub fn inspect(
    bytes: &[u8],
    kind: Kind,
    anchors: &Anchors,
    revoked: &[RevokedList],
    now: u64,
    first_seen: Option<u64>,
) -> Report {
    let mut rules = files::analyse(bytes, kind);
    let damaged = rules.damaged;
    let mut t = verify_seen(bytes, kind, anchors, revoked, now, first_seen);
    if t.trust == Trust::Wolos && kind != Kind::Plugin {
        rules.forget("manifest/reserved-id");
    } else {
        rules.escalate("manifest/reserved-id");
    }
    if damaged && t.code != "unsigned" && t.trust != Trust::Invalid {
        t.findings.push(Finding {
            rule: "trust/bad-content".to_owned(),
            sentence: "The files in this file do not match the list that was signed, so something was changed after signing.".to_owned(),
            evidence: String::new(),
        });
        t.trust = Trust::Invalid;
        t.origin = None;
    }
    let file = rules.file.take();
    let (verdict, mut findings) = rules.into_findings();
    findings.extend(t.findings);
    Report {
        verdict,
        findings,
        trust: t.trust,
        cert: t.cert,
        origin: t.origin,
        file,
    }
}
