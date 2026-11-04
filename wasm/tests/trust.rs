// SPDX-License-Identifier: GPL-2.0-or-later
//! A fixture `.wol` in the package format of the OS (format 2 with CHAIN and SHA256.wsig) goes
//! through `verify` and `inspect`, and the I7 JSON has exactly the frozen shape.
use hubcheck::fixtures::{Fixture, Signer};
use hubcheck::{Class, Kind, Trust, Verdict};
use woltrust::revoked::Reason;

fn run(f: &Fixture, bytes: &[u8], kind: Kind, now: u64) -> hubcheck::Trusted {
    let s = f.store();
    hubcheck::verify(bytes, kind, &s.anchors, &s.revoked, now)
}

#[test]
fn a_person_an_organisation_and_wolos_are_told_apart() {
    let f = Fixture::new();
    for (id, who, trust, level, class) in [
        (
            "alice.notes",
            Signer::Alice,
            Trust::Origin,
            "verified",
            Some(Class::Origin),
        ),
        (
            "examplelabs.tool",
            Signer::Org,
            Trust::Origin,
            "verified",
            Some(Class::Origin),
        ),
        (
            "org.wolos.notes",
            Signer::Wolos,
            Trust::Wolos,
            "wolos",
            None,
        ),
    ] {
        let t = run(&f, &f.wol(id, who), Kind::App, f.now);
        assert_eq!((t.trust, t.code.as_str()), (trust, "ok"), "{id}");
        let c = t.cert.expect("cert");
        assert_eq!(serde_json::to_value(c.level).unwrap(), level);
        // The fixture certificates carry no "class": absent is origin; WolOS signers have none.
        assert_eq!(c.class, class, "{id}");
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
    assert_eq!(run(&f, &plug, Kind::Plugin, f.now).trust, Trust::Origin);
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
        Trust::Origin
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
        &wol, "app", &store, f.now, None, None,
    ))
    .unwrap();
    let mut keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(
        keys,
        ["cert", "facts", "file", "findings", "trust", "verdict"]
    );
    let mut fk: Vec<_> = v["facts"].as_object().unwrap().keys().cloned().collect();
    fk.sort();
    assert_eq!(fk, ["categories", "icon", "name", "screenshots", "summary"]);
    let mut ik: Vec<_> = v["facts"]["icon"]
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    ik.sort();
    assert_eq!(ik, ["h", "mime", "path", "sha256", "size", "w"]);
    assert_eq!(
        v["file"],
        serde_json::json!({"id": "alice.notes", "version": "1.0"})
    );
    let mut c: Vec<_> = v["cert"].as_object().unwrap().keys().cloned().collect();
    c.sort();
    assert_eq!(c, ["class", "level", "serial", "subject"]);
    assert_eq!(v["cert"]["class"], "origin");
    assert_eq!(v["trust"], "origin");
    assert_eq!(v["verdict"], "pass");
    // Unsigned: no cert key at all, and one finding with the three keys of I7.
    let u = hubcheck::api::inspect_json(
        &f.wol("alice.notes", Signer::None),
        "app",
        &store,
        f.now,
        None,
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
            [
                "wolos",
                "trusted",
                "origin",
                "community",
                "withdrawn",
                "invalid"
            ]
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
        hubcheck::api::verify_json(&wol, "banana", "{}", 0, None, None),
        hubcheck::api::verify_json(&wol, "app", "not json", 0, None, None),
        hubcheck::api::inspect_json(&wol, "app", "[]", 0, None, None),
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
            l.verify_json(&w, "app", None),
            hubcheck::api::verify_json(&w, "app", &store, f.now, None, None)
        );
    }
    assert!(hubcheck::api::Loaded::new("nope", 0).is_err());
}

