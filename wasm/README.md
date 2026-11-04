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

The report (I7): `{verdict, findings, trust, cert?, origin?, file?}`, keys omitted when absent.
`cert` is woltrust's `{serial, subject, level, verified_at?}` (`subject.org` when the person signs for an
organisation). `origin` is `{repo, tag, commit, built}`, present only when the signature carries an origin that
checked out: woltrust checks that the repository owner is the certificate's login or organisation (WolOS signers:
`wonderlandos`), else trust is `invalid` with the finding `trust/origin-mismatch` and no `origin`. `file` is
`{id, version?}` read from the manifest (`Info.json`, `plugin.toml`, `extension.toml`), present when the id has
the accepted form; `version` is left out when missing or malformed. The pipeline compares `file` with the listing.
`verify` returns `Trusted` with the same `origin?` key.

`kind` is `app` (.wol), `plugin` (.wolplug) or `extension`. `store` is JSON text:
`{"roots":[<.wolcert text>],"intermediates":[<.wolcert text>],"revoked":[{"list":<revoked.json text>,"wsig":<its .wsig text>}],"allow_test":false}`.
`now` is Unix seconds, always passed in (the module has no clock). `Verifier` (wasm) loads a store once for many files.

Command line:

```
hubcheck check <kind> <file>
hubcheck manifest <kind> <file|->
hubcheck verify|inspect <kind> <file> --store store.json [--now N] [--first-seen N]
```

Build and test:

```
./build.sh all                # bin/hubcheck, pkg/ (ES module + .wasm), pkg-test/, pkg-web-test/, fixtures/
cargo test --features dev     # unit, vectors, trust, rules, robustness, command line
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
