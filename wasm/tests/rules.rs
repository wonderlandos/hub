// SPDX-License-Identifier: GPL-2.0-or-later
//! Each rule of the analysis, one file at a time.
use hubcheck::fixtures::{Fixture, Signer, manifest};
use hubcheck::{Kind, Report, Verdict, tar};

fn has(r: &Report, rule: &str) -> bool {
    r.findings.iter().any(|f| f.rule == rule)
}

fn plugin(files: &[(&str, &[u8])]) -> Vec<u8> {
    Fixture::new().plugin("alice.weather", files, Signer::None)
}

const LUA_OK: &[u8] = b"local r = wol.http_get('https://example.org')\nreturn wol.widget { render = function() return r end }\n";

fn toml(perms: &str) -> String {
    Fixture::plugin_toml("alice.weather", perms)
}

fn ck(files: &[(&str, &[u8])]) -> Report {
    hubcheck::check(&plugin(files), Kind::Plugin)
}

/// A plain tar is flagged for being uncompressed; every other rule is the same either way.
fn rules_of(r: &Report) -> Vec<&str> {
    r.findings
        .iter()
        .map(|f| f.rule.as_str())
        .filter(|r| *r != "file/not-compressed")
        .collect()
}

#[test]
fn a_clean_plugin_has_no_findings_of_its_own() {
    let t = toml("\"http\"");
    let r = ck(&[("plugin.toml", t.as_bytes()), ("card.lua", LUA_OK)]);
    assert_eq!(rules_of(&r), Vec::<&str>::new(), "{r:?}");
    assert!(matches!(r.verdict, Verdict::Pass | Verdict::Flag));
}

#[test]
fn permissions_against_the_files_present() {
    let t = toml("");
    let r = ck(&[("plugin.toml", t.as_bytes()), ("card.lua", LUA_OK)]);
    assert!(has(&r, "permissions/undeclared"));
    assert_eq!(
        r.findings
            .iter()
            .find(|f| f.rule == "permissions/undeclared")
            .unwrap()
            .evidence,
        "http"
    );
    let t = toml("\"http\", \"clipboard\"");
    let r = ck(&[("plugin.toml", t.as_bytes()), ("card.lua", LUA_OK)]);
    let unused = r
        .findings
        .iter()
        .find(|f| f.rule == "permissions/unused")
        .expect("unused");
    assert_eq!(unused.evidence, "clipboard");
    let t = toml("\"teleport\"");
    assert!(has(
        &ck(&[("plugin.toml", t.as_bytes()), ("card.lua", LUA_OK)]),
        "manifest/permission"
    ));
}

#[test]
fn forbidden_paths_are_blocked() {
    let t = toml("\"http\"");
    for bad in [".git/config", "a/../b.lua", ".env", "x y.lua", "Ünï.lua"] {
        let r = ck(&[
            ("plugin.toml", t.as_bytes()),
            ("card.lua", LUA_OK),
            (bad, b"x"),
        ]);
        assert_eq!(r.verdict, Verdict::Block, "{bad}");
        assert!(has(&r, "paths/forbidden"), "{bad}");
    }
    let r = ck(&[
        ("plugin.toml", t.as_bytes()),
        ("card.lua", LUA_OK),
        ("id_rsa", b"-----BEGIN"),
    ]);
    assert!(has(&r, "content/secret"));
    let r = ck(&[
        ("plugin.toml", t.as_bytes()),
        ("card.lua", LUA_OK),
        ("card.lua", LUA_OK),
    ]);
    assert!(has(&r, "paths/duplicate"));
}

#[test]
fn a_folder_that_is_not_one_plugin_is_blocked() {
    let f = Fixture::new();
    let t = toml("\"http\"");
    let raw = tar::build(&[
        ("alice.weather/plugin.toml", t.as_bytes()),
        ("other/x.lua", b"x"),
    ]);
    let man = manifest(&[
        ("alice.weather/plugin.toml", t.as_bytes()),
        ("other/x.lua", b"x"),
    ]);
    let mut m: Vec<(&str, &[u8])> = vec![
        ("alice.weather/plugin.toml", t.as_bytes()),
        ("other/x.lua", b"x"),
        ("SHA256", man.as_bytes()),
    ];
    let bytes = tar::build(&m);
    assert!(has(&hubcheck::check(&bytes, Kind::Plugin), "paths/folder"));
    m.clear();
    assert!(has(&hubcheck::check(&raw, Kind::Plugin), "file/members"));
    let wrong_id = f.plugin(
        "alice.other",
        &[("plugin.toml", t.as_bytes()), ("card.lua", LUA_OK)],
        Signer::None,
    );
    assert!(has(
        &hubcheck::check(&wrong_id, Kind::Plugin),
        "manifest/id"
    ));
}

