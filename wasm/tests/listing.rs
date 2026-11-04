// SPDX-License-Identifier: GPL-2.0-or-later
//! The listing facts read from the package (lead 02:33Z): text from the manifest, pictures from
//! the file, checked from their headers. Problems are notes: listed, verdict unchanged, the faulty
//! item left out of `facts`.
use hubcheck::fixtures::{Fixture, Signer, png, webp};
use hubcheck::{Kind, Report, Verdict};

fn rules(r: &Report) -> Vec<&str> {
    r.findings.iter().map(|f| f.rule.as_str()).collect()
}

fn info(extra: &str) -> String {
    format!(
        r#"{{"id":"alice.notes","version":"1.0","name":"Notes","summary":"Quick notes","categories":["Work","Create"],"package":"notes",{extra}"targets":[{{"abi":"linux","arch":"amd64","entry":"bin/notes"}}]}}"#
    )
}

fn wol(info: &str, icon: Option<&[u8]>, shots: &[(&str, &[u8])]) -> Report {
    let f = Fixture::new();
    hubcheck::check(
        &f.wol_listing(info, icon, shots, b"payload", Signer::None, None),
        Kind::App,
    )
}

#[test]
fn an_app_lists_what_its_info_json_and_pictures_say() {
    let icon = png(512, 512);
    let s1 = png(1280, 800);
    let s2 = webp(1920, 1080);
    let i = info(
        r#""description":"Write things down.\nFind them again.","homepage":"https://example.org/notes","license":"GPL-3.0-or-later","screenshots":["screenshots/1.png","screenshots/dark.webp"],"#,
    );
    let r = wol(
        &i,
        Some(&icon),
        &[("screenshots/1.png", &s1), ("screenshots/dark.webp", &s2)],
    );
    assert_eq!(r.verdict, Verdict::Pass, "{r:?}");
    assert!(r.findings.is_empty(), "{r:?}");
    let f = r.facts.expect("facts");
    assert_eq!(
        (f.name.as_str(), f.summary.as_str()),
        ("Notes", "Quick notes")
    );
    assert_eq!(
        f.description.as_deref(),
        Some("Write things down.\nFind them again.")
    );
    assert_eq!(f.categories, ["Work", "Create"]);
    assert_eq!(f.homepage.as_deref(), Some("https://example.org/notes"));
    assert_eq!(f.licence.as_deref(), Some("GPL-3.0-or-later"));
    let ic = f.icon.expect("icon");
    assert_eq!(
        (ic.path.as_str(), ic.mime.as_str(), ic.w, ic.h, ic.size),
        ("icon.png", "image/png", 512, 512, icon.len() as u64)
    );
    assert_eq!(ic.sha256, hubcheck::files::sha256_hex(&icon));
    let shots: Vec<_> = f
        .screenshots
        .iter()
        .map(|s| (s.path.as_str(), s.mime.as_str(), s.w, s.h))
        .collect();
    assert_eq!(
        shots,
        [
            ("screenshots/1.png", "image/png", 1280, 800),
            ("screenshots/dark.webp", "image/webp", 1920, 1080)
        ]
    );
    // The JSON shape of interface I7: facts after file, empty lists kept, absent texts left out.
    let json = hubcheck::api::check_json(
        &Fixture::new().wol_listing(&info(""), Some(&icon), &[], b"p", Signer::None, None),
        "app",
    );
    assert!(
        json.ends_with(&format!(
            r#""file":{{"id":"alice.notes","version":"1.0"}},"facts":{{"name":"Notes","summary":"Quick notes","icon":{{"path":"icon.png","mime":"image/png","w":512,"h":512,"size":{},"sha256":"{}"}},"screenshots":[],"categories":["Work","Create"]}}}}"#,
            icon.len(),
            ic.sha256
        )),
        "{json}"
    );
}

