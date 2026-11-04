// SPDX-License-Identifier: GPL-2.0-or-later
//! Test files built from the TEST authority of woltrust: a `.wol` in the package format of the OS
//! (format 2: `Info.json`, `icon.png`, `payload.pkg`, `SHA256`, then `CHAIN` and `SHA256.wsig`), a
//! `.wolplug` and a store with a fresh revocation list. Development only (feature `dev`); the same
//! bytes feed the native tests, the wasm run in Node and the vector replay.
use crate::files::sha256_hex;
use crate::tar;
use crate::trust::{Anchors, RevokedList, StoreFile};
use woltrust::make;
use woltrust::pki::{DAY, Ident, NOW, Pki};
use woltrust::revoked::{Entry, ListText, Reason};
use woltrust::{LIST_LIFETIME, Purpose};

/// Who signs a test file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Signer {
    /// Nobody.
    None,
    /// A person (`alice.`).
    Alice,
    /// An organisation (`examplelabs.`).
    Org,
    /// WolOS's own signer (`org.wolos.`).
    Wolos,
}

/// The TEST authority and the clock of its vectors.
pub struct Fixture {
    /// The authority.
    pub pki: Pki,
    /// The clock (Unix seconds).
    pub now: u64,
}

impl Default for Fixture {
    fn default() -> Self {
        Fixture::new()
    }
}

/// `SHA256` text for `(member, bytes)`: BSD lines sorted by member name.
pub fn manifest(members: &[(&str, &[u8])]) -> String {
    let mut lines: Vec<String> = members
        .iter()
        .map(|(n, b)| format!("SHA256 ({n}) = {}\n", sha256_hex(b)))
        .collect();
    lines.sort();
    lines.concat()
}

const PNG: &[u8] = b"\x89PNG\r\n\x1a\nxxxx";

impl Fixture {
    /// The authority at the clock of the vectors.
    pub fn new() -> Fixture {
        Fixture {
            pki: Pki::new(),
            now: NOW,
        }
    }

    fn who(&self, s: Signer) -> Option<(&Ident, &Ident)> {
        match s {
            Signer::None => None,
            Signer::Alice => Some((&self.pki.alice, &self.pki.authors)),
            Signer::Org => Some((&self.pki.org, &self.pki.authors)),
            Signer::Wolos => Some((&self.pki.signer, &self.pki.packages)),
        }
    }

    /// `(CHAIN, SHA256.wsig)` over `manifest` for `purpose`, or None when unsigned.
    pub fn sign(&self, s: Signer, purpose: Purpose, manifest: &[u8]) -> Option<(Vec<u8>, Vec<u8>)> {
        self.sign_with(s, purpose, manifest, None)
    }

    /// [`Fixture::sign`], with the exact bytes of an origin signed along when given.
    pub fn sign_with(
        &self,
        s: Signer,
        purpose: Purpose,
        manifest: &[u8],
        origin: Option<&[u8]>,
    ) -> Option<(Vec<u8>, Vec<u8>)> {
        let (leaf, ca) = self.who(s)?;
        let serial = &leaf.body.serial;
        let wsig = match origin {
            Some(o) => make::wsig_with_origin(serial, &leaf.secret, purpose, manifest, o),
            None => make::wsig(serial, &leaf.secret, purpose, manifest),
        };
        Some((Pki::chain(&[leaf, ca]), wsig))
    }

    /// The exact origin bytes of a release from `https://github.com/<owner>/notes`.
    pub fn origin(owner: &str) -> Vec<u8> {
        woltrust::Origin {
            repo: format!("https://github.com/{owner}/notes"),
            tag: "v1.0".to_owned(),
            commit: "0123456789abcdef0123456789abcdef01234567".to_owned(),
            built: NOW - DAY,
        }
        .to_bytes()
    }

    /// The `Info.json` of a test app.
    pub fn info(id: &str, version: &str) -> String {
        format!(
            r#"{{"id":"{id}","version":"{version}","name":"Notes","summary":"Quick notes","categories":["Work"],"capabilities":["files"],"package":"notes","targets":[{{"abi":"linux","arch":"amd64","entry":"bin/notes"}}]}}"#
        )
    }

    /// A `.wol` of format 2 with these `Info.json` text and payload, signed by `s`.
    pub fn wol_with(&self, info: &str, payload: &[u8], s: Signer) -> Vec<u8> {
        self.wol_origin(info, payload, s, None)
    }

