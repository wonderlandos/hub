// SPDX-License-Identifier: GPL-2.0-or-later
//! Manifest rules for the `Info.json` of an app (ADR 0011), the `plugin.toml` of a plugin (ADR 0031,
//! schema one) and the draft `extension.toml` of an extension (ADR 0047, H5). These are the pure
//! rules of the system's own readers, written again here because the system's crate links libc and
//! cannot be built for the browser; the field limits and the closed lists are the same.
use crate::rules::{Kind, Rules};
use crate::toml::{self, Doc, Pair, Val};
use woltrust::Report;

/// Reserved for what WolOS ships itself.
pub const RESERVED_PREFIX: &str = "org.wolos.";
const MAX_ID: usize = 64;
const MAX_ENTRY_ID: usize = 32;
const MAX_NAME: usize = 40;
const MAX_DESCRIPTION: usize = 120;
const MAX_PATH: usize = 128;
const HEADER_KEYS: [&str; 9] = [
    "schema",
    "id",
    "name",
    "version",
    "author",
    "license",
    "description",
    "min_wolos",
    "permissions",
];
/// Permissions a plugin may ask for.
pub const PERMISSIONS: [&str; 6] = [
    "notifications",
    "run",
    "http",
    "clipboard",
    "open",
    "toggles",
];
const CATEGORIES: [&str; 4] = ["Create", "Work", "Play", "Develop"];
const CAPABILITIES: [&str; 9] = [
    "network",
    "files",
    "camera",
    "microphone",
    "location",
    "screen-capture",
    "notifications",
    "background",
    "devices",
];
const ABIS: [&str; 3] = ["freebsd-native", "linux", "proton"];
/// Capability tables of a plugin, with the keys an entry may have.
const SECTIONS: [(&str, &[&str]); 12] = [
    ("menubar", &["id", "script", "side"]),
    ("dock", &["id", "name", "icon", "exec"]),
    ("widget", &["id", "script", "sizes"]),
    ("panel", &["id", "script", "anchor"]),
    ("search", &["id", "script", "kind", "prefix"]),
    ("tile", &["id", "icon", "label", "toggle"]),
    ("toggle", &["id", "on", "off"]),
    ("hotkey", &["id", "default", "exec", "group"]),
    ("webapp", &["id", "name", "url", "icon", "profile"]),
    ("theme", &["id", "file"]),
    ("look", &["id", "file"]),
    ("hypr", &["id", "file"]),
];

/// `pkg` name: `[A-Za-z0-9][A-Za-z0-9._+-]*`, 1..=64.
pub fn is_pkg_name(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 64
        && b[0].is_ascii_alphanumeric()
        && b.iter()
            .all(|c| c.is_ascii_alphanumeric() || b"._+-".contains(c))
}

/// Reverse-DNS app id: two or more `[A-Za-z0-9_-]+` segments joined by dots, at most 128.
pub fn is_app_id(s: &str) -> bool {
    s.len() <= 128
        && s.split('.').count() >= 2
        && s.split('.').all(|p| {
            !p.is_empty()
                && p.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        })
}

/// Version string: alphanumeric first, then `[A-Za-z0-9._,+~-]`, at most 64.
pub fn is_version(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 64
        && b[0].is_ascii_alphanumeric()
        && b.iter()
            .all(|c| c.is_ascii_alphanumeric() || b"._,+~-".contains(c))
}

/// `org.example.stats` or `alice.stats`: two or more lowercase labels of letters, digits and `-`.
pub fn is_plugin_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_ID
        && s.split('.').count() >= 2
        && s.split('.').all(|p| {
            !p.is_empty()
                && !p.starts_with('-')
                && !p.ends_with('-')
                && p.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}

fn is_entry_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_ENTRY_ID
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

/// A file inside the plugin folder: relative, no `..`, no hidden parts, letters, digits, `.`, `_`, `-`, `/`.
pub fn is_plugin_path(p: &str) -> bool {
    !p.is_empty()
        && p.len() <= MAX_PATH
        && !p.starts_with('/')
        && !p.ends_with('/')
        && p.split('/').all(|c| {
            !c.is_empty()
                && !c.starts_with('.')
                && c.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-')
        })
}

fn is_wolos_version(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    (2..=3).contains(&parts.len())
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.len() <= 4 && p.bytes().all(|b| b.is_ascii_digit()))
}

