// SPDX-License-Identifier: GPL-2.0-or-later
//! The rule analysis of a `.wol`, a `.wolplug` or an extension, from its bytes: the archive and its
//! hashes, the manifest, the declared permissions against the files present, forbidden paths, size
//! caps, compiled programs and scripts inside, and the Wonderland Doctrine on names. Pure: bytes in,
//! findings out; nothing is written, run or fetched, and every loop is bounded by the caps below.
use crate::manifest::{self, Plugin};
use crate::report::{FileId, Report, Trust};
use crate::rules::{Kind, Rules};
use crate::tar::{self, Member};
use sha2::{Digest, Sha256};
use std::borrow::Cow;

/// Largest `.wol` read: the hub downloads at most 1 GiB (ADR 0047, H6).
pub const MAX_WOL: usize = 1 << 30;
/// Largest `.wolplug` file (zstd-compressed) and extension file.
pub const MAX_PLUG_FILE: usize = 2 << 20;
/// Largest decompressed `.wolplug` tar.
pub const MAX_PLUG_TAR: usize = 4 << 20;
/// Whole plugin folder, every file counted.
pub const MAX_PLUG_TOTAL: usize = 1 << 20;
/// One file of a plugin.
pub const MAX_PLUG_FILE_ITEM: usize = 256 * 1024;
/// Files in a plugin.
pub const MAX_PLUG_FILES: usize = 256;
/// `Info.json`, `SHA256` and icon read into memory.
const MAX_SMALL: usize = 1 << 20;

const MANIFEST: &str = "SHA256";
const SIG: &str = "SHA256.sig";
/// The signature members after `SHA256`, in order.
pub const CHAIN: &str = "CHAIN";
/// The hybrid signature member.
pub const WSIG: &str = "SHA256.wsig";

/// Why a file could not be opened as an archive.
#[derive(Debug)]
pub struct Refusal {
    /// Rule id.
    pub rule: &'static str,
    /// What a person reads.
    pub sentence: &'static str,
    /// What was seen.
    pub evidence: String,
    /// True when the file could not be looked at (too large, no decompressor): `not-checked`.
    pub unchecked: bool,
}

fn refuse(rule: &'static str, sentence: &'static str, evidence: &str, unchecked: bool) -> Refusal {
    Refusal {
        rule,
        sentence,
        evidence: evidence.to_owned(),
        unchecked,
    }
}

/// An opened archive.
pub struct Loaded<'a> {
    /// Plain tar bytes (decompressed for a `.wolplug`).
    pub tar: Cow<'a, [u8]>,
    /// Its members.
    pub members: Vec<Member>,
    /// True when the bytes were a plain tar where a compressed one is the format.
    pub plain_plugin: bool,
}

impl Loaded<'_> {
    /// Bytes of a member.
    pub fn bytes(&self, m: &Member) -> &[u8] {
        &self.tar[m.at.clone()]
    }

    /// Bytes of the member called `name`.
    pub fn get(&self, name: &str) -> Option<&[u8]> {
        self.members
            .iter()
            .find(|m| m.name == name)
            .map(|m| self.bytes(m))
    }
}

fn is_zstd(b: &[u8]) -> bool {
    b.starts_with(&[0x28, 0xb5, 0x2f, 0xfd])
}

#[cfg(feature = "zstd")]
fn unzstd(b: &[u8]) -> Result<Vec<u8>, Refusal> {
    use std::io::Read;
    let damaged = || {
        refuse(
            "file/format",
            "The file is damaged: it could not be unpacked.",
            "zstd",
            false,
        )
    };
    let mut d = ruzstd::decoding::StreamingDecoder::new(b).map_err(|_| damaged())?;
    let mut out = Vec::new();
    (&mut d)
        .take(MAX_PLUG_TAR as u64 + 1)
        .read_to_end(&mut out)
        .map_err(|_| damaged())?;
    if out.len() > MAX_PLUG_TAR {
        return Err(refuse(
            "file/too-large",
            "The file unpacks to more than 4 MB, more than a plugin may hold.",
            "",
            false,
        ));
    }
    Ok(out)
}

#[cfg(not(feature = "zstd"))]
fn unzstd(_: &[u8]) -> Result<Vec<u8>, Refusal> {
    Err(refuse(
        "file/compressed",
        "This check cannot unpack the file, so it was not looked at.",
        "zstd",
        true,
    ))
}

