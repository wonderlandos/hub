// SPDX-License-Identifier: GPL-2.0-or-later
// Responses, errors, body limits, cookies.

import type { Env } from "./env";

export class HttpError extends Error {
  constructor(public status: number, public code: string, public sentence: string, public headers: Record<string, string> = {}) {
    super(code);
  }
}
export const fail = (status: number, code: string, sentence: string, headers: Record<string, string> = {}): never => {
  throw new HttpError(status, code, sentence, headers);
};

const BASE = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

export function json(body: unknown, status = 200, headers: Record<string, string> | Headers = {}): Response {
  const h = new Headers(BASE);
  new Headers(headers).forEach((v, k) => h.append(k, v));
  return new Response(JSON.stringify(body), { status, headers: h });
}
export function errorResponse(e: HttpError): Response {
  return json({ error: e.code, sentence: e.sentence }, e.status, e.headers);
}

/** Size caps per kind of request body, in bytes. */
export const LIMITS = { api: 16 * 1024, webhook: 512 * 1024, verdicts: 256 * 1024 } as const;

/** Reads the body, refusing anything larger than max even when Content-Length is missing or wrong. */
export async function readBody(req: Request, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > max) fail(413, "too-large", `The request is larger than ${max} bytes.`);
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel();
      fail(413, "too-large", `The request is larger than ${max} bytes.`);
    }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

export async function readJson<T = Record<string, unknown>>(req: Request, max: number = LIMITS.api): Promise<T> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().startsWith("application/json")) fail(415, "not-json", "Send the body as application/json.");
  const raw = await readBody(req, max);
  try {
    const v = JSON.parse(new TextDecoder().decode(raw));
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as T;
  } catch {
    return fail(400, "bad-json", "The body is not a JSON object.");
  }
}

export function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function setCookie(name: string, value: string, maxAge: number): string {
  // __Host- cookies must be Secure, Path=/ and carry no Domain.
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

/** State-changing requests that rely on the session cookie must come from the hub itself. */
export function sameOrigin(req: Request, env: Env): void {
  const origin = req.headers.get("origin");
  if (origin !== env.HUB_ORIGIN) fail(403, "wrong-origin", "This action can only be done from the hub's own pages.");
}

export function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}

/** Plain strings with a length cap; control characters refused. */
export function str(v: unknown, field: string, max: number, min = 1): string {
  if (typeof v !== "string") return fail(400, "bad-field", `'${field}' must be text.`);
  const s = v.trim();
  if (s.length < min || s.length > max) fail(400, "bad-field", `'${field}' must be ${min} to ${max} characters.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)) fail(400, "bad-field", `'${field}' contains control characters.`);
  return s;
}
