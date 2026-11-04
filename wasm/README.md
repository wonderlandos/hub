# hubcheck

The rule analysis and signature check of WolOS Hub (ADR 0047), one Rust crate built twice: as wasm for the
browser and the Worker, and as the native command `bin/hubcheck` the check job runs. Both print the same
JSON, the report of interface I7.

```
check(bytes, kind)                  -> Report   rules only; trust is "community" until the signature is checked
validate_manifest(text, kind)       -> Report   Info.json / plugin.toml / extension.toml on their own
verify(bytes, kind, store, now)     -> Trusted  the signature through woltrust; {trust, code, stale, list_expires?, cert?, findings}
inspect(bytes, kind, store, now)    -> Report   both: verdict from the rules, trust and cert from the signature
```

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
`tests/vectors/` holds the 41 replay files of that commit; a test proves they are what the pinned generator writes.
Feature `zstd` (off) unpacks the zstd-compressed `.wolplug` with the pure-Rust `ruzstd`; without it such a file is `not-checked`.
