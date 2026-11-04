// SPDX-License-Identifier: GPL-2.0-or-later
//! The command the check job runs: the same functions as the browser module, printing the same
//! JSON (interface I7) on one line. `hubcheck check|inspect|verify|manifest <kind> <file>`.
//! Exit status 0 whenever a report was printed; 2 for a wrong command line; 1 when a file cannot be read.
#![forbid(unsafe_code)]
use hubcheck::api;
use std::io::Read;
use std::process::ExitCode;

const USAGE: &str = "usage:
  hubcheck check <app|plugin|extension> <file>
  hubcheck manifest <app|plugin|extension> <file|->
  hubcheck verify <app|plugin|extension> <file> --store <store.json> [--now <unix seconds>] [--first-seen <unix seconds>] [--file-cert <file>]
  hubcheck inspect <app|plugin|extension> <file> --store <store.json> [--now <unix seconds>] [--first-seen <unix seconds>] [--file-cert <file>]
  hubcheck extract <file> --out <dir> [--kind <app|plugin|extension>]
  hubcheck version";

/// Reads at most `max` + 1 bytes of `path` (`-` is standard input).
fn read(path: &str, max: usize) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let limit = max as u64 + 1;
    let n = if path == "-" {
        std::io::stdin().lock().take(limit).read_to_end(&mut out)
    } else {
        std::fs::File::open(path)
            .map_err(|e| format!("{path}: {e}"))?
            .take(limit)
            .read_to_end(&mut out)
    };
    n.map_err(|e| format!("{path}: {e}"))?;
    Ok(out)
}

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

fn number(args: &[String], name: &str) -> Result<Option<u64>, String> {
    flag(args, name)
        .map(|v| {
            v.parse::<u64>()
                .map_err(|_| format!("{name} needs a whole number"))
        })
        .transpose()
}

fn run(args: &[String]) -> Result<String, (u8, String)> {
    let usage = |m: &str| (2u8, format!("{m}\n{USAGE}"));
    let io = |m: String| (1u8, m);
    let cmd = args.first().map(String::as_str).unwrap_or_default();
    if cmd == "version" {
        return Ok(api::version());
    }
    if cmd == "extract" {
        return extract(args).map_err(|(c, m)| if c == 2 { usage(&m) } else { (c, m) });
    }
    #[cfg(feature = "dev")]
    if matches!(cmd, "vectors" | "fixtures") {
        let dir = args.get(1).ok_or_else(|| usage("a folder is needed"))?;
        return dev(cmd, dir).map_err(io);
    }
    let (Some(kind), Some(file)) = (args.get(1), args.get(2)) else {
        return Err(usage("a kind and a file are needed"));
    };
    match cmd {
        "check" => Ok(api::check_json(
            &read(file, hubcheck::files::MAX_WOL).map_err(io)?,
            kind,
        )),
        "manifest" => {
            let b = read(file, hubcheck::toml::MAX_TEXT).map_err(io)?;
            let text = String::from_utf8_lossy(&b);
            Ok(api::manifest_json(&text, kind))
        }
        "verify" | "inspect" => {
            let store_path = flag(args, "--store").ok_or_else(|| usage("--store is needed"))?;
            let store =
                String::from_utf8_lossy(&read(&store_path, 16 << 20).map_err(io)?).into_owned();
            let now = number(args, "--now")
                .map_err(|e| usage(&e))?
                .unwrap_or_else(|| {
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map_or(0, |d| d.as_secs())
                });
            let seen = number(args, "--first-seen").map_err(|e| usage(&e))?;
            let fc = flag(args, "--file-cert")
                .map(|p| read(&p, woltrust::filecert::MAX_FILE).map_err(io))
                .transpose()?;
            let bytes = read(file, hubcheck::files::MAX_WOL).map_err(io)?;
            Ok(if cmd == "verify" {
                api::verify_json(&bytes, kind, &store, now, seen, fc.as_deref())
            } else {
                api::inspect_json(&bytes, kind, &store, now, seen, fc.as_deref())
            })
        }
        _ => Err(usage("unknown command")),
    }
}

/// The kind a file name says: `.wol`, `.wolplug`, `.wolext`.
fn kind_of_name(file: &str) -> Option<&'static str> {
    let n = file.to_ascii_lowercase();
    [
        (".wol", "app"),
        (".wolplug", "plugin"),
        (".wolext", "extension"),
    ]
    .into_iter()
    .find(|(e, _)| n.ends_with(e))
    .map(|(_, k)| k)
}