#[test]
fn a_missing_or_bad_icon_is_a_note_and_is_left_out() {
    let r = wol(&info(""), None, &[]);
    assert_eq!(r.verdict, Verdict::Pass);
    assert_eq!(rules(&r), ["listing/icon-missing"]);
    assert!(r.facts.unwrap().icon.is_none());
    for (bad, why) in [
        (png(300, 200), "square"),
        (png(64, 64), "128 to 1024"),
        (png(2048, 2048), "more than 1 MB"),
        (webp(256, 256), "does not end in .webp"),
        (
            b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>".to_vec(),
            "SVG",
        ),
        (b"\x89PNG\r\n\x1a\nxxxx".to_vec(), "damaged"),
        (b"\x7fELF\x02\x01\x01".to_vec(), "not a PNG or WebP"),
    ] {
        let r = wol(&info(""), Some(&bad), &[]);
        assert_eq!(r.verdict, Verdict::Pass, "{r:?}");
        assert_eq!(rules(&r), ["listing/icon"], "{why}");
        assert!(r.findings[0].sentence.contains(why), "{why}: {r:?}");
        assert!(r.facts.unwrap().icon.is_none());
    }
    let mut apng = png(256, 256);
    // An acTL chunk before IDAT makes it an animated PNG.
    let at = 8 + 25;
    apng.splice(
        at..at,
        [
            0, 0, 0, 8, b'a', b'c', b'T', b'L', 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
    );
    let r = wol(&info(""), Some(&apng), &[]);
    assert!(r.findings[0].sentence.contains("animated"), "{r:?}");
}

#[test]
fn screenshots_are_checked_named_and_capped() {
    let icon = png(256, 256);
    let good = png(640, 400);
    let tiny = png(100, 100);
    let i =
        info(r#""screenshots":["screenshots/a.png","screenshots/b.png","screenshots/gone.png"],"#);
    let r = wol(
        &i,
        Some(&icon),
        &[
            ("screenshots/a.png", &good),
            ("screenshots/b.png", &tiny),
            ("screenshots/extra.png", &good),
        ],
    );
    assert_eq!(r.verdict, Verdict::Pass, "{r:?}");
    assert_eq!(
        rules(&r),
        [
            "listing/screenshot",
            "listing/screenshot",
            "listing/screenshot"
        ],
        "{r:?}"
    );
    let ev: Vec<_> = r.findings.iter().map(|f| f.evidence.as_str()).collect();
    assert_eq!(
        ev,
        [
            "screenshots/extra.png",
            "screenshots/b.png",
            "screenshots/gone.png"
        ]
    );
    assert_eq!(r.facts.unwrap().screenshots.len(), 1);
    // More than eight screenshot members, a bad member name or the wrong place is the file's shape.
    let nine: Vec<(String, Vec<u8>)> = (0..9)
        .map(|n| (format!("screenshots/{n}.png"), good.clone()))
        .collect();
    let nine: Vec<(&str, &[u8])> = nine
        .iter()
        .map(|(n, b)| (n.as_str(), b.as_slice()))
        .collect();
    let r = wol(&info(""), Some(&icon), &nine);
    assert_eq!(r.verdict, Verdict::Block);
    assert!(rules(&r).contains(&"file/members"));
    for name in [
        "screenshots/../x.png",
        "screenshots/A.png",
        "screenshots/a.gif",
        "shots/a.png",
    ] {
        let r = wol(&info(""), Some(&icon), &[(name, &good)]);
        assert_eq!(r.verdict, Verdict::Block, "{name}");
    }
}

#[test]
fn listing_text_that_does_not_fit_is_left_out() {
    let long = "x".repeat(4001);
    let i = info(&format!(
        r#""description":"{long}","homepage":"http://example.org","license":"a\u0007b","#
    ));
    let r = wol(&i, Some(&png(256, 256)), &[]);
    assert_eq!(r.verdict, Verdict::Pass);
    assert_eq!(
        rules(&r),
        ["listing/description", "listing/homepage", "listing/licence"]
    );
    let f = r.facts.unwrap();
    assert!(f.description.is_none() && f.homepage.is_none() && f.licence.is_none());
    let r = wol(
        &info(r#""description":7,"screenshots":"x","#),
        Some(&png(256, 256)),
        &[],
    );
    assert_eq!(rules(&r), ["listing/field", "listing/field"]);
    // The doctrine reads the description like the name and the summary.
    let r = wol(
        &info(r#""description":"Made for Hyprland.","#),
        Some(&png(256, 256)),
        &[],
    );
    assert!(
        rules(&r).iter().any(|x| x.starts_with("doctrine/")),
        "{r:?}"
    );
}

fn plugin_toml(listing: &str, min: &str) -> String {
    format!(
        "schema = 1\nid = \"alice.weather\"\nname = \"Weather\"\nversion = \"1.0\"\nlicense = \"MIT\"\ndescription = \"Shows the weather\"\n{min}permissions = [\"http\"]\n{listing}\n[[widget]]\nid = \"card\"\nscript = \"card.lua\"\nsizes = [\"small\"]\n"
    )
}

const LUA: &[u8] = b"local r = wol.http_get('https://example.org')\nreturn wol.widget { render = function() return r end }\n";

#[test]
fn a_plugin_lists_its_header_keys_and_folder_pictures() {
    let icon = webp(256, 256);
    let shot = png(800, 600);
    for kind in [Kind::Plugin, Kind::Extension] {
        let listing = "icon = \"art/icon.webp\"\nscreenshots = [\"art/1.png\"]\ncategories = [\"Work\"]\nhomepage = \"https://example.org\"\nabout = \"Line one.\\nLine two.\"\n";
        let (name, host) = if kind == Kind::Plugin {
            ("plugin.toml", "")
        } else {
            ("extension.toml", "host = \"org.example.Editor\"\n")
        };
        let mut t = plugin_toml(listing, &format!("min_wolos = \"0.13\"\n{host}"));
        if kind == Kind::Extension {
            t = t.replace("permissions = [\"http\"]\n", "");
            t = t.split("[[widget]]").next().unwrap().to_owned();
        }
        let files: Vec<(&str, &[u8])> = vec![
            (name, t.as_bytes()),
            ("card.lua", LUA),
            ("art/icon.webp", &icon),
            ("art/1.png", &shot),
        ];
        let r = hubcheck::check(
            &Fixture::new().plugin("alice.weather", &files, Signer::None),
            kind,
        );
        let f = r.facts.clone().expect("facts");
        assert_eq!(f.summary, "Shows the weather");
        assert_eq!(f.description.as_deref(), Some("Line one.\nLine two."));
        assert_eq!(f.categories, ["Work"]);
        assert_eq!(f.licence.as_deref(), Some("MIT"));
        assert_eq!(
            f.icon.as_ref().map(|i| (i.w, i.mime.as_str())),
            Some((256, "image/webp"))
        );
        assert_eq!(f.screenshots.len(), 1);
        assert!(
            !rules(&r)
                .iter()
                .any(|x| x.starts_with("listing/") || x.starts_with("manifest/")),
            "{kind:?} {r:?}"
        );
    }
    // Without min_wolos 0.13 the new header keys are flagged: older systems refuse them.
    let t = plugin_toml("icon = \"i.png\"\n", "");
    let r = hubcheck::check(
        &Fixture::new().plugin(
            "alice.weather",
            &[
                ("plugin.toml", t.as_bytes()),
                ("card.lua", LUA),
                ("i.png", &png(256, 256)),
            ],
            Signer::None,
        ),
        Kind::Plugin,
    );
    assert!(rules(&r).contains(&"manifest/min-wolos"), "{r:?}");
    // A named icon that is not there, and paths that leave the folder.
    let t = plugin_toml(
        "icon = \"gone.png\"\nscreenshots = [\"../x.png\"]\ncategories = [\"Games\"]\n",
        "min_wolos = \"0.13\"\n",
    );
    let r = hubcheck::check(
        &Fixture::new().plugin(
            "alice.weather",
            &[("plugin.toml", t.as_bytes()), ("card.lua", LUA)],
            Signer::None,
        ),
        Kind::Plugin,
    );
    let got = rules(&r);
    for want in ["listing/icon", "manifest/path", "manifest/category"] {
        assert!(got.contains(&want), "{want}: {r:?}");
    }
}

#[test]
fn extract_returns_the_checked_pictures_by_hash() {
    let icon = png(256, 256);
    let shot = webp(1280, 720);
    let bad = png(10, 10);
    let i = info(r#""screenshots":["screenshots/1.webp","screenshots/2.png"],"#);
    let bytes = Fixture::new().wol_listing(
        &i,
        Some(&icon),
        &[("screenshots/1.webp", &shot), ("screenshots/2.png", &bad)],
        b"p",
        Signer::None,
        None,
    );
    let (facts, out) = hubcheck::files::extract(&bytes, Kind::App).expect("facts");
    assert_eq!(facts.screenshots.len(), 1);
    let names: Vec<_> = out.iter().map(|(n, b)| (n.clone(), b.len())).collect();
    assert_eq!(
        names,
        [
            (
                format!("{}.png", hubcheck::files::sha256_hex(&icon)),
                icon.len()
            ),
            (
                format!("{}.webp", hubcheck::files::sha256_hex(&shot)),
                shot.len()
            ),
        ]
    );
    assert!(hubcheck::files::extract(b"not a tar", Kind::App).is_none());
}