#[test]
fn size_caps() {
    let t = toml("\"http\"");
    let big = vec![b'a'; 300 * 1024];
    let r = ck(&[
        ("plugin.toml", t.as_bytes()),
        ("card.lua", LUA_OK),
        ("big.txt", &big),
    ]);
    assert!(has(&r, "size/file"));
    let part = vec![b'a'; 200 * 1024];
    let r = ck(&[
        ("plugin.toml", t.as_bytes()),
        ("card.lua", LUA_OK),
        ("a.txt", &part),
        ("b.txt", &part),
        ("c.txt", &part),
        ("d.txt", &part),
        ("e.txt", &part),
        ("f.txt", &part),
    ]);
    assert!(has(&r, "size/total"));
    assert_eq!(r.verdict, Verdict::Block);
    let many: Vec<(String, Vec<u8>)> = (0..300)
        .map(|i| (format!("f{i}.txt"), vec![b'x']))
        .collect();
    let mut files: Vec<(&str, &[u8])> = many
        .iter()
        .map(|(n, b)| (n.as_str(), b.as_slice()))
        .collect();
    files.push(("plugin.toml", t.as_bytes()));
    assert!(has(&ck(&files), "file/members"));
    // Over the file cap: refused before it is read (a compressed plugin is at most 2 MB).
    let huge = vec![0u8; 3 << 20];
    let r = hubcheck::check(&huge, Kind::Plugin);
    assert_eq!(
        (r.verdict, has(&r, "file/too-large")),
        (Verdict::Block, true)
    );
}

#[test]
fn embedded_binaries_and_scripts_are_flagged() {
    let t = toml("\"http\"");
    let r = ck(&[
        ("plugin.toml", t.as_bytes()),
        ("card.lua", LUA_OK),
        ("helper", b"\x7fELF\x02\x01\x01"),
    ]);
    assert!(has(&r, "content/binary"));
    assert_eq!(
        r.findings
            .iter()
            .find(|f| f.rule == "content/binary")
            .unwrap()
            .evidence,
        "helper"
    );
    let r = ck(&[
        ("plugin.toml", t.as_bytes()),
        ("card.lua", LUA_OK),
        ("setup.sh", b"echo hi"),
    ]);
    assert!(has(&r, "content/script"));
    let r = ck(&[
        ("plugin.toml", t.as_bytes()),
        ("card.lua", LUA_OK),
        ("lib.so", b"not elf"),
    ]);
    assert!(has(&r, "content/binary"));
    let lua =
        b"wol.http_get('x')\nwol.run { 'sh', '-c', 'x' }\nlocal a = {\"bash\", \"-c\", \"id\"}\n";
    let r = ck(&[("plugin.toml", t.as_bytes()), ("card.lua", lua)]);
    assert!(has(&r, "content/shell-run"));
    assert_eq!(r.verdict, Verdict::Flag);
}

#[test]
fn manifest_rules_in_a_file() {
    let t = toml("\"http\"");
    // A file the manifest names that is not there.
    let r = ck(&[("plugin.toml", t.as_bytes())]);
    assert!(has(&r, "manifest/missing-file"));
    assert_eq!(r.verdict, Verdict::Block);
    // No manifest.
    assert!(has(&ck(&[("card.lua", LUA_OK)]), "manifest/missing"));
    // Reserved id.
    let f = Fixture::new();
    let t2 = Fixture::plugin_toml("org.wolos.weather", "\"http\"");
    let r = hubcheck::check(
        &f.plugin(
            "org.wolos.weather",
            &[("plugin.toml", t2.as_bytes()), ("card.lua", LUA_OK)],
            Signer::None,
        ),
        Kind::Plugin,
    );
    assert!(has(&r, "manifest/reserved-id"));
    assert_eq!(r.verdict, Verdict::Block);
    // A signed file must say it needs 0.13.
    let t3 = t.replace("min_wolos = \"0.13\"\n", "");
    let r = hubcheck::check(
        &f.plugin(
            "alice.weather",
            &[("plugin.toml", t3.as_bytes()), ("card.lua", LUA_OK)],
            Signer::Alice,
        ),
        Kind::Plugin,
    );
    assert!(has(&r, "manifest/min-wolos"));
}