fn one_line(s: &str, max: usize) -> bool {
    s.len() <= max && !s.chars().any(char::is_control)
}

/// What the rest of the check needs from a plugin or extension manifest.
#[derive(Debug, Default)]
pub struct Plugin {
    /// The id.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Description (summary).
    pub description: String,
    /// `min_wolos`, or empty.
    pub min_wolos: String,
    /// Permissions asked for.
    pub permissions: Vec<String>,
    /// Files the manifest names (scripts, theme files, icon files), relative to the folder.
    pub files: Vec<String>,
    /// The scripts among them.
    pub scripts: Vec<String>,
    /// True when a command runs something other than a `wol` verb.
    pub runs_programs: bool,
    /// The host app of an extension.
    pub host: Option<String>,
}

/// What the rest of the check needs from an app's `Info.json`.
#[derive(Debug, Default)]
pub struct App {
    /// The id.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Summary.
    pub summary: String,
    /// Declared capabilities.
    pub capabilities: Vec<String>,
}

struct Fields<'a> {
    where_: String,
    pairs: &'a [Pair],
}

impl Fields<'_> {
    fn get(&self, k: &str) -> Option<&Val> {
        self.pairs.iter().find(|p| p.0 == k).map(|p| &p.1)
    }

    fn line(&self, k: &str) -> usize {
        self.pairs.iter().find(|p| p.0 == k).map_or(0, |p| p.2)
    }

    /// A string value; a value of another type is reported.
    fn text(&self, k: &str, r: &mut Rules) -> Option<&str> {
        match self.get(k) {
            None => None,
            Some(Val::Str(s)) => Some(s),
            Some(_) => {
                r.block(
                    "manifest/field",
                    &format!("\"{k}\" in {} must be text.", self.where_),
                    format!("line {}", self.line(k)),
                );
                None
            }
        }
    }

    fn list(&self, k: &str, r: &mut Rules) -> Option<Vec<&str>> {
        match self.get(k) {
            None => None,
            Some(v) => {
                let l = v.strings();
                if l.is_none() {
                    r.block(
                        "manifest/field",
                        &format!("\"{k}\" in {} must be a list of text.", self.where_),
                        format!("line {}", self.line(k)),
                    );
                }
                l
            }
        }
    }
}

