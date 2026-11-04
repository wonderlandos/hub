// SPDX-License-Identifier: GPL-2.0-or-later
// Measures a running local Worker (wrangler dev --local, real workerd and local D1):
// time to first answer after start, then p50/p95 per route. Usage:
//   bun bench/bench.ts http://127.0.0.1:8799 [webhook-secret]
import { webhookSignature } from "../src/crypto";

const base = process.argv[2] ?? "http://127.0.0.1:8799";
const secret = process.argv[3] ?? "test-webhook-secret-fedcba9876543210";
const N = Number(process.env.N ?? 200);

async function time(f: () => Promise<Response>): Promise<[number, number]> {
  const t = performance.now();
  const r = await f();
  await r.arrayBuffer();
  return [performance.now() - t, r.status];
}
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];

const hook = async () => {
  const body = new TextEncoder().encode(JSON.stringify({ action: "published", repository: { id: 1, full_name: "a/b" },
    release: { tag_name: "v1", draft: false, prerelease: false, assets: [] } }));
  return fetch(`${base}/api/webhook/github`, { method: "POST", body, headers: {
    "content-type": "application/json", "x-github-event": "release", "x-github-delivery": crypto.randomUUID(),
    "x-hub-signature-256": await webhookSignature(secret, body) } });
};
const routes: Record<string, () => Promise<Response>> = {
  "GET /api/cla": () => fetch(`${base}/api/cla`),
  "GET /api/index/preview": () => fetch(`${base}/api/index/preview`),
  "GET /api/listings/:id (404)": () => fetch(`${base}/api/listings/alice.none`),
  "GET /api/me (401)": () => fetch(`${base}/api/me`),
  "GET /auth/login (D1 counter)": () => fetch(`${base}/auth/login`, { redirect: "manual", headers: { "cf-connecting-ip": crypto.randomUUID() } }),
  "POST /api/webhook/github": hook,
};
const [first, st] = await time(routes["GET /api/cla"]);
console.log(`first request after start: ${first.toFixed(1)} ms (status ${st})`);
for (const [name, f] of Object.entries(routes)) {
  const xs: number[] = []; const codes = new Set<number>();
  for (let i = 0; i < N; i++) { const [ms, s] = await time(f); xs.push(ms); codes.add(s); }
  console.log(`${name.padEnd(30)} p50 ${pct(xs, 0.5).toFixed(2)} ms  p95 ${pct(xs, 0.95).toFixed(2)} ms  status ${[...codes].join(",")}`);
}
