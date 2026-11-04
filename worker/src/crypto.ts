// SPDX-License-Identifier: GPL-2.0-or-later
// Small crypto helpers on Web Crypto. Only HMAC, AES-GCM for the session's GitHub token,
// and RS256 verification of pipeline tokens: the Worker never signs or hashes artefacts.

export type Bytes = Uint8Array<ArrayBuffer>;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes: Bytes | ArrayBuffer): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64url(s: string): Bytes {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("bad base64url");
  const p = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(p);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const utf8 = (s: string) => enc.encode(s);
export const fromUtf8 = (b: Bytes) => dec.decode(b);

export function hex(b: ArrayBuffer | Bytes): string {
  return [...(b instanceof Uint8Array ? b : new Uint8Array(b))].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function random(n = 32): Bytes {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Constant-time comparison of two strings (length leaks, content does not). */
export function same(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string, label: string): Promise<CryptoKey> {
  const id = label + "\0" + secret;
  let k = keyCache.get(id);
  if (!k) {
    // Derive one key per purpose so a session MAC can never pass as anything else.
    k = crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
      .then((root) => crypto.subtle.sign("HMAC", root, enc.encode(label)))
      .then((raw) => crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]));
    keyCache.set(id, k);
  }
  return k;
}
export async function hmac(secret: string, label: string, data: string | Bytes): Promise<Bytes> {
  const k = await hmacKey(secret, label);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, typeof data === "string" ? enc.encode(data) : data));
}

/** GitHub webhook signature: "sha256=" + hex HMAC-SHA256 of the raw body with the webhook secret. */
export async function webhookSignature(secret: string, body: Bytes): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + hex(await crypto.subtle.sign("HMAC", k, body));
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const raw = await hmac(secret, "hub token encryption v1", "key");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export async function seal(secret: string, plain: string): Promise<string> {
  const iv = random(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), enc.encode(plain));
  return b64url(iv) + "." + b64url(ct);
}
export async function unseal(secret: string, sealed: string): Promise<string | null> {
  const [iv, ct] = sealed.split(".");
  if (!iv || !ct) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(iv) }, await aesKey(secret), unb64url(ct));
    return dec.decode(pt);
  } catch {
    return null;
  }
}

export async function sha256hex(data: string | Bytes): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data));
}

/** PKCE S256 challenge for a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", enc.encode(verifier)));
}
