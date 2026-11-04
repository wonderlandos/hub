// SPDX-License-Identifier: GPL-2.0-or-later
//! A fixture `.wol` in the package format of the OS (format 2 with CHAIN and SHA256.wsig) goes
//! through `verify` and `inspect`, and the I7 JSON has exactly the frozen shape.
use hubcheck::fixtures::{Fixture, Signer};
use hubcheck::{Kind, Trust, Verdict};
use woltrust::revoked::Reason;

fn run(f: &Fixture, bytes: &[u8], kind: Kind, now: u64) -> hubcheck::Trusted {
    let s = f.store();
    hubcheck::verify(bytes, kind, &s.anchors, &s.revoked, now)
}

#[test]
fn a_person_an_organisation_and_wolos_are_told_apart() {
    let f = Fixture::new();
    for (id, who, trust, level) in [
        ("alice.notes", Signer::Alice, Trust::Verified, "verified"),
        ("examplelabs.tool", Signer::Org, Trust::Verified, "verified"),
        ("org.wolos.notes", Signer::Wolos, Trust::Wolos, "wolos"),
    ] {
        let t = run(&f, &f.wol(id, who), Kind::App, f.now);
        assert_eq!((t.trust, t.code.as_str()), (trust, "ok"), "{id}");
        let c = t.cert.expect("cert");
        assert_eq!(serde_json::to_value(c.level).unwrap(), level);
        assert!(t.findings.is_empty());
    }
}

#[test]
fn unsigned_wrong_namespace_expired_revoked_and_tampered() {
    let f = Fixture::new();
    let t = run(&f, &f.wol("alice.notes", Signer::None), Kind::App, f.now);
    assert_eq!((t.trust, t.code.as_str()), (Trust::Community, "unsigned"));
    assert_eq!(t.findings[0].rule, "trust/unsigned");

    let t = run(&f, &f.wol("bob.notes", Signer::Alice), Kind::App, f.now);
    assert_eq!(
        (t.trust, t.code.as_str()),
        (Trust::Invalid, "wrong-namespace")
    );

    // Two years on, the certificate has run out and the list is too old.
    let t = run(
        &f,
        &f.wol("alice.notes", Signer::Alice),
        Kind::App,
        f.now + 800 * 86_400,
    );
    assert_eq!(t.trust, Trust::Community);

    // Revoked for abuse.
    let mut s = f.store();
    s.revoked = vec![f.list(&[(&f.pki.alice.body.serial, Reason::Abuse)])];
    let wol = f.wol("alice.notes", Signer::Alice);
    let t = hubcheck::verify(&wol, Kind::App, &s.anchors, &s.revoked, f.now);
    assert_eq!(
        (t.trust, t.code.as_str()),
        (Trust::Withdrawn, "revoked-abuse")
    );

    // A plugin is signed for plugins: the same bytes read as an app are not.
    let plug = f.plugin("alice.weather", &[("plugin.toml", b"x")], Signer::Alice);
    let as_ext = run(&f, &plug, Kind::Extension, f.now);
    assert_eq!(as_ext.code, "bad-signature");
    assert_eq!(run(&f, &plug, Kind::Plugin, f.now).trust, Trust::Verified);
}

#[test]
fn changing_a_file_after_signing_is_invalid_and_blocked() {
    let f = Fixture::new();
    let wol = f.wol("alice.notes", Signer::Alice);
    let at = wol
        .windows(17)
        .position(|w| w == b"pkg payload bytes")
        .expect("payload in the archive");
    let mut bad = wol.clone();
    bad[at] ^= 1;
    let s = f.store();
    let r = hubcheck::inspect(&bad, Kind::App, &s.anchors, &s.revoked, f.now, None);
    assert_eq!(r.verdict, Verdict::Block);
    assert_eq!(r.trust, Trust::Invalid);
    assert!(
        r.findings
            .iter()
            .any(|x| x.rule == "file/hash" && x.evidence == "payload.pkg")
    );
    assert!(r.findings.iter().any(|x| x.rule == "trust/bad-content"));
    // The signature on its own still checks out: it covers the list, not the files.
    assert_eq!(
        hubcheck::verify(&bad, Kind::App, &s.anchors, &s.revoked, f.now).trust,
        Trust::Verified
    );
}