/// `extract <file> --out <dir>`: writes the checked icon and screenshots as `<sha256>.<png|webp>`
/// into `dir` (made when missing) and prints `{"verdict", "facts", "written"}`. The pipeline puts
/// the written files on the CDN; this command never uses the network.
fn extract(args: &[String]) -> Result<String, (u8, String)> {
    let file = args
        .get(1)
        .filter(|a| !a.starts_with("--"))
        .ok_or((2, "a file is needed".to_owned()))?;
    let out = flag(args, "--out").ok_or((2, "--out is needed".to_owned()))?;
    let kind_text = match flag(args, "--kind") {
        Some(k) => k,
        None => kind_of_name(file)
            .ok_or((
                2,
                "--kind is needed: the name does not end in .wol, .wolplug or .wolext".to_owned(),
            ))?
            .to_owned(),
    };
    let kind = hubcheck::Kind::parse(&kind_text)
        .ok_or((2, "the kind must be app, plugin or extension".to_owned()))?;
    let bytes = read(file, hubcheck::files::MAX_WOL).map_err(|e| (1, e))?;
    let verdict = hubcheck::check(&bytes, kind).verdict;
    let (facts, pictures) = hubcheck::files::extract(&bytes, kind).ok_or((
        1,
        format!("{file}: no listing facts, the manifest could not be read"),
    ))?;
    let dir = std::path::Path::new(&out);
    std::fs::create_dir_all(dir).map_err(|e| (1, format!("{out}: {e}")))?;
    let mut written = Vec::new();
    for (name, b) in &pictures {
        // Names are <64 hex>.<png|webp>, made here: nothing from the file reaches the path.
        std::fs::write(dir.join(name), b).map_err(|e| (1, format!("{name}: {e}")))?;
        written.push(name.clone());
    }
    #[derive(serde::Serialize)]
    struct Extracted {
        verdict: hubcheck::Verdict,
        facts: hubcheck::Facts,
        written: Vec<String>,
    }
    serde_json::to_string(&Extracted {
        verdict,
        facts,
        written,
    })
    .map_err(|e| (1, e.to_string()))
}

/// `vectors <dir>` replays the trust crate's recorded vectors; `fixtures <dir>` writes the test files.
#[cfg(feature = "dev")]
fn dev(cmd: &str, dir: &str) -> Result<String, String> {
    use hubcheck::fixtures::{Fixture, Signer};
    let dir = std::path::Path::new(dir);
    if cmd == "fixtures" {
        let f = Fixture::new();
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let toml = Fixture::plugin_toml("alice.weather", "\"http\"");
        let lua = "local r = wol.http_get('https://example.org/w')\nreturn wol.widget { render = function() return wol.text(r) end }\n";
        let files: Vec<(&str, Vec<u8>)> = vec![
            ("person.wol", f.wol("alice.notes", Signer::Alice)),
            ("org.wol", f.wol("examplelabs.tool", Signer::Org)),
            ("wolos.wol", f.wol("org.wolos.notes", Signer::Wolos)),
            ("unsigned.wol", f.wol("alice.notes", Signer::None)),
            ("namespace.wol", f.wol("bob.notes", Signer::Alice)),
            (
                "origin.wol",
                f.wol_origin(
                    &Fixture::info("alice.notes", "1.0"),
                    b"pkg payload bytes",
                    Signer::Alice,
                    Some(&Fixture::origin("alice")),
                ),
            ),
            (
                "weather.wolplug",
                f.plugin(
                    "alice.weather",
                    &[
                        ("plugin.toml", toml.as_bytes()),
                        ("card.lua", lua.as_bytes()),
                    ],
                    Signer::Alice,
                ),
            ),
            (
                "listing.wol",
                f.wol_listing(
                    &Fixture::info("alice.notes", "1.0").replace(
                        "\"package\"",
                        "\"description\":\"Write it down.\\nFind it again.\",\"homepage\":\"https://example.org/notes\",\"license\":\"MIT\",\"screenshots\":[\"screenshots/1.png\",\"screenshots/2.webp\",\"screenshots/small.png\"],\"package\"",
                    ),
                    Some(&hubcheck::fixtures::png(256, 256)),
                    &[
                        ("screenshots/1.png", &hubcheck::fixtures::png(640, 400)),
                        ("screenshots/2.webp", &hubcheck::fixtures::webp(1280, 800)),
                        ("screenshots/small.png", &hubcheck::fixtures::png(32, 32)),
                    ],
                    b"pkg payload bytes",
                    Signer::Alice,
                    None,
                ),
            ),
            ("trusted.wol", f.wol("alice.notes", Signer::AliceTrusted)),
            (
                "person.filecert",
                f.file_cert(
                    &f.wol("alice.notes", Signer::Alice),
                    "alice.notes",
                    "1.0",
                    "a1b2c3d4e5f60718",
                ),
            ),
            ("store.json", f.store_json().into_bytes()),
            ("now.txt", f.now.to_string().into_bytes()),
        ];
        for (name, bytes) in &files {
            std::fs::write(dir.join(name), bytes).map_err(|e| format!("{name}: {e}"))?;
        }
        return Ok(format!("{} files written", files.len()));
    }
    let pki =
        std::fs::read_to_string(dir.join("pki.json")).map_err(|e| format!("pki.json: {e}"))?;
    let mut names: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".json") && n != "pki.json")
        .collect();
    names.sort();
    for n in &names {
        let text = std::fs::read_to_string(dir.join(n)).map_err(|e| format!("{n}: {e}"))?;
        let why = api::replay_vector(&pki, &text);
        if !why.is_empty() {
            return Err(format!("{n}: {why}"));
        }
    }
    Ok(format!(
        "{} vectors replay to their recorded results",
        names.len()
    ))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(text) => {
            println!("{text}");
            ExitCode::SUCCESS
        }
        Err((code, msg)) => {
            eprintln!("hubcheck: {msg}");
            ExitCode::from(code)
        }
    }
}
