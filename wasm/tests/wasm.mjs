// SPDX-License-Identifier: GPL-2.0-or-later
// Runs the built wasm in Node: the 54 replay files and 7 file certificate vectors of the trust crate, the fixture files against the native
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
assert.equal(files.length, 54);
const pki = readFileSync(join(vectors, "pki.json"), "utf8");
for (const f of files.filter((f) => f !== "pki.json")) {
  const why = wasm.replay_vector(pki, readFileSync(join(vectors, f), "utf8"));
  assert.equal(why, "", `${f}: ${why}`);
}
ok(`${files.length} replay files replay to their recorded results in wasm`);
assert.notEqual(wasm.replay_vector(pki, readFileSync(join(vectors, "valid-person.json"), "utf8").replace('"trust": "origin"', '"trust": "wolos"')), "");
const fcs = readdirSync(join(vectors, "filecert")).filter((f) => f.endsWith(".json"));
assert.equal(fcs.length, 7);
for (const f of fcs) {
  const why = wasm.replay_filecert_vector(readFileSync(join(vectors, "filecert", f), "utf8"));
  assert.equal(why, "", `${f}: ${why}`);
}
ok(`${fcs.length} file certificate vectors replay in wasm`);
ok("a changed expectation is caught in wasm");

// 2. The wasm and the native command print the same bytes.
const store = fx("store.json").toString();
const now = fx("now.txt").toString();
const same = [];
for (const [file, kind] of [["person.wol", "app"], ["org.wol", "app"], ["wolos.wol", "app"], ["unsigned.wol", "app"], ["namespace.wol", "app"], ["origin.wol", "app"], ["listing.wol", "app"], ["trusted.wol", "app"], ["weather.wolplug", "plugin"]]) {
  const bytes = fx(file);
  const p = join(root, "fixtures", file);
  assert.equal(wasm.check(bytes, kind), native("check", kind, p), `check ${file}`);
  assert.equal(wasm.verify(bytes, kind, store, Number(now)), native("verify", kind, p, "--store", join(root, "fixtures/store.json"), "--now", now), `verify ${file}`);
  assert.equal(wasm.inspect(bytes, kind, store, Number(now)), native("inspect", kind, p, "--store", join(root, "fixtures/store.json"), "--now", now), `inspect ${file}`);
  same.push(file);
}
ok(`check, verify and inspect of ${same.length} files print the native bytes`);

const person = JSON.parse(wasm.inspect(fx("person.wol"), "app", store, Number(now)));
assert.deepEqual(Object.keys(person).sort(), ["cert", "facts", "file", "findings", "trust", "verdict"]);
const trusted = JSON.parse(wasm.inspect(fx("trusted.wol"), "app", store, Number(now)));
assert.deepEqual([trusted.trust, trusted.cert.class, typeof trusted.cert.origin_cert], ["trusted", "trusted", "string"]);
const fcBytes = fx("person.filecert");
const withFc = wasm.inspect(fx("person.wol"), "app", store, Number(now), fcBytes);
assert.equal(withFc, native("inspect", "app", join(root, "fixtures/person.wol"), "--store", join(root, "fixtures/store.json"), "--now", now, "--file-cert", join(root, "fixtures/person.filecert")));
assert.deepEqual(JSON.parse(withFc).file_certificate, { serial: "a1b2c3d4e5f60718", checked_at: Number(now) - 3600, verdict: "pass" });
assert.equal(wasm.verify(fx("person.wol"), "app", store, Number(now), fcBytes), native("verify", "app", join(root, "fixtures/person.wol"), "--store", join(root, "fixtures/store.json"), "--now", now, "--file-cert", join(root, "fixtures/person.filecert")));
assert.equal(JSON.parse(wasm.inspect(fx("org.wol"), "app", store, Number(now), fcBytes)).trust, "invalid");
const listing = JSON.parse(wasm.inspect(fx("listing.wol"), "app", store, Number(now)));
assert.equal(listing.verdict, "pass");
assert.deepEqual(listing.facts.screenshots.map((s) => [s.path, s.mime, s.w, s.h]), [["screenshots/1.png", "image/png", 640, 400], ["screenshots/2.webp", "image/webp", 1280, 800]]);
assert.deepEqual([listing.facts.icon.w, listing.facts.icon.h, listing.facts.licence, listing.facts.homepage], [256, 256, "MIT", "https://example.org/notes"]);
assert.deepEqual(listing.findings.map((f) => f.rule), ["listing/screenshot"]);
assert.deepEqual(person.file, { id: "alice.notes", version: "1.0" });
assert.equal(person.trust, "origin");
assert.equal(person.cert.class, "origin");
assert.equal(JSON.parse(wasm.inspect(fx("wolos.wol"), "app", store, Number(now))).cert.class, undefined);
assert.equal(person.verdict, "pass");
assert.equal(JSON.parse(wasm.inspect(fx("wolos.wol"), "app", store, Number(now))).trust, "wolos");
assert.equal(JSON.parse(wasm.verify(fx("namespace.wol"), "app", store, Number(now))).code, "wrong-namespace");
const origin = JSON.parse(wasm.inspect(fx("origin.wol"), "app", store, Number(now)));
assert.equal(origin.trust, "origin");
assert.equal(origin.origin.repo, "https://github.com/alice/notes");
assert.equal(JSON.parse(wasm.inspect(fx("weather.wolplug"), "plugin", store, Number(now))).findings.some((f) => f.rule === "file/not-compressed" || f.rule === "file/compressed"), false);
ok("fixture .wol: origin class, wolos, wrong namespace, origin; the zstd .wolplug is unpacked");

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