/// Opens `bytes` as the archive of `kind`.
pub fn load(bytes: &[u8], kind: Kind) -> Result<Loaded<'_>, Refusal> {
    let (tar, plain_plugin): (Cow<[u8]>, bool) = if kind == Kind::App {
        if bytes.len() > MAX_WOL {
            return Err(refuse(
                "file/too-large",
                "The file is larger than 1 GB, more than this check reads.",
                &format!("{} bytes", bytes.len()),
                true,
            ));
        }
        (Cow::Borrowed(bytes), false)
    } else {
        if bytes.len() > MAX_PLUG_FILE {
            return Err(refuse(
                "file/too-large",
                "The file is larger than 2 MB, more than a plugin or an extension may be.",
                &format!("{} bytes", bytes.len()),
                false,
            ));
        }
        if is_zstd(bytes) {
            (Cow::Owned(unzstd(bytes)?), false)
        } else {
            (Cow::Borrowed(bytes), true)
        }
    };
    let members = tar::members(&tar).map_err(|e| {
        refuse(
            "file/format",
            "The file is damaged or is not the kind of file it says.",
            e,
            false,
        )
    })?;
    Ok(Loaded {
        tar,
        members,
        plain_plugin,
    })
}

/// SHA-256 as lowercase hex.
pub fn sha256_hex(b: &[u8]) -> String {
    Sha256::digest(b)
        .iter()
        .map(|x| format!("{x:02x}"))
        .collect()
}

/// The doctrine rule on a display name and a summary.
pub fn name_rules(name: &str, summary: &str, r: &mut Rules) {
    for (field, text) in [("name", name), ("summary", summary)] {
        for (rule, sentence, evidence) in crate::doctrine::check(field, text) {
            r.flag(rule, &sentence, evidence);
        }
    }
}

fn parse_sums(text: &str) -> Option<Vec<(&str, &str)>> {
    text.lines()
        .map(|l| l.strip_prefix("SHA256 (")?.split_once(") = "))
        .collect()
}

/// Every hashed member must be listed once with its hash, and nothing else may be listed.
fn hashes(l: &Loaded, hashed: &[&Member], r: &mut Rules) {
    let bad = |r: &mut Rules, why: &str| {
        r.broken(
            "file/hash",
            "The list of checksums inside the file does not match the files.",
            why,
        );
    };
    let Some(man) = l.get(MANIFEST) else {
        bad(r, "no SHA256 list");
        return;
    };
    if man.len() > MAX_SMALL {
        bad(r, "the list is too large");
        return;
    }
    let Some(lines) = std::str::from_utf8(man).ok().and_then(parse_sums) else {
        bad(r, "the list is damaged");
        return;
    };
    if lines.len() != hashed.len() {
        bad(
            r,
            &format!("{} lines for {} files", lines.len(), hashed.len()),
        );
        return;
    }
    for m in hashed {
        let mut found = lines.iter().filter(|(n, _)| *n == m.name);
        match (found.next(), found.next()) {
            (Some((_, h)), None) => {
                if *h != sha256_hex(l.bytes(m)) {
                    r.broken(
                        "file/hash",
                        "A file inside does not match its checksum, so it was changed after it was packed.",
                        m.name.clone(),
                    );
                }
            }
            _ => bad(r, &m.name),
        }
    }
}

/// Checks `bytes` as a file of `kind` and returns the I7 report (`trust` is `community`: nothing is
/// verified here; see [`crate::trust`]).
pub fn check(bytes: &[u8], kind: Kind) -> Report {
    analyse(bytes, kind).report(Trust::Community)
}

/// The findings of [`check`], for callers that add to them.
pub fn analyse(bytes: &[u8], kind: Kind) -> Rules {
    let mut r = Rules::default();
    match load(bytes, kind) {
        Err(f) => {
            if f.unchecked {
                r.unchecked(f.rule, f.sentence, f.evidence);
            } else {
                r.broken(f.rule, f.sentence, f.evidence);
            }
        }
        Ok(l) => {
            if kind == Kind::App {
                app(&l, &mut r);
            } else {
                folder(&l, kind, &mut r);
            }
        }
    }
    r
}