/// Reads a `plugin.toml` (or `extension.toml`), adding a finding for every rule that broke.
pub fn read_plugin(text: &str, kind: Kind, r: &mut Rules) -> Option<Plugin> {
    let doc: Doc = match toml::parse(text) {
        Ok(d) => d,
        Err(e) => {
            r.block("manifest/syntax", &e.sentence, format!("line {}", e.line));
            return None;
        }
    };
    let file = if kind == Kind::Extension {
        "extension.toml"
    } else {
        "plugin.toml"
    };
    let h = Fields {
        where_: file.to_owned(),
        pairs: &doc.header,
    };
    let mut m = Plugin::default();
    for (k, _, line) in &doc.header {
        let known = HEADER_KEYS.contains(&k.as_str()) || (kind == Kind::Extension && k == "host");
        let perms_on_ext = kind == Kind::Extension && k == "permissions";
        if !known || perms_on_ext {
            r.block(
                "manifest/field",
                &format!("{file} has an entry \"{k}\" that is not part of the format."),
                format!("line {line}"),
            );
        }
    }
    match h.get("schema") {
        Some(Val::Int(1)) => {}
        Some(Val::Int(n)) if *n > 1 => r.block(
            "manifest/schema",
            "This file needs a newer manifest format than WolOS reads.",
            format!("schema {n}"),
        ),
        _ => r.block(
            "manifest/schema",
            &format!("{file} must start with schema = 1."),
            "",
        ),
    }
    match h.text("id", r) {
        Some(id) if is_plugin_id(id) => {
            m.id = id.to_owned();
            if id == RESERVED_PREFIX.trim_end_matches('.') || id.starts_with(RESERVED_PREFIX) {
                let sentence = format!(
                    "Ids starting with {RESERVED_PREFIX} are kept for WolOS, and the system refuses them from anyone else."
                );
                if kind == Kind::Plugin {
                    r.block("manifest/reserved-id", &sentence, id);
                } else {
                    r.flag("manifest/reserved-id", &sentence, id);
                }
            }
        }
        Some(id) => r.block(
            "manifest/id",
            "The id is lowercase labels joined by dots, like \"alice.weather\", up to 64 characters.",
            id,
        ),
        None => r.block("manifest/id", "The manifest has no id.", ""),
    }
    match h.text("name", r) {
        Some(n) if !n.trim().is_empty() && one_line(n, MAX_NAME) => n.clone_into(&mut m.name),
        Some(n) => r.block(
            "manifest/name",
            "The name is one line of up to 40 characters.",
            n,
        ),
        None => r.block("manifest/name", "The manifest has no name.", ""),
    }
    match h.text("version", r) {
        Some(v) if is_version(v) => {}
        Some(v) => r.block(
            "manifest/version",
            "The version is letters, digits and . _ + ~ -, like \"1.0\".",
            v,
        ),
        None => r.block("manifest/version", "The manifest has no version.", ""),
    }
    match h.text("license", r) {
        Some(l) if !l.trim().is_empty() && one_line(l, MAX_NAME) => {}
        Some(l) => r.block(
            "manifest/license",
            "The license is a short SPDX name, like \"MIT\".",
            l,
        ),
        None => r.block("manifest/license", "The manifest names no license.", ""),
    }
    if let Some(a) = h.text("author", r)
        && !one_line(a, MAX_NAME)
    {
        r.block(
            "manifest/author",
            "The author is one line of up to 40 characters.",
            a,
        );
    }
    if let Some(d) = h.text("description", r) {
        if one_line(d, MAX_DESCRIPTION) {
            d.clone_into(&mut m.description);
        } else {
            r.block(
                "manifest/description",
                "The description is one line of up to 120 characters.",
                d,
            );
        }
    }
    if let Some(v) = h.text("min_wolos", r) {
        if v.is_empty() || is_wolos_version(v) {
            v.clone_into(&mut m.min_wolos);
        } else {
            r.block(
                "manifest/min-wolos",
                "min_wolos is a WolOS version like \"0.13\".",
                v,
            );
        }
    }
    if let Some(l) = h.list("permissions", r) {
        for p in l {
            if !PERMISSIONS.contains(&p) {
                r.block(
                    "manifest/permission",
                    &format!(
                        "Plugins cannot ask for the permission \"{p}\"; they can ask for {}.",
                        PERMISSIONS.join(", ")
                    ),
                    p,
                );
            } else if !m.permissions.iter().any(|x| x == p) {
                m.permissions.push(p.to_owned());
            }
        }
    }
    if kind == Kind::Extension {
        match h.text("host", r) {
            Some(host) if is_app_id(host) => m.host = Some(host.to_owned()),
            Some(host) => r.block(
                "manifest/host",
                "host is the id of the app the extension extends, like \"org.example.Editor\".",
                host,
            ),
            None => r.block(
                "manifest/host",
                "An extension names the app it extends.",
                "",
            ),
        }
    }
    sections(&doc, kind, &mut m, r);
    Some(m)
}

