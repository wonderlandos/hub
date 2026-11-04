// SPDX-License-Identifier: GPL-2.0-or-later
// Fixed-window rate limits, per address and per person.
// Default store is D1 (one UPSERT per limited request; the free plan allows about 100,000
// writes a day). The KV store is kept for comparison: free KV allows only about 1,000
// writes a day and is eventually consistent, so it under-counts bursts.

import type { Env } from "./env";
import { now } from "./env";
import { fail } from "./http";

export interface Rule { name: string; limit: number; window: number }

export const RULES = {
  signIn: { name: "sign-in", limit: 10, window: 60 },          // per address
  writeIp: { name: "write-ip", limit: 60, window: 60 },        // any POST, per address
  writePerson: { name: "write-person", limit: 30, window: 60 }, // any POST, per person
  reports: { name: "reports", limit: 5, window: 86400 },       // per person
  releases: { name: "releases", limit: 20, window: 86400 },    // per listing owner
  pipeline: { name: "pipeline", limit: 120, window: 60 },      // per pipeline run
} satisfies Record<string, Rule>;

export const MAX_LISTINGS_PER_PERSON = 50;

async function bumpD1(db: D1Database, key: string, win: number): Promise<number> {
  const row = await db.prepare(
    "INSERT INTO rate_counters (key, win, count) VALUES (?, ?, 1) " +
    "ON CONFLICT (key, win) DO UPDATE SET count = count + 1 RETURNING count",
  ).bind(key, win).first<{ count: number }>();
  return row?.count ?? 1;
}

async function bumpKv(kv: KVNamespace, key: string, win: number, ttl: number): Promise<number> {
  const k = `rl:${key}:${win}`;
  const n = Number((await kv.get(k)) ?? "0") + 1;
  await kv.put(k, String(n), { expirationTtl: Math.max(60, ttl) });
  return n;
}

/** Counts one hit; throws 429 with Retry-After when the limit is passed. */
export async function limit(env: Env, rule: Rule, who: string | number): Promise<void> {
  const t = now();
  const win = Math.floor(t / rule.window) * rule.window;
  const key = `${rule.name}:${who}`;
  const n = env.RATE_STORE === "kv" ? await bumpKv(env.KV, key, win, rule.window) : await bumpD1(env.DB, key, win);
  if (n > rule.limit) {
    const retry = win + rule.window - t;
    fail(429, "slow-down", `Too many requests. Try again in ${retry} seconds.`, { "retry-after": String(retry) });
  }
}

/** Daily clean-up from the cron trigger. */
export async function purge(env: Env): Promise<void> {
  const t = now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM rate_counters WHERE win < ?").bind(t - 2 * 86400),
    env.DB.prepare("DELETE FROM deliveries WHERE seen_at < ?").bind(t - 30 * 86400),
  ]);
}