const APP_ORDER: [(&str, bool); 7] = [
    ("Info.json", true),
    ("icon.png", false),
    ("payload.pkg", true),
    (MANIFEST, true),
    (SIG, false),
    (CHAIN, false),
    (WSIG, false),
];

fn app(l: &Loaded, r: &mut Rules) {
    // Exactly the contract members, each once, in contract order.
    let mut want = APP_ORDER.iter();
    for m in &l.members {
        loop {
            match want.next() {
                Some((n, _)) if *n == m.name => break,
                Some((_, false)) => {}
                _ => {
                    r.broken(
                        "file/members",
                        "The file holds a part that does not belong, or holds the parts in the wrong order.",
                        m.name.clone(),
                    );
                    return;
                }
            }
        }
    }
    for (n, required) in APP_ORDER {
        if required && l.get(n).is_none() {
            r.broken(
                "file/members",
                "The file lacks a part every app file has.",
                n,
            );
            return;
        }
    }
    size_caps(l, r);
    let hashed: Vec<&Member> = l
        .members
        .iter()
        .filter(|m| ![MANIFEST, SIG, CHAIN, WSIG].contains(&m.name.as_str()))
        .collect();
    hashes(l, &hashed, r);
    if let Some(sig) = l.get(SIG)
        && sig.len() != 64
    {
        r.broken(
            "file/signature",
            "The old-style signature in the file is damaged.",
            format!("{} bytes", sig.len()),
        );
    }
    if let Some(png) = l.get("icon.png")
        && !png.starts_with(b"\x89PNG\r\n\x1a\n")
    {
        r.flag(
            "file/icon",
            "The icon is not a PNG picture, so it may not show.",
            "icon.png",
        );
    }
    if l.get("payload.pkg").is_some_and(<[u8]>::is_empty) {
        r.block(
            "file/payload",
            "The app holds no program files.",
            "payload.pkg",
        );
    }
    let Some(info) = l.get("Info.json") else {
        return;
    };
    let Some(text) = std::str::from_utf8(info).ok() else {
        r.broken("manifest/syntax", "Info.json is not text.", "");
        return;
    };
    if let Some(a) = manifest::read_app(text, r) {
        r.file = FileId::of(&a.id, &a.version);
        if let Some(v) = serde_json::from_str::<serde_json::Value>(text).ok()
            && v.get("package")
                .and_then(serde_json::Value::as_str)
                .is_none_or(str::is_empty)
        {
            r.block(
                "manifest/package",
                "Info.json names no package, so there is nothing to install.",
                "",
            );
        }
        name_rules(&a.name, &a.summary, r);
    }
}

/// Members that carry the cap rules of the system's own reader.
fn size_caps(l: &Loaded, r: &mut Rules) {
    for (name, what) in [("Info.json", "Info.json"), (MANIFEST, "The checksum list")] {
        if l.get(name).is_some_and(|b| b.len() > MAX_SMALL) {
            r.broken(
                "size/part",
                &format!("{what} is larger than 1 MB, more than the system reads."),
                name,
            );
        }
    }
    if l.get("icon.png").is_some_and(|b| b.len() > MAX_SMALL) {
        r.flag("size/part", "The icon is larger than 1 MB.", "icon.png");
    }
    if l.get(CHAIN)
        .is_some_and(|b| b.len() > woltrust::MAX_CHAIN_BYTES)
    {
        r.broken(
            "size/part",
            "The signer's certificates take more than 64 KB.",
            CHAIN,
        );
    }
    if l.get(WSIG).is_some_and(|b| b.len() > woltrust::MAX_WSIG) {
        r.broken("size/part", "The signature takes more than 16 KB.", WSIG);
    }
}

// ---- plugins and extensions ----

/// The ADR 0046 members that may follow `SHA256` in a `.wolplug` or extension, in order.
const TAIL: [&str; 3] = [SIG, CHAIN, WSIG];

/// Folder files and the members after the list.
pub struct Split<'a> {
    /// `<id>/<file>` members.
    pub files: Vec<&'a Member>,
}

