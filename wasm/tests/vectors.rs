// SPDX-License-Identifier: GPL-2.0-or-later
//! The 54 replay files of the trust crate (commit 0b00c1e, `crates/woltrust/vectors`: `pki.json` and
//! 53 verify vectors, among them the origin and trusted classes) and its 7 file certificate vectors
//! (`vectors/filecert/`) replay to their recorded results, byte for byte, through the same code the
//! browser module runs. The seal and request vectors (`vectors/seal/`, `vectors/request/`) are not
//! copied: they need woltrust's `seal` feature (ring), which this crate leaves off so it builds for wasm.
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
fn there_are_54_files_and_each_replays_to_its_recorded_result() {
    let names = files();
    assert_eq!(names.len(), 54, "pki.json and 53 vectors");
    for o in [
        "valid-origin",
        "valid-origin-organisation",
        "origin-mismatch",
        "origin-tampered",
        "valid-trusted",
        "trusted-origin-revoked",
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
    let broken = text.replace("\"trust\": \"origin\"", "\"trust\": \"wolos\"");
    assert_ne!(broken, text);
    assert!(!hubcheck::api::replay_vector(&pki, &broken).is_empty());
    assert!(!hubcheck::api::replay_vector("{", &text).is_empty());
    assert!(!hubcheck::api::replay_vector(&pki, "{").is_empty());
}

fn filecert_files() -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir().join("filecert"))
        .expect("filecert dir")
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

#[test]
fn the_file_certificate_vectors_replay_and_are_what_the_generator_writes() {
    let names = filecert_files();
    assert_eq!(names.len(), 7);
    for n in &names {
        let text = std::fs::read_to_string(dir().join("filecert").join(n)).expect("vector");
        let why = hubcheck::api::replay_filecert_vector(&text);
        assert!(why.is_empty(), "{n}: {why}");
        assert!(
            !hubcheck::api::replay_filecert_vector(
                &text.replace("\"expect\": \"", "\"expect\": \"x")
            )
            .is_empty()
        );
    }
    let vs = woltrust::filecert_vectors::generate().expect("generation succeeds");
    for v in &vs {
        let on_disk =
            std::fs::read_to_string(dir().join("filecert").join(format!("{}.json", v.name)))
                .expect("file");
        assert_eq!(woltrust::vectors::to_text(v), on_disk, "{}", v.name);
    }
    assert_eq!(vs.len(), names.len());
}