#[test]
fn a_signed_origin_is_shown_and_checked_against_the_certificate() {
    let f = Fixture::new();
    let store = f.store_json();
    let info = Fixture::info("alice.notes", "1.0");
    let ours = f.wol_origin(&info, b"p", Signer::Alice, Some(&Fixture::origin("Alice")));
    let v: serde_json::Value = serde_json::from_str(&hubcheck::api::inspect_json(
        &ours, "app", &store, f.now, None, None,
    ))
    .unwrap();
    assert_eq!(v["trust"], "origin", "{v}");
    assert_eq!(v["origin"]["repo"], "https://github.com/Alice/notes");
    assert_eq!(v["origin"]["tag"], "v1.0");
    assert_eq!(
        v["origin"]["commit"],
        "0123456789abcdef0123456789abcdef01234567"
    );
    assert_eq!(v["origin"]["built"], f.now - 86_400);
    let t = run(&f, &ours, Kind::App, f.now);
    assert_eq!((t.code.as_str(), t.origin.is_some()), ("ok", true));
    // Somebody else's repository: woltrust's finding, and no origin shown.
    let theirs = f.wol_origin(&info, b"p", Signer::Alice, Some(&Fixture::origin("bob")));
    let v: serde_json::Value = serde_json::from_str(&hubcheck::api::inspect_json(
        &theirs, "app", &store, f.now, None, None,
    ))
    .unwrap();
    assert_eq!(v["trust"], "invalid", "{v}");
    assert!(v.get("origin").is_none());
    assert!(
        v["findings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x["rule"] == "trust/origin-mismatch"),
        "{v}"
    );
    assert_eq!(run(&f, &theirs, Kind::App, f.now).code, "origin-mismatch");
    // No origin: no key.
    let plain = f.wol("alice.notes", Signer::Alice);
    let v = hubcheck::api::inspect_json(&plain, "app", &store, f.now, None, None);
    assert!(!v.contains("\"origin\":"), "{v}");
}

#[test]
fn the_report_names_the_id_and_version_of_the_manifest() {
    let f = Fixture::new();
    let store = f.store_json();
    let file =
        |out: String| serde_json::from_str::<serde_json::Value>(&out).unwrap()["file"].clone();
    let wol = f.wol_with(
        &Fixture::info("alice.notes", "2.5~beta"),
        b"p",
        Signer::None,
    );
    assert_eq!(
        file(hubcheck::api::check_json(&wol, "app")),
        serde_json::json!({"id": "alice.notes", "version": "2.5~beta"})
    );
    let toml = Fixture::plugin_toml("alice.weather", "");
    let plug = f.plugin(
        "alice.weather",
        &[
            ("plugin.toml", toml.as_bytes()),
            ("card.lua", b"return wol.widget {}\n"),
        ],
        Signer::Alice,
    );
    let want = serde_json::json!({"id": "alice.weather", "version": "1.0"});
    assert_eq!(
        file(hubcheck::api::inspect_json(
            &plug, "plugin", &store, f.now, None, None
        )),
        want
    );
    assert_eq!(file(hubcheck::api::manifest_json(&toml, "plugin")), want);
    // A malformed version is left out; a malformed id leaves out the whole object.
    let bad_v = toml.replace("version = \"1.0\"", "version = \"1 0\"");
    assert_eq!(
        file(hubcheck::api::manifest_json(&bad_v, "plugin")),
        serde_json::json!({"id": "alice.weather"})
    );
    let bad_id = toml.replace("id = \"alice.weather\"", "id = \"Alice Weather\"");
    assert!(file(hubcheck::api::manifest_json(&bad_id, "plugin")).is_null());
    assert!(file(hubcheck::api::check_json(b"junk", "app")).is_null());
}

#[test]
fn the_class_and_origin_cert_come_from_the_certificate() {
    let f = Fixture::new();
    let store = f.store_json();
    let inspect = |s: Signer| -> serde_json::Value {
        serde_json::from_str(&hubcheck::api::inspect_json(
            &f.wol("alice.notes", s),
            "app",
            &store,
            f.now,
            None,
            None,
        ))
        .unwrap()
    };
    let t = inspect(Signer::AliceTrusted);
    assert_eq!(t["trust"], "trusted", "{t}");
    assert_eq!(t["cert"]["class"], "trusted");
    assert_eq!(t["cert"]["origin_cert"], f.pki.alice.body.serial.as_str());
    let o = inspect(Signer::Alice);
    assert_eq!(
        (o["trust"].as_str(), o["cert"]["class"].as_str()),
        (Some("origin"), Some("origin"))
    );
    assert!(o["cert"].get("origin_cert").is_none());
    let w = inspect(Signer::Wolos);
    assert!(w["cert"].get("class").is_none() && w["cert"].get("origin_cert").is_none());
    // woltrust's verdicts map one to one.
    use woltrust::Trust as W;
    for (w, want) in [
        (W::Wolos, Trust::Wolos),
        (W::Trusted, Trust::Trusted),
        (W::Origin, Trust::Origin),
        (W::Legacy, Trust::Legacy),
        (W::Community, Trust::Community),
        (W::Withdrawn, Trust::Withdrawn),
        (W::Invalid, Trust::Invalid),
    ] {
        assert_eq!(Trust::of(w), want, "{w:?}");
    }
    let words: Vec<String> = [
        Trust::Wolos,
        Trust::Trusted,
        Trust::Origin,
        Trust::Legacy,
        Trust::Community,
        Trust::Withdrawn,
        Trust::Invalid,
    ]
    .iter()
    .map(|t| {
        serde_json::to_value(t)
            .unwrap()
            .as_str()
            .unwrap()
            .to_owned()
    })
    .collect();
    assert_eq!(
        words,
        [
            "wolos",
            "trusted",
            "origin",
            "legacy",
            "community",
            "withdrawn",
            "invalid"
        ]
    );
}

fn file_cert(f: &Fixture, wol: &[u8], id: &str, version: &str, serial: &str) -> Vec<u8> {
    f.file_cert(wol, id, version, serial)
}

#[test]
fn a_file_certificate_is_checked_against_this_exact_file() {
    let f = Fixture::new();
    let store = f.store_json();
    let wol = f.wol("alice.notes", Signer::Alice);
    let run = |fc: &[u8], store: &str| -> serde_json::Value {
        let v: serde_json::Value = serde_json::from_str(&hubcheck::api::inspect_json(
            &wol,
            "app",
            store,
            f.now,
            None,
            Some(fc),
        ))
        .unwrap();
        let t: serde_json::Value = serde_json::from_str(&hubcheck::api::verify_json(
            &wol,
            "app",
            store,
            f.now,
            None,
            Some(fc),
        ))
        .unwrap();
        assert_eq!(v["trust"], t["trust"]);
        assert_eq!(v.get("file_certificate"), t.get("file_certificate"));
        v
    };
    let good = file_cert(&f, &wol, "alice.notes", "1.0", "a1b2c3d4e5f60718");
    let v = run(&good, &store);
    assert_eq!(v["trust"], "origin", "{v}");
    assert_eq!(
        v["file_certificate"],
        serde_json::json!({"serial": "a1b2c3d4e5f60718", "checked_at": f.now - 3600, "verdict": "pass"})
    );
    // Withdrawn: a withdrawn-version entry for the file certificate's serial.
    let mut s = f.store();
    s.revoked = vec![f.list(&[("a1b2c3d4e5f60718", woltrust::Reason::WithdrawnVersion)])];
    let w = run(&good, &serde_json::to_string(&s).unwrap());
    assert_eq!(w["trust"], "withdrawn", "{w}");
    assert!(
        w["findings"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x["rule"] == "trust/withdrawn-version")
    );
    assert_eq!(w["file_certificate"]["serial"], "a1b2c3d4e5f60718");
    // Another file, another version, a changed byte: invalid, no file_certificate.
    let other = file_cert(
        &f,
        &f.wol("alice.other", Signer::Alice),
        "alice.other",
        "1.0",
        "a1b2c3d4e5f60719",
    );
    let wrong_version = file_cert(&f, &wol, "alice.notes", "2.0", "a1b2c3d4e5f60720");
    let mut tampered = good.clone();
    let at = tampered.len() / 3;
    tampered[at] = if tampered[at] == b'A' { b'B' } else { b'A' };
    for (fc, code) in [
        (&other, "trust/file-cert-other-file"),
        (&wrong_version, "trust/file-cert-other-file"),
        (&tampered, ""),
        (&b"{}".to_vec(), "trust/file-cert-malformed"),
    ] {
        let v = run(fc, &store);
        assert_eq!(v["trust"], "invalid", "{code} {v}");
        assert!(v.get("file_certificate").is_none());
        if !code.is_empty() {
            assert!(
                v["findings"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|x| x["rule"] == code),
                "{code} {v}"
            );
        }
    }
}