fn split<'a>(l: &'a Loaded, r: &mut Rules) -> Option<Split<'a>> {
    let Some(at) = l.members.iter().position(|m| m.name == MANIFEST) else {
        r.broken(
            "file/members",
            "The file has no list of checksums at its end.",
            MANIFEST,
        );
        return None;
    };
    let mut tail = TAIL.iter();
    for m in &l.members[at + 1..] {
        if !tail.any(|t| *t == m.name) {
            r.broken(
                "file/members",
                "The file holds a part that does not belong, or holds the parts in the wrong order.",
                m.name.clone(),
            );
            return None;
        }
    }
    Some(Split {
        files: l.members[..at].iter().collect(),
    })
}

fn is_text_secret_name(rel: &str) -> bool {
    let n = rel.rsplit('/').next().unwrap_or(rel).to_lowercase();
    n.starts_with("id_rsa")
        || n.starts_with("id_ed25519")
        || n.starts_with("id_ecdsa")
        || [".pem", ".key", ".p12", ".pfx", ".kdbx", ".keystore"]
            .iter()
            .any(|e| n.ends_with(e))
}

/// A compiled program or a bundle that hides files, by its first bytes or its name.
pub fn binary_kind(name: &str, b: &[u8]) -> Option<&'static str> {
    let n = name.to_lowercase();
    if b.starts_with(&[0x7f, b'E', b'L', b'F']) {
        return Some("a Linux program");
    }
    if b.starts_with(b"MZ")
        && b.get(0x3c..0x40).is_some_and(|o| {
            let at = u32::from_le_bytes([o[0], o[1], o[2], o[3]]) as usize;
            b.get(at..at + 4) == Some(b"PE\0\0")
        })
    {
        return Some("a Windows program");
    }
    if [
        [0xfe, 0xed, 0xfa, 0xce],
        [0xfe, 0xed, 0xfa, 0xcf],
        [0xce, 0xfa, 0xed, 0xfe],
        [0xcf, 0xfa, 0xed, 0xfe],
        [0xca, 0xfe, 0xba, 0xbe],
    ]
    .iter()
    .any(|m| b.starts_with(m))
    {
        return Some("a macOS or Java program");
    }
    if b.starts_with(&[0x00, b'a', b's', b'm']) {
        return Some("a WebAssembly program");
    }
    if b.starts_with(b"!<arch>\n") {
        return Some("a library archive");
    }
    if b.starts_with(b"PK\x03\x04")
        || b.starts_with(&[0x1f, 0x8b])
        || b.starts_with(&[0xfd, b'7', b'z', b'X', b'Z', 0])
        || b.starts_with(&[b'7', b'z', 0xbc, 0xaf, 0x27, 0x1c])
        || b.starts_with(b"Rar!")
        || is_zstd(b)
    {
        return Some("a packed archive");
    }
    [
        ".so",
        ".dll",
        ".exe",
        ".dylib",
        ".a",
        ".o",
        ".wasm",
        ".jar",
        ".apk",
        ".deb",
        ".rpm",
        ".appimage",
        ".msi",
        ".bin",
    ]
    .iter()
    .any(|e| n.ends_with(e) || n.contains(&format!("{e}.")))
    .then_some("a compiled program")
}

/// A script for a shell or another language that a plugin does not run through its manifest.
pub fn is_foreign_script(name: &str, b: &[u8]) -> bool {
    let n = name.to_lowercase();
    b.starts_with(b"#!")
        || [
            ".sh", ".bash", ".zsh", ".fish", ".py", ".pl", ".rb", ".js", ".mjs", ".ts", ".ps1",
            ".bat", ".cmd", ".vbs", ".php", ".csh",
        ]
        .iter()
        .any(|e| n.ends_with(e))
}

/// Which `wol.*` calls a Lua source makes, as permission ids, by a plain reading of its lines.
pub fn lua_permissions(src: &str) -> Vec<&'static str> {
    const CALLS: [(&str, &str); 6] = [
        ("wol.notify", "notifications"),
        ("wol.run", "run"),
        ("wol.http_get", "http"),
        ("wol.clipboard", "clipboard"),
        ("wol.open", "open"),
        ("wol.toggle_set", "toggles"),
    ];
    let mut out = Vec::new();
    for line in src.lines() {
        let code = line.trim_start();
        if code.starts_with("--") {
            continue;
        }
        for (call, perm) in CALLS {
            if code.contains(call) && !out.contains(&perm) {
                out.push(perm);
            }
        }
    }
    out
}

