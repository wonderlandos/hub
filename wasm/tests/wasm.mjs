// SPDX-License-Identifier: GPL-2.0-or-later
// Runs the built wasm in Node: the 41 replay files of the trust crate, the fixture files against the native
// command's output (byte for byte), and one signature check timed. Build first: ./build.sh all
// Run: node tests/wasm.mjs        (HUBCHECK_CHROME=/tmp/cw-tools/chrome/... is not needed for this file)
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(import.meta.url);
const wasm = require(join(root, "pkg-test/hubcheck.js"));
const fx = (n) => readFileSync(join(root, "fixtures", n));
const vectors = join(here, "vectors");
const bin = join(root, "target/release/hubcheck");
const native = (...args) => execFileSync(bin, args, { encoding: "utf8" }).trimEnd();

let count = 0;
const ok = (name) => { count++; console.log(`ok - ${name}`); };

// 1. The replay files, byte for byte through the wasm.
const files = readdirSync(vectors).filter((f) => f.endsWith(".json"));
assert.equal(files.length, 41);
const pki = readFileSync(join(vectors, "pki.json"), "utf8");
for (const f of files.filter((f) => f !== "pki.json")) {
  const why = wasm.replay_vector(pki, readFileSync(join(vectors, f), "utf8"));
  assert.equal(why, "", `${f}: ${why}`);
}
ok(`${files.length} replay files replay to their recorded results in wasm`);
assert.notEqual(wasm.replay_vector(pki, readFileSync(join(vectors, "valid-person.json"), "utf8").replace('"verified"', '"wolos"')), "");
ok("a changed expectation is caught in wasm");

// 2. The wasm and the native command print the same bytes.
const store = fx("store.json").toString();
const now = fx("now.txt").toString();
const same = [];
for (const [file, kind] of [["person.wol", "app"], ["org.wol", "app"], ["wolos.wol", "app"], ["unsigned.wol", "app"], ["namespace.wol", "app"], ["weather.wolplug", "plugin"]]) {
  const bytes = fx(file);
  const p = join(root, "fixtures", file);
  assert.equal(wasm.check(bytes, kind), native("check", kind, p), `check ${file}`);
  assert.equal(wasm.verify(bytes, kind, store, Number(now)), native("verify", kind, p, "--store", join(root, "fixtures/store.json"), "--now", now), `verify ${file}`);
  assert.equal(wasm.inspect(bytes, kind, store, Number(now)), native("inspect", kind, p, "--store", join(root, "fixtures/store.json"), "--now", now), `inspect ${file}`);
  same.push(file);
}
ok(`check, verify and inspect of ${same.length} files print the native bytes`);

const person = JSON.parse(wasm.inspect(fx("person.wol"), "app", store, Number(now)));
assert.deepEqual(Object.keys(person).sort(), ["cert", "findings", "trust", "verdict"]);
assert.equal(person.trust, "verified");
assert.equal(person.verdict, "pass");
assert.equal(JSON.parse(wasm.inspect(fx("wolos.wol"), "app", store, Number(now))).trust, "wolos");
assert.equal(JSON.parse(wasm.verify(fx("namespace.wol"), "app", store, Number(now))).code, "wrong-namespace");
ok("fixture .wol: verified, wolos, wrong namespace");

// A manifest on its own.
const toml = "schema = 1\nid = \"alice.x\"\nname = \"X\"\nversion = \"1\"\nlicense = \"MIT\"\n";
assert.equal(JSON.parse(wasm.validate_manifest(toml, "plugin")).findings.some((f) => f.rule === "manifest/empty"), true);
assert.equal(JSON.parse(wasm.check(new Uint8Array(10), "banana")).findings[0].rule, "input/kind");
ok("validate_manifest and a bad kind");

// Garbage never throws.
for (let i = 0; i < 200; i++) {
  const b = new Uint8Array(i * 37 % 4000).map((_, j) => (i * 131 + j * 7) & 255);
  for (const k of ["app", "plugin", "extension"]) JSON.parse(wasm.inspect(b, k, store, Number(now)));
}
ok("200 junk inputs x 3 kinds give a report");

// 3. One signature check, timed (after one warm-up call, as a page would have made).
const person_bytes = fx("person.wol");
const times = [];
const t0 = performance.now();
wasm.verify(person_bytes, "app", store, Number(now));
const cold = performance.now() - t0;
for (let i = 0; i < 20; i++) {
  const t = performance.now();
  wasm.verify(person_bytes, "app", store, Number(now));
  times.push(performance.now() - t);
}
times.sort((a, b) => a - b);
const loadStart = performance.now();
const verifier = new wasm.Verifier(store, Number(now));
const load = performance.now() - loadStart;
assert.equal(verifier.verify(person_bytes, "app"), wasm.verify(person_bytes, "app", store, Number(now)));
const vt = [];
for (let i = 0; i < 20; i++) { const t = performance.now(); verifier.verify(person_bytes, "app"); vt.push(performance.now() - t); }
vt.sort((a, b) => a - b);
console.log(`timing - store loaded once: ${load.toFixed(1)} ms, then verify of the same file: median ${vt[10].toFixed(1)} ms`);
console.log(`timing - verify of a signed .wol in wasm (Node ${process.version}): first ${cold.toFixed(1)} ms, median of 20 ${times[10].toFixed(1)} ms, best ${times[0].toFixed(1)} ms`);
console.log(`# ${count} groups passed`);
