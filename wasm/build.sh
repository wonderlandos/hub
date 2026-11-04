#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-or-later
# Builds hubcheck:  ./build.sh native   -> bin/hubcheck (the command the check job runs)
#                   ./build.sh wasm     -> pkg/ (the browser and Worker module, ES module + .wasm)
#                   ./build.sh test     -> pkg-test/ (Node) and pkg-web-test/ (browser) modules with the vector replay, and fixtures/
#                   ./build.sh all      -> native, wasm, test
# Needs: rustup target add wasm32-unknown-unknown; cargo install wasm-bindgen-cli --version 0.2.130 --locked
set -eu
cd "$(dirname "$0")"
WB="${WASM_BINDGEN:-wasm-bindgen}"
WASM=target/wasm32-unknown-unknown/release/hubcheck.wasm
native() {
  cargo build --release --bin hubcheck ${FEATURES:+--features "$FEATURES"}
  cp target/release/hubcheck bin/hubcheck
  echo "bin/hubcheck: $(wc -c < bin/hubcheck) bytes"
}
wasm() {
  cargo build --release --lib --target wasm32-unknown-unknown ${FEATURES:+--features "$FEATURES"}
  rm -rf pkg
  "$WB" --target web --no-typescript --out-dir pkg --out-name hubcheck "$WASM"
  echo "pkg/hubcheck_bg.wasm: $(wc -c < pkg/hubcheck_bg.wasm) bytes, $(gzip -9c pkg/hubcheck_bg.wasm | wc -c) gzipped"
  echo "pkg/hubcheck.js: $(wc -c < pkg/hubcheck.js) bytes, $(gzip -9c pkg/hubcheck.js | wc -c) gzipped"
}
test_build() {
  cargo build --release --lib --target wasm32-unknown-unknown --features "dev${FEATURES:+,$FEATURES}"
  rm -rf pkg-test
  "$WB" --target nodejs --no-typescript --out-dir pkg-test --out-name hubcheck "$WASM"
  # The hub repository is an ES-module package; the Node glue is CommonJS.
  echo '{"type":"commonjs"}' > pkg-test/package.json
  rm -rf pkg-web-test
  "$WB" --target web --no-typescript --out-dir pkg-web-test --out-name hubcheck "$WASM"
  cargo build --release --bin hubcheck --features "dev${FEATURES:+,$FEATURES}"
  rm -rf fixtures
  target/release/hubcheck fixtures fixtures
}
case "${1:-all}" in
  native) native ;;
  wasm) wasm ;;
  test) test_build ;;
  all) native; wasm; test_build ;;
  *) echo "usage: $0 native|wasm|test|all" >&2; exit 2 ;;
esac
