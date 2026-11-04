// SPDX-License-Identifier: GPL-2.0-or-later
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { acceptCla, alice, FakeGitHub, install, makeEnv, req, SCHEMA, SECRETS, signIn } from "./harness";
import { ROUTES } from "../src/index";
import { purge } from "../src/ratelimit";
import { scrub } from "../src/log";

let gh: FakeGitHub, undo: () => void, env: ReturnType<typeof makeEnv>;
beforeEach(() => { gh = new FakeGitHub(); undo = install(gh); env = makeEnv(); });
afterEach(() => undo());

for (const store of ["d1", "kv"]) {
  test(`sign-in is limited to 10 a minute per address (${store} store), other addresses unaffected`, async () => {
    const e = makeEnv({ RATE_STORE: store });
    for (let i = 0; i < 10; i++) expect((await req(e, "GET", "/auth/login", { ip: "198.51.100.1" })).status).toBe(302);
    const r = await req(e, "GET", "/auth/login", { ip: "198.51.100.1" });
    expect(r.status).toBe(429);
    expect(((await r.json()) as any).error).toBe("slow-down");
    expect(Number(r.headers.get("retry-after"))).toBeLessThanOrEqual(60);
    expect((await req(e, "GET", "/auth/login", { ip: "198.51.100.2" })).status).toBe(302);
    if (store === "kv") expect(e.KV.writes).toBe(12); else expect(e.KV.writes).toBe(0);
  });
}

test("writes are limited per person across addresses", async () => {
  const c = await signIn(env, gh, alice);
  await acceptCla(env, c);
  let last = 0;
  for (let i = 0; i < 31; i++) {
    last = (await req(env, "POST", "/api/listings", { cookie: c, ip: `192.0.2.${i}`, body: { id: "bad" } })).status;
  }
  expect(last).toBe(429);
});

test("the daily purge removes old counters and deliveries", async () => {
  env.DB.sqlite.exec("INSERT INTO rate_counters VALUES ('x', 0, 5), ('y', 9999999999, 1); INSERT INTO deliveries VALUES ('d', 'release', 0)");
  await purge(env);
  expect(env.DB.sqlite.query("SELECT key FROM rate_counters").all()).toEqual([{ key: "y" }]);
  expect(env.DB.sqlite.query("SELECT count(*) AS n FROM deliveries").get()).toEqual({ n: 0 });
});

test("API bodies over 16 KiB are refused, with or without Content-Length; only JSON objects are read", async () => {
  const c = await signIn(env, gh, alice);
  const big = JSON.stringify({ text: "x".repeat(17 * 1024) });
  expect((await req(env, "POST", "/api/reports", { cookie: c, body: big })).status).toBe(413);
  const stream = new ReadableStream({ start(ctl) { ctl.enqueue(new TextEncoder().encode(big)); ctl.close(); } });
  const r = await req(env, "POST", "/api/cla", { cookie: c, body: stream as never, headers: { "content-type": "application/json" } });
  expect(r.status).toBe(413);
  expect((await req(env, "POST", "/api/cla", { cookie: c, body: "[1]" })).status).toBe(400);
  expect((await req(env, "POST", "/api/cla", { cookie: c, body: "{}", headers: { "content-type": "text/plain" } })).status).toBe(415);
});

test("unknown paths are 404, wrong methods 405, errors are {error, sentence}", async () => {
  const r1 = await req(env, "GET", "/api/nothing");
  expect(r1.status).toBe(404);
  expect(Object.keys(await r1.json() as object)).toEqual(["error", "sentence"]);
  const r2 = await req(env, "DELETE", "/api/me");
  expect(r2.status).toBe(405);
  expect(r2.headers.get("allow")).toBe("GET");
  expect(r1.headers.get("cache-control")).toBe("no-store");
});

test("without its secrets the Worker refuses to run", async () => {
  const e = makeEnv({ SESSION_SECRET: "" });
  expect((await req(e, "GET", "/auth/login")).status).toBe(503);
});

test("no secret, token or cookie reaches the logs", async () => {
  const lines: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...a: unknown[]) => { lines.push(a.join(" ")); });
  const err = spyOn(console, "error").mockImplementation((...a: unknown[]) => { lines.push(a.join(" ")); });
  try {
    const c = await signIn(env, gh, alice);
    await req(env, "GET", "/api/me", { cookie: c });
    await req(env, "POST", "/auth/logout", { cookie: c });
    const all = lines.join("\n");
    for (const s of Object.values(SECRETS)) expect(all).not.toContain(s);
    expect(all).not.toContain("ghu_");
    expect(all).not.toContain(c.split("=")[1]);
  } finally { spy.mockRestore(); err.mockRestore(); }
  expect(scrub({ token: "abc", nested: { msg: "ghu_abcdefghijklmnop leaked" } })).toEqual({ token: "[redacted]", nested: { msg: "[redacted] leaked" } });
});

test("the frozen route table (I4)", () => {
  expect(ROUTES.map((r) => `${r.method} ${r.path.source}`)).toMatchSnapshot();
});

test("migrations applied in order give exactly schema.sql, and only add", () => {
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  expect(files[0]).toBe("0001_initial.sql");
  const a = new Database(":memory:"), b = new Database(":memory:");
  for (const f of files) {
    const sql = readFileSync(new URL(f, dir), "utf8");
    if (f !== "0001_initial.sql") expect(sql).not.toMatch(/\b(DROP|RENAME|ALTER\s+TABLE\s+\w+\s+DROP)\b/i);
    a.exec(sql);
  }
  b.exec(SCHEMA);
  const shape = (d: Database) => d.query("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  expect(shape(a)).toEqual(shape(b));
  const tables = (b.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
  expect(tables).toEqual(["audit_log", "cla_acceptances", "deliveries", "listings", "memberships", "orgs", "persons", "rate_counters", "releases", "reports", "verdicts"]);
});
