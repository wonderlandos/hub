// SPDX-License-Identifier: GPL-2.0-or-later
// The only logger. It prints an event name and a few fields, and scrubs anything
// that looks like a token, a secret or a cookie, so no secret reaches the logs.

const SECRETISH = /(gh[opusr]_[A-Za-z0-9_]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*|sha256=[0-9a-f]{64})/g;
const SECRET_KEYS = /token|secret|cookie|authorization|code|verifier|state|password|session/i;

export function scrub(v: unknown): unknown {
  if (typeof v === "string") return v.replace(SECRETISH, "[redacted]");
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = SECRET_KEYS.test(k) ? "[redacted]" : scrub(x);
    return o;
  }
  return v;
}

export function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...(scrub(fields) as object) }));
}
