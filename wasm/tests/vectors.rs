// SPDX-License-Identifier: GPL-2.0-or-later
//! The 45 replay files of the trust crate (commit fe64176, `crates/woltrust/vectors`: `pki.json` and
//! 44 verify vectors, 4 of them with an origin) replay to their recorded results, byte for byte,
//! through the same code the browser module runs. The 13 seal vectors of `vectors/seal/` are not
//! copied: opening a sealed file needs woltrust's `seal` feature (ring), which this crate leaves off
//! so it builds for wasm.
use std::path::PathBuf;

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/vectors")
}

fn files() -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir())
        .expect("vectors dir")
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".json"))
        .collect();
    v.sort();
    v
}

#[test]
fn there_are_45_files_and_each_replays_to_its_recorded_result() {
    let names = files();
    assert_eq!(names.len(), 45, "pki.json and 44 vectors");
    for o in [
        "valid-origin",
        "valid-origin-organisation",
        "origin-mismatch",
        "origin-tampered",
    ] {
        assert!(names.contains(&format!("{o}.json")), "{o}");
    }
    let pki = std::fs::read_to_string(dir().join("pki.json")).expect("pki.json");
    for n in names.iter().filter(|n| *n != "pki.json") {
        let text = std::fs::read_to_string(dir().join(n)).expect("vector");
        let why = hubcheck::api::replay_vector(&pki, &text);
        assert!(why.is_empty(), "{n}: {why}");
    }
}

#[test]
fn the_copies_are_what_the_pinned_generator_writes() {
    let (pki, vectors) = woltrust::vectors::generate().expect("generation succeeds");
    let on_disk = |name: &str| std::fs::read_to_string(dir().join(name)).expect("file");
    assert_eq!(woltrust::vectors::to_text(&pki), on_disk("pki.json"));
    for v in &vectors {
        let name = format!("{}.json", v.name);
        assert_eq!(woltrust::vectors::to_text(v), on_disk(&name), "{name}");
    }
    assert_eq!(vectors.len() + 1, files().len());
}

#[test]
fn a_changed_expectation_is_caught() {
    let pki = std::fs::read_to_string(dir().join("pki.json")).expect("pki.json");
    let text = std::fs::read_to_string(dir().join("valid-person.json")).expect("vector");
    let broken = text.replace("\"trust\": \"verified\"", "\"trust\": \"wolos\"");
    assert_ne!(broken, text);
    assert!(!hubcheck::api::replay_vector(&pki, &broken).is_empty());
    assert!(!hubcheck::api::replay_vector("{", &text).is_empty());
    assert!(!hubcheck::api::replay_vector(&pki, "{").is_empty());
}