#[test]
fn the_doctrine_rule_on_names() {
    let t = toml("\"http\"").replace("Weather", "Hyprland Weather");
    let r = ck(&[("plugin.toml", t.as_bytes()), ("card.lua", LUA_OK)]);
    let d = r
        .findings
        .iter()
        .find(|f| f.rule == "doctrine/name")
        .expect("doctrine");
    assert_eq!(d.evidence, "Hyprland");
    assert_ne!(r.verdict, Verdict::Block);
    let t = toml("\"http\"").replace("Weather", "Official WolOS Weather");
    assert!(has(
        &ck(&[("plugin.toml", t.as_bytes()), ("card.lua", LUA_OK)]),
        "doctrine/impersonation"
    ));
}

fn app(info: &str) -> Report {
    hubcheck::check(
        &Fixture::new().wol_with(info, b"payload", Signer::None),
        Kind::App,
    )
}

#[test]
fn app_files() {
    let f = Fixture::new();
    let ok = hubcheck::check(&f.wol("alice.notes", Signer::Alice), Kind::App);
    assert_eq!(ok.verdict, Verdict::Pass, "{ok:?}");
    // Manifest rules.
    let info =
        |s: &str| Fixture::info("alice.notes", "1.0").replace("\"capabilities\":[\"files\"]", s);
    assert!(has(
        &app(&info("\"capabilities\":[\"teleport\"]")),
        "manifest/capability"
    ));
    assert!(has(
        &app(&Fixture::info("alice.notes", "1.0").replace("Work", "Games")),
        "manifest/category"
    ));
    assert!(has(&app(&Fixture::info("notes", "1.0")), "manifest/id"));
    assert!(has(
        &app(&Fixture::info("alice.notes", "")),
        "manifest/version"
    ));
    assert!(has(
        &app(&Fixture::info("alice.notes", "1.0").replace("bin/notes", "../x")),
        "manifest/target"
    ));
    assert!(has(
        &app(&Fixture::info("alice.notes", "1.0").replace("Notes", "Hyprland Notes")),
        "doctrine/name"
    ));
    assert!(has(&app("{"), "manifest/syntax"));
    assert!(has(
        &app(&Fixture::info("alice.notes", "1.0").replace("\"package\":\"notes\",", "")),
        "manifest/package"
    ));
    // Shape: missing parts, wrong order, a damaged list, a changed file.
    let members = [("Info.json", b"{}".as_slice())];
    assert!(has(
        &hubcheck::check(&tar::build(&members), Kind::App),
        "file/members"
    ));
    let wol = f.wol("alice.notes", Signer::None);
    let mut bad = wol.clone();
    let at = bad
        .windows(11)
        .position(|w| w == b"pkg payload")
        .expect("payload");
    bad[at] ^= 1;
    let r = hubcheck::check(&bad, Kind::App);
    assert_eq!(r.verdict, Verdict::Block);
    assert!(has(&r, "file/hash"));
    assert!(has(
        &hubcheck::check(&wol[..wol.len() - 700], Kind::App),
        "file/format"
    ));
    assert!(has(
        &hubcheck::check(b"MZ not a tar at all", Kind::App),
        "file/format"
    ));
}

