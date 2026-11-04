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
        hubcheck::api::verify_json(&wol, "app", &f.store_json(), f.now, None)
    );
    let inspected = run(&["inspect", "app", fp, "--store", sp, "--now", &now]);
    assert_eq!(
        inspected,
        hubcheck::api::inspect_json(&wol, "app", &f.store_json(), f.now, None)
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