fn runs_a_shell(src: &str) -> bool {
    src.lines().any(|l| {
        let c = l.trim_start();
        !c.starts_with("--")
            && c.contains("\"-c\"")
            && [
                "\"sh\"",
                "\"bash\"",
                "\"zsh\"",
                "\"/bin/sh\"",
                "\"/bin/bash\"",
            ]
            .iter()
            .any(|s| c.contains(s))
    })
}

fn folder(l: &Loaded, kind: Kind, r: &mut Rules) {
    if l.plain_plugin {
        r.flag(
            "file/not-compressed",
            "The file is not compressed the way a plugin file is, so the system will not open it.",
            "",
        );
    }
    let Some(sp) = split(l, r) else { return };
    let noun = kind.noun();
    if sp.files.is_empty() || sp.files.len() > MAX_PLUG_FILES {
        r.broken(
            "file/members",
            &format!("A {noun} holds between 1 and 256 files."),
            format!("{} files", sp.files.len()),
        );
        return;
    }
    let hashed: Vec<&Member> = sp.files.clone();
    hashes(l, &hashed, r);
    if let Some(sig) = l.get(SIG)
        && sig.len() != 64
    {
        r.broken(
            "file/signature",
            "The old-style signature in the file is damaged.",
            format!("{} bytes", sig.len()),
        );
    }
    size_caps(l, r);
    let id = sp.files[0]
        .name
        .split('/')
        .next()
        .unwrap_or_default()
        .to_owned();
    if !manifest::is_plugin_id(&id) {
        r.block(
            "paths/folder",
            &format!("The {noun} file does not hold one folder named after the {noun}'s id."),
            id.clone(),
        );
        return;
    }
    let manifest_name = if kind == Kind::Extension {
        "extension.toml"
    } else {
        "plugin.toml"
    };
    let mut rels: Vec<(String, &Member)> = Vec::new();
    let mut total = 0usize;
    for m in &sp.files {
        let Some(rel) = m
            .name
            .strip_prefix(id.as_str())
            .and_then(|x| x.strip_prefix('/'))
        else {
            r.block(
                "paths/folder",
                &format!("The {noun} file holds files outside its one folder."),
                m.name.clone(),
            );
            continue;
        };
        if !manifest::is_plugin_path(rel) {
            r.block(
                "paths/forbidden",
                "A file has a name the system refuses: it must stay inside the folder, with letters, digits, . _ - and /, and nothing hidden.",
                m.name.clone(),
            );
            continue;
        }
        if rels.iter().any(|(x, _)| x == rel) {
            r.block(
                "paths/duplicate",
                "A file is in the archive twice.",
                m.name.clone(),
            );
            continue;
        }
        let size = m.at.len();
        total += size;
        if size > MAX_PLUG_FILE_ITEM {
            r.block(
                "size/file",
                "A file is larger than 256 KB, more than the system reads.",
                m.name.clone(),
            );
        }
        rels.push((rel.to_owned(), m));
    }
    if total > MAX_PLUG_TOTAL {
        r.block(
            "size/total",
            &format!("The {noun} is larger than 1 MB all told."),
            format!("{total} bytes"),
        );
    }
    let Some((_, mm)) = rels.iter().find(|(x, _)| x == manifest_name) else {
        r.block(
            "manifest/missing",
            &format!("The {noun} has no {manifest_name}."),
            manifest_name,
        );
        return;
    };
    let Some(text) = std::str::from_utf8(l.bytes(mm)).ok() else {
        r.block(
            "manifest/syntax",
            &format!("{manifest_name} is not text."),
            "",
        );
        return;
    };
    let Some(p) = manifest::read_plugin(text, kind, r) else {
        return;
    };
    r.file = FileId::of(&p.id, &p.version);
    if !p.id.is_empty() && p.id != id {
        r.block(
            "manifest/id",
            &format!(
                "The folder is named {id} but {manifest_name} says {}.",
                p.id
            ),
            id.clone(),
        );
    }
    name_rules(&p.name, &p.description, r);
    for f in &p.files {
        if !rels.iter().any(|(x, _)| x == f) {
            r.block(
                "manifest/missing-file",
                &format!("{manifest_name} names a file that is not in the {noun}."),
                f.clone(),
            );
        }
    }
    if (l.get(WSIG).is_some() || l.get(CHAIN).is_some()) && !min_wolos_ok(&p.min_wolos) {
        r.flag(
            "manifest/min-wolos",
            "A file with an author's certificate needs WolOS 0.13, but the manifest does not say so. Older systems will refuse it.",
            p.min_wolos.clone(),
        );
    }
    contents(l, &rels, &p, kind, r);
}