#[test]
fn validate_manifest_on_its_own() {
    let t = toml("\"http\"");
    assert_eq!(
        hubcheck::validate_manifest(&t, Kind::Plugin).verdict,
        Verdict::Pass
    );
    let r = hubcheck::validate_manifest("schema = 2\nid = \"x\"\n", Kind::Plugin);
    assert_eq!(r.verdict, Verdict::Block);
    assert!(has(&r, "manifest/schema") && has(&r, "manifest/id") && has(&r, "manifest/name"));
    let r = hubcheck::validate_manifest(
        "schema = 1\nid = \"alice.x\"\nname = \"X\"\nversion = \"1\"\nlicense = \"MIT\"\n[[widget]]\nid = \"w\"\nscript = \"../a.lua\"\nbogus = 1\n[[nothing]]\n[[look]]\nid = \"l\"\nfile = \"l.conf\"\n",
        Kind::Plugin,
    );
    for rule in [
        "manifest/path",
        "manifest/field",
        "manifest/section",
        "manifest/planned",
    ] {
        assert!(has(&r, rule), "{rule}: {r:?}");
    }
    let r = hubcheck::validate_manifest(
        "schema = 1\nid = \"alice.x\"\nname = \"X\"\nversion = \"1\"\nlicense = \"MIT\"\n[[dock]]\nid = \"d\"\nname = \"D\"\nicon = \"i\"\nexec = [\"firefox\"]\n",
        Kind::Plugin,
    );
    assert!(has(&r, "manifest/command"));
    let r = hubcheck::validate_manifest(
        "schema = 1\nid = \"alice.x\"\nname = \"X\"\nversion = \"1\"\nlicense = \"MIT\"\n",
        Kind::Plugin,
    );
    assert!(has(&r, "manifest/empty"));
    // Extension (draft): needs a host.
    let r = hubcheck::validate_manifest(
        "schema = 1\nid = \"alice.x\"\nname = \"X\"\nversion = \"1\"\nlicense = \"MIT\"\n",
        Kind::Extension,
    );
    assert!(has(&r, "manifest/host"));
    let r = hubcheck::validate_manifest(
        "schema = 1\nid = \"alice.x\"\nname = \"X\"\nversion = \"1\"\nlicense = \"MIT\"\nhost = \"org.example.Editor\"\n",
        Kind::Extension,
    );
    assert_eq!(r.verdict, Verdict::Pass, "{r:?}");
    assert_eq!(
        hubcheck::validate_manifest(&Fixture::info("alice.notes", "1.0"), Kind::App).verdict,
        Verdict::Pass
    );
}

#[test]
fn extension_files_use_the_same_shape() {
    let f = Fixture::new();
    let t = "schema = 1\nid = \"alice.ext\"\nname = \"Ext\"\nversion = \"1\"\nlicense = \"MIT\"\nhost = \"org.example.Editor\"\n";
    let bytes = f.plugin(
        "alice.ext",
        &[("extension.toml", t.as_bytes())],
        Signer::Alice,
    );
    let s = f.store();
    // Signed with the plugin label, so read as an extension the signature does not hold.
    let r = hubcheck::inspect(&bytes, Kind::Extension, &s.anchors, &s.revoked, f.now, None);
    assert_eq!(r.trust, hubcheck::Trust::Invalid);
    assert!(!has(&r, "manifest/missing"));
}

/// A zstd frame of `n` zero bytes (needs the encoder of the optional decoder crate).
#[cfg(feature = "zstd")]
fn zstd_zeros(n: usize) -> Vec<u8> {
    ruzstd::encoding::compress_to_vec(
        &vec![0u8; n][..],
        ruzstd::encoding::CompressionLevel::Fastest,
    )
}

#[cfg(feature = "zstd")]
#[test]
fn a_compressed_plugin_is_unpacked_and_a_bomb_is_refused() {
    let t = toml("\"http\"");
    let bytes = plugin(&[("plugin.toml", t.as_bytes()), ("card.lua", LUA_OK)]);
    assert_eq!(
        &bytes[..4],
        &[0x28, 0xb5, 0x2f, 0xfd],
        "the fixture is a zstd frame"
    );
    let r = hubcheck::check(&bytes, Kind::Plugin);
    assert!(!has(&r, "file/not-compressed"), "{r:?}");
    assert_eq!(rules_of(&r), Vec::<&str>::new());
    let bomb = zstd_zeros(5 << 20);
    assert!(bomb.len() <= 2 << 20, "{} bytes", bomb.len());
    let r = hubcheck::check(&bomb, Kind::Plugin);
    assert_eq!(
        (r.verdict, r.findings[0].rule.as_str()),
        (Verdict::Block, "file/too-large")
    );
    let mut cut = bytes.clone();
    cut.truncate(cut.len() / 2);
    assert_eq!(
        hubcheck::check(&cut, Kind::Plugin).findings[0].rule,
        "file/format"
    );
}

#[cfg(not(feature = "zstd"))]
#[test]
fn a_zstd_file_without_the_decoder_is_not_checked_not_passed() {
    let r = hubcheck::check(&[0x28, 0xb5, 0x2f, 0xfd, 0, 0, 0, 0], Kind::Plugin);
    assert_eq!(
        (r.verdict, r.findings[0].rule.as_str()),
        (Verdict::NotChecked, "file/compressed")
    );
}