fn sections(doc: &Doc, kind: Kind, m: &mut Plugin, r: &mut Rules) {
    let mut ids: Vec<(String, String)> = Vec::new();
    let mut toggles: Vec<String> = Vec::new();
    let mut tile_toggles: Vec<(String, String)> = Vec::new();
    let mut entries = 0usize;
    for s in &doc.sections {
        let Some((_, keys)) = SECTIONS.iter().find(|(n, _)| *n == s.name) else {
            r.block(
                "manifest/section",
                &format!("[[{}]] is not a section this format has.", s.name),
                format!("line {}", s.line),
            );
            continue;
        };
        if kind == Kind::Extension {
            r.block(
                "manifest/section",
                "An extension's manifest has no plugin sections yet.",
                format!("[[{}]] line {}", s.name, s.line),
            );
            continue;
        }
        entries += 1;
        let f = Fields {
            where_: format!("[[{}]] at line {}", s.name, s.line),
            pairs: &s.pairs,
        };
        if matches!(s.name.as_str(), "look" | "hypr") {
            r.block(
                "manifest/planned",
                &format!(
                    "[[{}]] is not applied by WolOS yet, so remove the section for now.",
                    s.name
                ),
                format!("line {}", s.line),
            );
        }
        for (k, _, line) in &s.pairs {
            if !keys.contains(&k.as_str()) {
                r.block(
                    "manifest/field",
                    &format!(
                        "[[{}]] has an entry \"{k}\" that is not part of the format.",
                        s.name
                    ),
                    format!("line {line}"),
                );
            }
        }
        let id = f.text("id", r).unwrap_or_default();
        if is_entry_id(id) {
            if ids.iter().any(|(n, i)| *n == s.name && i == id) {
                r.block(
                    "manifest/entry",
                    &format!("Two [[{}]] sections use the id \"{id}\".", s.name),
                    id,
                );
            }
            ids.push((s.name.clone(), id.to_owned()));
        } else {
            r.block(
                "manifest/entry",
                &format!(
                    "[[{}]] at line {} needs an id of lowercase letters, digits, - and _.",
                    s.name, s.line
                ),
                id,
            );
        }
        for key in ["script", "file", "icon"] {
            let Some(path) = f.text(key, r) else { continue };
            let is_file = key != "icon" || path.ends_with(".png") || path.ends_with(".svg");
            if !is_file {
                continue;
            }
            if !is_plugin_path(path) {
                r.block(
                    "manifest/path",
                    "A file name stays inside the plugin folder: letters, digits, . _ - and /, nothing hidden, no \"..\".",
                    path,
                );
            } else if !m.files.iter().any(|x| x == path) {
                m.files.push(path.to_owned());
                if key == "script" {
                    m.scripts.push(path.to_owned());
                }
            }
        }
        for need in ["script", "file"] {
            if keys.contains(&need) && f.get(need).is_none() {
                r.block(
                    "manifest/entry",
                    &format!("[[{}]] at line {} needs \"{need}\".", s.name, s.line),
                    id,
                );
            }
        }
        for key in ["exec", "on", "off"] {
            if let Some(argv) = f.list(key, r) {
                if argv.is_empty() {
                    r.block(
                        "manifest/command",
                        &format!("\"{key}\" in {} needs at least one word.", f.where_),
                        id,
                    );
                } else if argv[0] != "wol" {
                    m.runs_programs = true;
                }
            }
        }
        if s.name == "toggle" {
            toggles.push(id.to_owned());
        }
        if s.name == "tile" {
            tile_toggles.push((
                id.to_owned(),
                f.text("toggle", r).unwrap_or_default().to_owned(),
            ));
        }
        if s.name == "webapp"
            && let Some(url) = f.text("url", r)
            && !url.starts_with("https://")
        {
            r.flag(
                "manifest/insecure-url",
                "A web app opens an address that is not https.",
                url,
            );
        }
    }
    for (tile, toggle) in &tile_toggles {
        if !toggles.contains(toggle) {
            r.block(
                "manifest/entry",
                &format!("[[tile]] \"{tile}\" uses the toggle \"{toggle}\", which this plugin does not define."),
                toggle.clone(),
            );
        }
    }
    if m.runs_programs && !m.permissions.iter().any(|p| p == "run") {
        r.block(
            "manifest/command",
            "A command is not a wol command: add \"run\" to permissions so the person is asked first.",
            "",
        );
    }
    if kind == Kind::Plugin && entries == 0 {
        r.block(
            "manifest/empty",
            "The plugin does nothing yet: add a section such as [[menubar]] or [[widget]].",
            "",
        );
    }
}

