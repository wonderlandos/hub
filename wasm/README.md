# hubcheck

The rule analysis and signature check of WolOS Hub (ADR 0047), one Rust crate built twice: as wasm for the
browser and the Worker, and as the native command `bin/hubcheck` the check job runs. Both print the same
JSON, the report of interface I7.

```
check(bytes, kind)                  -> Report   rules only; trust is "community" until the signature is checked
validate_manifest(text, kind)       -> Report   Info.json / plugin.toml / extension.toml on their own
verify(bytes, kind, store, now[, file_cert])  -> Trusted  the signature through woltrust; {trust, code, stale, list_expires?, cert?, origin?, file_certificate?, findings}
inspect(bytes, kind, store, now[, file_cert]) -> Report   both: verdict from the rules, trust, cert and origin from the signature
```

The report (I7): `{verdict, findings, trust, cert?, origin?, file_certificate?, file?, facts?}`, keys omitted when absent.
`trust` is woltrust's value, one to one: `wolos | trusted | origin | legacy | community | withdrawn | invalid`
(two certificate classes, lead 02:18Z, TRUST-core-4 #plan 7293; `legacy` = signed only with WolOS's previous key). `cert` is `{serial, subject, level, class?, origin_cert?, verified_at?}` (`subject.org` when the person
signs for an organisation); `class` is `origin` or `trusted` as woltrust reports it, omitted for WolOS signers. `origin` is `{repo, tag, commit, built}`, present only when the signature carries an origin that
checked out: woltrust checks that the repository owner is the certificate's login or organisation (WolOS signers:
`wonderlandos`), else trust is `invalid` with the finding `trust/origin-mismatch` and no `origin`. `file` is
`{id, version?}` read from the manifest (`Info.json`, `plugin.toml`, `extension.toml`), present when the id has
the accepted form; `version` is left out when missing or malformed. The pipeline compares `file` with the listing.
`verify` returns `Trusted` with the same `origin?` key. `origin_cert` (a `trusted` certificate only) is the serial
of the origin certificate it is bound to, read from the certificate woltrust parses (its `CertInfo` does not carry it).

`file_certificate` is `{serial, checked_at, verdict}`: what the file certificate the index published for this exact
release says (woltrust `filecert`, label `wolos/release/1`, signed by the Index intermediate), when the caller passes
it (`file_cert`: the bytes of its text; command line `--file-cert <file>`). It is checked as the system checks it
before installing: it must verify against the store for the file's SHA-256 and name the file's id and version, else
trust is `invalid` with a finding `trust/file-cert-*` and no `file_certificate`; a `withdrawn-version` entry for its
serial makes trust `withdrawn` (finding `trust/withdrawn-version`, `file_certificate` still shown).

`facts` is the listing, read from the package itself (lead 02:33Z; nothing is uploaded by hand), present in
`check` and `inspect` when the manifest was read:
`{name, summary, description?, icon?, screenshots, categories, homepage?, licence?}`, each picture
`{path, mime, w, h, size, sha256}` (`mime` is `image/png` or `image/webp`, `w`/`h` read from the header, `path` the
`.wol` member or the path in the plugin folder). Where it comes from:

| fact        | `.wol` (`Info.json` and members)                | `.wolplug` / `.wolext` (header of the toml)      |
|-------------|-------------------------------------------------|--------------------------------------------------|
| name        | `name`                                          | `name`                                           |
| summary     | `summary`                                       | `description` (one line, up to 120)              |
| description | `description` (new, up to 4000, newlines)       | `about` (new, up to 4000, `\n` escapes)          |
| icon        | member `icon.png`                               | `icon` (new): a `.png` or `.webp` in the folder  |
| screenshots | `screenshots` (new): members `screenshots/<name>.png\|webp`, between `icon.png` and `payload.pkg`, at most 8 | `screenshots` (new): files in the folder |
| categories  | `categories`                                    | `categories` (new), the same four                |
| homepage    | `homepage` (new, https)                         | `homepage` (new, https)                          |
| licence     | `license` (new)                                 | `license`                                        |

The new toml keys need WolOS 0.13 (`manifest/min-wolos` is flagged without it; the system's reader must add them,
#plan 7328). Pictures are PNG or WebP only, the format must match the name, still (no APNG, no animated WebP),
read from their headers only (no pixel is decoded here). Icon: square, 128 to 1024 pixels, up to 1 MB.
Screenshot: each side 320 to 3840 pixels, up to 2 MB. SVG is never the listing icon (no sanitiser here). A problem
is a note: a finding `listing/icon-missing`, `listing/icon`, `listing/screenshot`, `listing/screenshots`,
`listing/description`, `listing/homepage`, `listing/licence` or `listing/field` that leaves the verdict alone, and
the faulty item is left out of `facts`.

`kind` is `app` (.wol), `plugin` (.wolplug) or `extension`. `store` is JSON text:
`{"roots":[<.wolcert text>],"intermediates":[<.wolcert text>],"revoked":[{"list":<revoked.json text>,"wsig":<its .wsig text>}],"allow_test":false}`.
`now` is Unix seconds, always passed in (the module has no clock). `Verifier` (wasm) loads a store once for many files.

Command line:

```
hubcheck check <kind> <file>
hubcheck manifest <kind> <file|->
hubcheck verify|inspect <kind> <file> --store store.json [--now N] [--first-seen N] [--file-cert F]
hubcheck extract <file> --out <dir> [--kind <kind>]
```

`extract` (native only) writes the pictures of `facts`, and nothing else, as `<dir>/<sha256>.<png|webp>` and
prints `{verdict, facts, written}`; the kind comes from the name (`.wol`, `.wolplug`, `.wolext`) unless given.
The pipeline puts the written files on the CDN; hubcheck never uses the network.

Build and test:

```
./build.sh all                # bin/hubcheck, pkg/ (ES module + .wasm), pkg-test/, pkg-web-test/, fixtures/
cargo test --features dev     # unit, vectors, trust, rules, listing, robustness, command line
node tests/wasm.mjs           # the same vectors and fixtures in wasm under Node, against the native bytes
CHROME=/tmp/cw-tools/chrome PLAYWRIGHT=/tmp/cw-tools/node_modules/playwright-core node tests/browser.mjs
```

`woltrust` is a git dependency pinned by commit (see Cargo.toml for the path form used for local work).
It is taken with `default-features = false`: woltrust's default `seal` feature pulls ring, which does not build for wasm.
`tests/vectors/` holds the 69 replay files of that commit (b8bbd2d, trust phase 4: `pki.json` and 68 verify vectors,
origin and trusted classes, co-signed intermediates, emergency sections and the witness among them) and
`tests/vectors/filecert/` its 8 file certificate vectors; tests prove both are what the pinned generators write (they are
written by `woltrust::vectors::generate` and `filecert_vectors::generate` built without `seal`, not copied from
`crates/woltrust/vectors/`, where 13 of the committed files differ from what the generator writes today). `lines.json` (signature lines) is not a
verify vector and is not replayed. The seal and request vectors (`vectors/seal/`, `vectors/request/`) are not replayed
here: they need the `seal` feature, which this crate leaves off.
Feature `zstd` (on by default) unpacks zstd-compressed `.wolplug` and extension files with the pure-Rust `ruzstd`,
capped at 4 MB unpacked (a bomb is `file/too-large`); built with `--no-default-features` such a file is `not-checked`.
