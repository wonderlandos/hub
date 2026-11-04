# hubcheck

The rule analysis and signature check of WolOS Hub (ADR 0047), one Rust crate built twice: as wasm for the
browser and the Worker, and as the native command `bin/hubcheck` the check job runs. Both print the same
JSON, the report of interface I7.

```
check(bytes, kind)                  -> Report   rules only; trust is "community" until the signature is checked
validate_manifest(text, kind)       -> Report   Info.json / plugin.toml / extension.toml on their own
verify(bytes, kind, store, now)     -> Trusted  the signature through woltrust; {trust, code, stale, list_expires?, cert?, findings}
inspect(bytes, kind, store, now)    -> Report   both: verdict from the rules, trust, cert and origin from the signature
```

The report (I7): `{verdict, findings, trust, cert?, origin?, file?, facts?}`, keys omitted when absent.
`trust` is `wolos | trusted | origin | community | withdrawn | invalid` (two certificate classes, lead 02:18Z,
TRUST-core-4 #plan 7293). `cert` is `{serial, subject, level, class?, origin_cert?, verified_at?}` (`subject.org` when the person
signs for an organisation); `class` is `origin` or `trusted`, omitted for WolOS signers. Until woltrust reports the
class, hubcheck reads `"class"` from the signer's signed body (absent = `origin`) and turns woltrust's `verified`
into `trusted` or `origin`; the vector replay still compares woltrust's own report, so it keeps `verified`. `origin` is `{repo, tag, commit, built}`, present only when the signature carries an origin that
checked out: woltrust checks that the repository owner is the certificate's login or organisation (WolOS signers:
`wonderlandos`), else trust is `invalid` with the finding `trust/origin-mismatch` and no `origin`. `file` is
`{id, version?}` read from the manifest (`Info.json`, `plugin.toml`, `extension.toml`), present when the id has
the accepted form; `version` is left out when missing or malformed. The pipeline compares `file` with the listing.
`verify` returns `Trusted` with the same `origin?` key. `origin_cert` (a `trusted` certificate only) is the serial
of the origin certificate it is bound to, read from the signed body like `class` until woltrust reports it.

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
hubcheck verify|inspect <kind> <file> --store store.json [--now N] [--first-seen N]
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
`tests/vectors/` holds the 45 replay files of that commit (`pki.json` and 44 verify vectors, 4 with an origin);
a test proves they are what the pinned generator writes. The 13 seal vectors (`vectors/seal/`) are not replayed
here: opening a sealed file needs the `seal` feature, which this crate leaves off.
Feature `zstd` (on by default) unpacks zstd-compressed `.wolplug` and extension files with the pure-Rust `ruzstd`,
capped at 4 MB unpacked (a bomb is `file/too-large`); built with `--no-default-features` such a file is `not-checked`.