/// Reads an app's `Info.json`.
pub fn read_app(text: &str, r: &mut Rules) -> Option<App> {
    let v: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => {
            r.block(
                "manifest/syntax",
                "Info.json is not readable as a list of fields.",
                "",
            );
            return None;
        }
    };
    let Some(o) = v.as_object() else {
        r.block("manifest/syntax", "Info.json must be one object.", "");
        return None;
    };
    let mut a = App::default();
    let s = |k: &str| o.get(k).and_then(serde_json::Value::as_str);
    for k in ["id", "version", "name", "summary", "icon", "package"] {
        if o.get(k).is_some_and(|x| !x.is_string()) {
            r.block(
                "manifest/field",
                &format!("\"{k}\" in Info.json must be text."),
                k,
            );
        }
    }
    match s("id") {
        Some(id) if is_app_id(id) => {
            id.clone_into(&mut a.id);
            if id.starts_with(RESERVED_PREFIX) {
                r.flag(
                    "manifest/reserved-id",
                    &format!("Ids starting with {RESERVED_PREFIX} are kept for WolOS. They are listed as WolOS's own only when WolOS signed them."),
                    id,
                );
            }
        }
        Some(id) => r.block(
            "manifest/id",
            "The id is two or more names joined by dots, like \"org.example.Notes\".",
            id,
        ),
        None => r.block("manifest/id", "Info.json has no id.", ""),
    }
    match s("version") {
        Some(v) if is_version(v) => {}
        Some(v) => r.block(
            "manifest/version",
            "The version is letters, digits and . _ , + ~ -, like \"1.0\".",
            v,
        ),
        None => r.block("manifest/version", "Info.json has no version.", ""),
    }
    match s("name") {
        Some(n) if !n.trim().is_empty() && one_line(n, 80) => n.clone_into(&mut a.name),
        _ => r.flag(
            "manifest/name",
            "The app has no usable display name (one line, up to 80 characters).",
            s("name").unwrap_or_default(),
        ),
    }
    if let Some(t) = s("summary") {
        t.clone_into(&mut a.summary);
    }
    if let Some(p) = s("package")
        && !p.is_empty()
        && !is_pkg_name(p)
    {
        r.block(
            "manifest/package",
            "The package name is letters, digits and . _ + - only.",
            p,
        );
    }
    for (key, rule, allowed) in [
        ("categories", "manifest/category", &CATEGORIES[..]),
        ("capabilities", "manifest/capability", &CAPABILITIES[..]),
    ] {
        let Some(x) = o.get(key) else { continue };
        let Some(list) = x.as_array().and_then(|a| {
            a.iter()
                .map(serde_json::Value::as_str)
                .collect::<Option<Vec<_>>>()
        }) else {
            r.block(
                "manifest/field",
                &format!("\"{key}\" in Info.json must be a list of text."),
                key,
            );
            continue;
        };
        for item in list {
            if !allowed.contains(&item) {
                r.block(
                    rule,
                    &format!(
                        "\"{item}\" is not one of the known {key}: {}.",
                        allowed.join(", ")
                    ),
                    item,
                );
            } else if key == "capabilities" {
                a.capabilities.push(item.to_owned());
            }
        }
    }
    match o.get("targets").and_then(serde_json::Value::as_array) {
        Some(t) if !t.is_empty() => {
            for t in t {
                let abi = t.get("abi").and_then(serde_json::Value::as_str);
                let arch = t.get("arch").and_then(serde_json::Value::as_str);
                let entry = t.get("entry").and_then(serde_json::Value::as_str);
                if !abi.is_some_and(|a| ABIS.contains(&a))
                    || !arch.is_some_and(|a| !a.is_empty() && a.len() <= 16)
                    || entry.is_none_or(str::is_empty)
                {
                    r.block(
                        "manifest/target",
                        "Each target needs an abi (freebsd-native, linux or proton), an arch and an entry.",
                        t.to_string(),
                    );
                } else if let Some(e) = entry
                    && (e.starts_with('/') || e.split('/').any(|p| p == ".."))
                {
                    r.block(
                        "manifest/target",
                        "A target's entry must stay inside the app.",
                        e,
                    );
                }
            }
        }
        _ => r.block(
            "manifest/target",
            "Info.json lists no targets, so there is nothing to start.",
            "",
        ),
    }
    Some(a)
}

/// Checks a manifest on its own (the editor and the Worker use this before a file exists).
/// `app` reads an `Info.json`, `plugin` a `plugin.toml`, `extension` an `extension.toml`.
pub fn validate_manifest(text: &str, kind: Kind) -> Report {
    let mut r = Rules::default();
    if kind == Kind::App {
        if let Some(a) = read_app(text, &mut r) {
            crate::files::name_rules(&a.name, &a.summary, &mut r);
        }
    } else if let Some(p) = read_plugin(text, kind, &mut r) {
        crate::files::name_rules(&p.name, &p.description, &mut r);
    }
    r.report(woltrust::Trust::Community)
}