#[test]
fn an_id_reserved_for_wolos_signed_by_somebody_else_is_blocked() {
    let f = Fixture::new();
    let s = f.store();
    let own = hubcheck::inspect(
        &f.wol("org.wolos.notes", Signer::Wolos),
        Kind::App,
        &s.anchors,
        &s.revoked,
        f.now,
        None,
    );
    assert_eq!((own.verdict, own.trust), (Verdict::Pass, Trust::Wolos));
    let other = hubcheck::inspect(
        &f.wol("org.wolos.notes", Signer::None),
        Kind::App,
        &s.anchors,
        &s.revoked,
        f.now,
        None,
    );
    assert_eq!(other.verdict, Verdict::Block);
    assert!(
        other
            .findings
            .iter()
            .any(|x| x.rule == "manifest/reserved-id")
    );
}

#[test]
fn the_report_json_has_exactly_the_frozen_keys() {
    let f = Fixture::new();
    let store = f.store_json();
    let wol = f.wol("alice.notes", Signer::Alice);
    let v: serde_json::Value = serde_json::from_str(&hubcheck::api::inspect_json(
        &wol, "app", &store, f.now, None,
    ))
    .unwrap();
    let mut keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, ["cert", "findings", "trust", "verdict"]);
    let mut c: Vec<_> = v["cert"].as_object().unwrap().keys().cloned().collect();
    c.sort();
    assert_eq!(c, ["level", "serial", "subject"]);
    assert_eq!(v["verdict"], "pass");
    // Unsigned: no cert key at all, and one finding with the three keys of I7.
    let u = hubcheck::api::inspect_json(
        &f.wol("alice.notes", Signer::None),
        "app",
        &store,
        f.now,
        None,
    );
    let u: serde_json::Value = serde_json::from_str(&u).unwrap();
    assert!(u.get("cert").is_none());
    let mut fk: Vec<_> = u["findings"][0]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    fk.sort();
    assert_eq!(fk, ["evidence", "rule", "sentence"]);
    assert_eq!(u["trust"], "community");
    // Every verdict and trust word is one of the frozen ones.
    for x in [&v, &u] {
        assert!(["pass", "flag", "block", "not-checked"].contains(&x["verdict"].as_str().unwrap()));
        assert!(
            ["wolos", "verified", "community", "withdrawn", "invalid"]
                .contains(&x["trust"].as_str().unwrap())
        );
    }
}

#[test]
fn a_bad_kind_or_store_is_a_report_not_a_panic() {
    let f = Fixture::new();
    let wol = f.wol("alice.notes", Signer::None);
    for out in [
        hubcheck::api::check_json(&wol, "banana"),
        hubcheck::api::verify_json(&wol, "banana", "{}", 0, None),
        hubcheck::api::verify_json(&wol, "app", "not json", 0, None),
        hubcheck::api::inspect_json(&wol, "app", "[]", 0, None),
        hubcheck::api::manifest_json("", "banana"),
    ] {
        let v: serde_json::Value = serde_json::from_str(&out).expect("JSON");
        assert_eq!(v["verdict"], "not-checked", "{out}");
    }
}

#[test]
fn a_store_loaded_once_gives_the_same_answers() {
    let f = Fixture::new();
    let store = f.store_json();
    let l = hubcheck::api::Loaded::new(&store, f.now).expect("store");
    for (id, who) in [
        ("alice.notes", Signer::Alice),
        ("alice.notes", Signer::None),
        ("bob.notes", Signer::Alice),
    ] {
        let w = f.wol(id, who);
        assert_eq!(
            l.verify_json(&w, "app"),
            hubcheck::api::verify_json(&w, "app", &store, f.now, None)
        );
    }
    assert!(hubcheck::api::Loaded::new("nope", 0).is_err());
}
