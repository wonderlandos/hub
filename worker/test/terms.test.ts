// SPDX-License-Identifier: GPL-2.0-or-later
// The accepted texts from legal/: served exactly, versioned, hashed, accepted at the right moment.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { acceptCla, acceptTerms, alice, FakeGitHub, install, makeEnv, req, signIn, termsAnswer } from "./harness";
import { textVersion } from "../src/cla";

let gh: FakeGitHub, undo: () => void, env: ReturnType<typeof makeEnv>;
beforeEach(() => { gh = new FakeGitHub(); undo = install(gh); env = makeEnv(); });
afterEach(() => undo());

// The texts live in the repository's legal/ folder; legal/README.md lists the SHA-256 of each.
const FILES = { cla: "CLA.md", publisher: "PUBLISHER-AGREEMENT.md", trust: "TRUST-TERMS.md", certificates: "CERTIFICATE-TERMS.md" } as const;
const LEGAL = new URL("../../legal/", import.meta.url);
const file = (doc: keyof typeof FILES) => readFileSync(new URL(FILES[doc], LEGAL));
const README = readFileSync(new URL("README.md", LEGAL), "utf8");

for (const doc of Object.keys(FILES) as (keyof typeof FILES)[]) {
  test(`${doc}: served byte for byte, its hash is the file's and legal/README.md's, its version is its version line`, async () => {
    const r = await req(env, "GET", `/api/terms/${doc}`);
    expect(r.status).toBe(200);
    const b = (await r.json()) as any;
    const bytes = file(doc);
    expect(b.text).toBe(bytes.toString("utf8"));
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(b.sha256).toBe(hash);
    const row = README.split("\n").find((l) => l.startsWith(`| \`${FILES[doc]}\` |`));
    expect(row).toContain(`\`${hash}\``);
    expect(b.version).toBe(textVersion(bytes.toString("utf8"))!);
    expect(b.doc).toBe(doc);
  });

  test(`${doc}: version line, contact, and the hub's wording`, () => {
    const t = file(doc).toString("utf8");
    expect(t).toMatch(/^Version 1, effective 2026-11-04\.$/m);
    if (doc !== "cla" && doc !== "trust") expect(t).toContain("julia@wolos.org");
    // Store and hub wording rule: "checked" and "verified identity", never these.
    expect(t).not.toMatch(/\bsafe\b|\bsafety\b|\bsecure\b|approved software/i);
    expect(t).not.toContain("\r");
  });
}

test("the trust terms say what a certificate states and point to the Certificate Terms", () => {
  const t = file("trust").toString("utf8");
  for (const s of ["Identity", "Repository", "at any time", "To the extent the law allows", "/terms/certificates"]) expect(t).toContain(s);
});

test("the Certificate Terms are served but accepted only with a certificate request", async () => {
  const c = await signIn(env, gh, alice);
  const r = await req(env, "POST", "/api/terms/certificates", { cookie: c, body: await termsAnswer(env, "certificates") });
  expect([r.status, ((await r.json()) as any).error]).toEqual([400, "with-the-request"]);
});

test("GET /api/cla is the CLA of /api/terms/cla; wrangler.toml names its version", async () => {
  const a = (await (await req(env, "GET", "/api/cla")).json()) as any;
  const b = (await (await req(env, "GET", "/api/terms/cla")).json()) as any;
  expect(a).toEqual({ version: b.version, text: b.text, sha256: b.sha256 });
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  expect(toml).toContain(`CLA_VERSION = "${b.version}"`);
  expect((await req(env, "GET", "/api/terms/privacy")).status).toBe(404);
});

test("publishing needs the Publisher Agreement; /api/me shows both terms; a stale hash is refused", async () => {
  const c = await signIn(env, gh, alice);
  await acceptCla(env, c, false);
  gh.repos.set("Alice/notes", { id: 9001, full_name: "Alice/notes", private: false, owner: { id: 1001, login: "Alice", type: "User" } });
  const listing = { id: "alice.notes", kind: "app", repo: "Alice/notes", asset: "notes.wol", name: "Notes", summary: "Write notes.", license: "MIT" };
  const r1 = await req(env, "POST", "/api/listings", { cookie: c, body: listing });
  expect([r1.status, ((await r1.json()) as any).error]).toEqual([403, "publisher-terms-needed"]);
  let me = (await (await req(env, "GET", "/api/me", { cookie: c })).json()) as any;
  expect(me.terms.publisher).toMatchObject({ current: "1", accepted: null, ok: false });
  expect(me.terms.trust).toMatchObject({ current: "1", accepted: null, ok: false });
  // a stale hash, a wrong origin
  expect((await req(env, "POST", "/api/terms/publisher", { cookie: c, body: { version: "1", sha256: "0".repeat(64) } })).status).toBe(409);
  expect((await req(env, "POST", "/api/terms/publisher", { cookie: c, body: await termsAnswer(env, "publisher"), origin: "https://evil.test" })).status).toBe(403);
  expect((await acceptTerms(env, c, "publisher")).status).toBe(200);
  expect((await req(env, "POST", "/api/listings", { cookie: c, body: listing })).status).toBe(201);
  me = (await (await req(env, "GET", "/api/me", { cookie: c })).json()) as any;
  expect(me.terms.publisher).toMatchObject({ accepted: "1", ok: true });
  expect(env.DB.sqlite.query("SELECT doc, github_id, version FROM terms_acceptances").all()).toEqual([{ doc: "publisher", github_id: 1001, version: "1" }]);
  // POST /api/terms/cla is the CLA acceptance
  expect((await req(env, "POST", "/api/terms/cla", { cookie: c, body: await termsAnswer(env, "cla") })).status).toBe(200);
});