fn min_wolos_ok(v: &str) -> bool {
    let mut it = v.split('.').map(|x| x.parse::<u32>().ok());
    matches!((it.next(), it.next()), (Some(Some(a)), Some(Some(b))) if (a, b) >= (0, 13))
}

fn contents(l: &Loaded, rels: &[(String, &Member)], p: &Plugin, kind: Kind, r: &mut Rules) {
    let noun = kind.noun();
    let mut used: Vec<&'static str> = Vec::new();
    let mut shell = false;
    for (rel, m) in rels {
        let b = l.bytes(m);
        if let Some(what) = binary_kind(rel, b) {
            r.flag(
                "content/binary",
                &format!("The {noun} holds {what}. {}s are text and small pictures; look at what it does before you trust it.", capital(noun)),
                rel.clone(),
            );
            continue;
        }
        if is_foreign_script(rel, b) {
            r.flag(
                "content/script",
                &format!("The {noun} holds a script for a shell or another language. WolOS does not run it by itself; look at what it does before you use it."),
                rel.clone(),
            );
            continue;
        }
        if is_text_secret_name(rel) {
            r.flag(
                "content/secret",
                "A file looks like a private key or a password store. It should not be published.",
                rel.clone(),
            );
        }
        if rel.ends_with(".lua")
            && let Ok(src) = std::str::from_utf8(b)
        {
            for perm in lua_permissions(src) {
                if !used.contains(&perm) {
                    used.push(perm);
                }
            }
            shell |= runs_a_shell(src);
        }
    }
    if shell {
        r.flag(
            "content/shell-run",
            &format!(
                "A script of the {noun} starts a shell with a command line. Look at what it runs."
            ),
            "",
        );
    }
    if kind != Kind::Plugin {
        return;
    }
    for perm in &used {
        if !p.permissions.iter().any(|x| x == perm) {
            r.flag(
                "permissions/undeclared",
                "A script uses something it did not ask permission for, so that call will not work.",
                *perm,
            );
        }
    }
    let scripts_read = p.scripts.iter().all(|s| rels.iter().any(|(x, _)| x == s));
    if scripts_read {
        for perm in &p.permissions {
            let used_by_cmd = perm == "run" && p.runs_programs;
            if !used.contains(&perm.as_str()) && !used_by_cmd && perm != "toggles" {
                r.flag(
                    "permissions/unused",
                    "The manifest asks for a permission that no script uses.",
                    perm.clone(),
                );
            }
        }
    }
}

fn capital(s: &str) -> String {
    let mut c = s.chars();
    c.next()
        .map(|f| f.to_uppercase().chain(c).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binaries_and_scripts_by_bytes_and_by_name() {
        assert!(binary_kind("a.txt", b"\x7fELF....").is_some());
        assert!(binary_kind("a.so", b"text").is_some());
        assert!(binary_kind("a.so.1", b"text").is_some());
        assert!(binary_kind("a.lua", b"MZ is a name").is_none());
        assert!(binary_kind("a.lua", b"return {}").is_none());
        assert!(binary_kind("x.bin", b"").is_some());
        assert!(is_foreign_script("run", b"#!/bin/sh\n"));
        assert!(is_foreign_script("x.PY", b"print"));
        assert!(!is_foreign_script("card.lua", b"return wol.widget {}"));
    }

    #[test]
    fn lua_permission_use_is_read_per_line_and_comments_are_skipped() {
        let got = lua_permissions("-- wol.run\nlocal b = wol.http_get(u)\nwol.notify('a','b')\n");
        assert_eq!(got, vec!["http", "notifications"]);
    }

    #[test]
    fn the_min_wolos_gate() {
        assert!(min_wolos_ok("0.13"));
        assert!(min_wolos_ok("1.0"));
        assert!(!min_wolos_ok("0.12"));
        assert!(!min_wolos_ok(""));
    }
}
