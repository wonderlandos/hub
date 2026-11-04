// SPDX-License-Identifier: GPL-2.0-or-later
//! The command prints the same JSON as the library functions the browser module calls.
use hubcheck::fixtures::{Fixture, Signer};
use std::process::Command;

fn bin() -> Command {
    Command::new(env!("CARGO_BIN_EXE_hubcheck"))
}

fn tmp(name: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("hubcheck-cli-{}", std::process::id()));
    std::fs::create_dir_all(&d).unwrap();
    d.join(name)
}

#[test]
fn the_command_and_the_library_print_the_same_bytes() {
    let f = Fixture::new();
    let wol = f.wol("alice.notes", Signer::Alice);
    let file = tmp("a.wol");
    std::fs::write(&file, &wol).unwrap();
    let store = tmp("store.json");
    std::fs::write(&store, f.store_json()).unwrap();
    let now = f.now.to_string();
    let run = |args: &[&str]| {
        let o = bin().args(args).output().unwrap();
        assert!(
            o.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&o.stderr)
        );
        String::from_utf8(o.stdout).unwrap().trim_end().to_owned()
    };
    let (fp, sp) = (file.to_str().unwrap(), store.to_str().unwrap());
    assert_eq!(
        run(&["check", "app", fp]),
        hubcheck::api::check_json(&wol, "app")
    );
    assert_eq!(
        run(&["verify", "app", fp, "--store", sp, "--now", &now]),
        hubcheck::api::verify_json(&wol, "app", &f.store_json(), f.now, None, None)
    );
    let inspected = run(&["inspect", "app", fp, "--store", sp, "--now", &now]);
    assert_eq!(
        inspected,
        hubcheck::api::inspect_json(&wol, "app", &f.store_json(), f.now, None, None)
    );
    assert!(inspected.contains("\"trust\":\"origin\""));
    let m = tmp("plugin.toml");
    std::fs::write(&m, Fixture::plugin_toml("alice.weather", "\"http\"")).unwrap();
    assert_eq!(
        run(&["manifest", "plugin", m.to_str().unwrap()]),
        hubcheck::api::manifest_json(&Fixture::plugin_toml("alice.weather", "\"http\""), "plugin")
    );
}

#[test]
fn wrong_use_and_missing_files_have_their_own_exit_codes() {
    assert_eq!(
        bin().args(["check"]).output().unwrap().status.code(),
        Some(2)
    );
    assert_eq!(
        bin()
            .args(["frobnicate", "app", "x"])
            .output()
            .unwrap()
            .status
            .code(),
        Some(2)
    );
    assert_eq!(
        bin()
            .args(["check", "app", "/nonexistent/file"])
            .output()
            .unwrap()
            .status
            .code(),
        Some(1)
    );
    assert_eq!(
        bin()
            .args(["verify", "app", "x"])
            .output()
            .unwrap()
            .status
            .code(),
        Some(2)
    );
    let o = bin()
        .args(["check", "banana", "/dev/null"])
        .output()
        .unwrap();
    assert!(o.status.success());
    assert!(String::from_utf8_lossy(&o.stdout).contains("input/kind"));
}

#[test]
fn extract_writes_the_checked_pictures_by_hash_and_prints_the_facts() {
    let f = Fixture::new();
    let icon = hubcheck::fixtures::png(256, 256);
    let info = r#"{"id":"alice.notes","version":"1.0","name":"Notes","summary":"Quick notes","package":"notes","screenshots":["screenshots/1.png"],"targets":[{"abi":"linux","arch":"amd64","entry":"bin/notes"}]}"#;
    let shot = hubcheck::fixtures::png(640, 400);
    let wol = f.wol_listing(
        info,
        Some(&icon),
        &[("screenshots/1.png", &shot)],
        b"p",
        Signer::None,
        None,
    );
    let file = tmp("x.wol");
    std::fs::write(&file, &wol).unwrap();
    let out = tmp("cdn");
    let _ = std::fs::remove_dir_all(&out);
    let o = bin()
        .args([
            "extract",
            file.to_str().unwrap(),
            "--out",
            out.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    let v: serde_json::Value = serde_json::from_slice(&o.stdout).unwrap();
    assert_eq!(v["verdict"], "pass");
    let (hi, hs) = (
        hubcheck::files::sha256_hex(&icon),
        hubcheck::files::sha256_hex(&shot),
    );
    assert_eq!(
        v["written"],
        serde_json::json!([format!("{hi}.png"), format!("{hs}.png")])
    );
    assert_eq!(v["facts"]["icon"]["sha256"], hi);
    assert_eq!(std::fs::read(out.join(format!("{hi}.png"))).unwrap(), icon);
    assert_eq!(std::fs::read(out.join(format!("{hs}.png"))).unwrap(), shot);
    // No kind from the name and none given; and a file whose manifest cannot be read.
    let odd = tmp("x.bin");
    std::fs::write(&odd, &wol).unwrap();
    let code = |args: &[&str]| bin().args(args).output().unwrap().status.code();
    assert_eq!(
        code(&[
            "extract",
            odd.to_str().unwrap(),
            "--out",
            out.to_str().unwrap()
        ]),
        Some(2)
    );
    assert_eq!(
        code(&[
            "extract",
            odd.to_str().unwrap(),
            "--out",
            out.to_str().unwrap(),
            "--kind",
            "app"
        ]),
        Some(0)
    );
    assert_eq!(code(&["extract", file.to_str().unwrap()]), Some(2));
    let junk = tmp("junk.wol");
    std::fs::write(&junk, b"junk").unwrap();
    assert_eq!(
        code(&[
            "extract",
            junk.to_str().unwrap(),
            "--out",
            out.to_str().unwrap()
        ]),
        Some(1)
    );
}