    /// [`Fixture::wol_with`], its signature also carrying `origin` (exact bytes) when given.
    pub fn wol_origin(
        &self,
        info: &str,
        payload: &[u8],
        s: Signer,
        origin: Option<&[u8]>,
    ) -> Vec<u8> {
        let hashed: [(&str, &[u8]); 3] = [
            ("Info.json", info.as_bytes()),
            ("icon.png", PNG),
            ("payload.pkg", payload),
        ];
        let man = manifest(&hashed);
        let mut members: Vec<(&str, &[u8])> = hashed.to_vec();
        members.push(("SHA256", man.as_bytes()));
        let signed = self.sign_with(s, Purpose::Package, man.as_bytes(), origin);
        if let Some((chain, wsig)) = &signed {
            members.push(("CHAIN", chain));
            members.push(("SHA256.wsig", wsig));
        }
        tar::build(&members)
    }

    /// A `.wol` for app `id`.
    pub fn wol(&self, id: &str, s: Signer) -> Vec<u8> {
        self.wol_with(&Self::info(id, "1.0"), b"pkg payload bytes", s)
    }

    /// A plain-tar plugin: `files` are `(path in the folder, bytes)`; signed by `s`.
    pub fn plugin(&self, id: &str, files: &[(&str, &[u8])], s: Signer) -> Vec<u8> {
        let named: Vec<(String, &[u8])> = files
            .iter()
            .map(|(p, b)| (format!("{id}/{p}"), *b))
            .collect();
        let hashed: Vec<(&str, &[u8])> = named.iter().map(|(n, b)| (n.as_str(), *b)).collect();
        let man = manifest(&hashed);
        let mut members = hashed.clone();
        members.push(("SHA256", man.as_bytes()));
        let signed = self.sign(s, Purpose::Plugin, man.as_bytes());
        if let Some((chain, wsig)) = &signed {
            members.push(("CHAIN", chain));
            members.push(("SHA256.wsig", wsig));
        }
        let plain = tar::build(&members);
        #[cfg(feature = "zstd")]
        {
            ruzstd::encoding::compress_to_vec(
                &plain[..],
                ruzstd::encoding::CompressionLevel::Fastest,
            )
        }
        #[cfg(not(feature = "zstd"))]
        {
            plain
        }
    }

    /// The `plugin.toml` of a small plugin that uses `wol.http_get`.
    pub fn plugin_toml(id: &str, permissions: &str) -> String {
        format!(
            "schema = 1\nid = \"{id}\"\nname = \"Weather\"\nversion = \"1.0\"\nlicense = \"MIT\"\ndescription = \"Shows the weather\"\nmin_wolos = \"0.13\"\npermissions = [{permissions}]\n\n[[widget]]\nid = \"card\"\nscript = \"card.lua\"\nsizes = [\"small\"]\n"
        )
    }

    /// A revocation list signed by the Index certificate, fresh at the clock, revoking `entries`.
    pub fn list(&self, entries: &[(&str, Reason)]) -> RevokedList {
        let issued = self.now - DAY;
        let l = ListText {
            format: 1,
            serial: 10,
            issued,
            expires: issued + LIST_LIFETIME,
            entries: entries
                .iter()
                .map(|(s, r)| Entry {
                    serial: (*s).to_owned(),
                    at: self.now - 2 * DAY,
                    reason: *r,
                })
                .collect(),
        };
        let (a, b) = make::revocation_list(&l, &self.pki.index.body.serial, &self.pki.index.secret);
        RevokedList {
            list: String::from_utf8_lossy(&a).into_owned(),
            wsig: String::from_utf8_lossy(&b).into_owned(),
        }
    }

    /// The store: root A, the Index intermediate and one fresh empty list; the TEST root is allowed.
    pub fn store(&self) -> StoreFile {
        StoreFile {
            anchors: Anchors {
                roots: vec![String::from_utf8_lossy(&self.pki.root_a.file).into_owned()],
                intermediates: vec![String::from_utf8_lossy(&self.pki.index.file).into_owned()],
                allow_test: true,
            },
            revoked: vec![self.list(&[])],
        }
    }

    /// [`Fixture::store`] as JSON text.
    pub fn store_json(&self) -> String {
        serde_json::to_string(&self.store()).unwrap_or_default()
    }
}
