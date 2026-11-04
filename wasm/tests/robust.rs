// SPDX-License-Identifier: GPL-2.0-or-later
//! Nothing the hub is handed can make the check panic or run away: truncations, bit flips, random
//! bytes and hostile text give a report every time.
use hubcheck::fixtures::{Fixture, Signer};
use hubcheck::{Kind, api};

fn xorshift(s: &mut u64) -> u64 {
    *s ^= *s << 13;
    *s ^= *s >> 7;
    *s ^= *s << 17;
    *s
}

#[test]
fn mutated_files_always_give_a_report() {
    let f = Fixture::new();
    let store = f.store_json();
    let toml = Fixture::plugin_toml("alice.weather", "\"http\"");
    let files = [
        (f.wol("alice.notes", Signer::Alice), "app"),
        (
            f.plugin(
                "alice.weather",
                &[
                    ("plugin.toml", toml.as_bytes()),
                    ("card.lua", b"wol.http_get(1)"),
                ],
                Signer::Alice,
            ),
            "plugin",
        ),
        (
            f.plugin(
                "alice.weather",
                &[("plugin.toml", toml.as_bytes())],
                Signer::Alice,
            ),
            "extension",
        ),
    ];
    let mut seed = 0x9e37_79b9_7f4a_7c15u64;
    for (bytes, kind) in &files {
        for cut in (0..bytes.len()).step_by(97) {
            let _ = api::inspect_json(&bytes[..cut], kind, &store, f.now, None);
        }
        for _ in 0..150 {
            let mut b = bytes.clone();
            for _ in 0..1 + xorshift(&mut seed) % 6 {
                let i = (xorshift(&mut seed) as usize) % b.len();
                b[i] = xorshift(&mut seed) as u8;
            }
            let out = api::inspect_json(&b, kind, &store, f.now, None);
            serde_json::from_str::<serde_json::Value>(&out).expect("always JSON");
        }
    }
}

#[test]
fn random_bytes_and_hostile_text() {
    let mut seed = 0x1234_5678_9abc_def1u64;
    for kind in ["app", "plugin", "extension"] {
        for n in [0usize, 1, 511, 512, 513, 1024, 5000] {
            let b: Vec<u8> = (0..n).map(|_| xorshift(&mut seed) as u8).collect();
            let r = api::check_json(&b, kind);
            serde_json::from_str::<serde_json::Value>(&r).expect("JSON");
            let _ = api::verify_json(&b, kind, "{}", 5, None);
            let _ = api::manifest_json(&String::from_utf8_lossy(&b), kind);
        }
    }
    for t in [
        "a = [".repeat(2000),
        "\"".repeat(100_000),
        "[[x]]\n".repeat(10_000),
        "\u{feff}schema = 1\n".to_owned(),
        "{\"id\":".repeat(5000),
        "\0\0\0".to_owned(),
    ] {
        for kind in ["app", "plugin", "extension"] {
            let out = api::manifest_json(&t, kind);
            serde_json::from_str::<serde_json::Value>(&out).expect("JSON");
        }
    }
    // A store full of junk is a report, not a failure.
    let junk = r#"{"roots":["x"],"intermediates":["{}"],"revoked":[{"list":"[","wsig":""}]}"#;
    let f = Fixture::new();
    let out = api::inspect_json(
        &f.wol("alice.notes", Signer::Alice),
        "app",
        junk,
        f.now,
        None,
    );
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["trust"], "invalid");
}

#[test]
fn a_tar_that_claims_a_huge_size_is_refused() {
    let mut b = hubcheck::tar::build(&[("Info.json", b"{}")]);
    b[124..135].copy_from_slice(b"77777777777");
    let sum: u32 = b[..512]
        .iter()
        .enumerate()
        .map(|(i, x)| {
            if (148..156).contains(&i) {
                32
            } else {
                u32::from(*x)
            }
        })
        .sum();
    b[148..156].copy_from_slice(format!("{sum:06o}\0 ").as_bytes());
    let r = hubcheck::check(&b, Kind::App);
    assert_eq!(r.findings[0].rule, "file/format");
}
