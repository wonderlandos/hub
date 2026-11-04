// SPDX-License-Identifier: GPL-2.0-or-later
// The second, private GitHub App "WolOS Hub Pipeline" (installed only on hub-index) acting as itself, for one thing
// only: starting the hub-index ca workflow for an approved certificate request or revocation. An App JWT (RS256,
// GITHUB_PIPELINE_APP_PRIVATE_KEY, iss GITHUB_PIPELINE_APP_ID, at most 10 minutes) finds the App's installation on the
// pipeline repository and asks for an installation token narrowed to that repository and `actions: write`; the token is
// used once for the workflow dispatch and never stored or logged. The public "WolOS Hub" App never gets Actions.

import type { Env } from "./env";
import { ghApi, now } from "./env";
import { b64url, utf8 } from "./crypto";

const TIMEOUT = 8000;
const HEADERS = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "wolos-hub" };

export class DispatchError extends Error {}

/** DER length bytes. */
function derLen(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  for (let x = n; x > 0; x >>= 8) out.unshift(x & 0xff);
  return [0x80 | out.length, ...out];
}

/** GitHub hands out PKCS#1 ("BEGIN RSA PRIVATE KEY"); Web Crypto reads PKCS#8. Wraps the one in the other. */
export function pkcs8Der(pem: string): Uint8Array<ArrayBuffer> {
  const m = pem.match(/-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]+?)-----END (RSA )?PRIVATE KEY-----/);
  if (!m) throw new DispatchError("GITHUB_PIPELINE_APP_PRIVATE_KEY is not a PEM private key");
  const bin = atob(m[2].replace(/\s+/g, ""));
  const der = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (!m[1]) return der;
  // PrivateKeyInfo { version 0, AlgorithmIdentifier { rsaEncryption, NULL }, OCTET STRING { RSAPrivateKey } }
  const alg = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLen(der.length)];
  const inner = [0x02, 0x01, 0x00, ...alg, ...octet];
  return new Uint8Array([0x30, ...derLen(inner.length + der.length), ...inner, ...der]);
}

/** A GitHub App JWT of the pipeline App: iss = its id, valid for 9 minutes from a minute ago (clock drift). */
export async function appJwt(env: Env): Promise<string> {
  if (!env.GITHUB_PIPELINE_APP_PRIVATE_KEY) throw new DispatchError("GITHUB_PIPELINE_APP_PRIVATE_KEY is not set");
  if (!env.GITHUB_PIPELINE_APP_ID || !/^[0-9]{1,12}$/.test(env.GITHUB_PIPELINE_APP_ID)) throw new DispatchError("GITHUB_PIPELINE_APP_ID is not set");
  const key = await crypto.subtle.importKey("pkcs8", pkcs8Der(env.GITHUB_PIPELINE_APP_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const t = now();
  const h = b64url(utf8(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const p = b64url(utf8(JSON.stringify({ iat: t - 60, exp: t + 540, iss: env.GITHUB_PIPELINE_APP_ID })));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

async function call(env: Env, method: string, path: string, auth: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(`${ghApi(env)}${path}`, {
      method, headers: { ...HEADERS, authorization: `Bearer ${auth}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch {
    throw new DispatchError(`GitHub did not answer ${method} ${path}`);
  }
}

/** An installation token for the pipeline repository with actions: write and nothing else. */
export async function pipelineToken(env: Env): Promise<string> {
  const jwt = await appJwt(env);
  const repo = env.PIPELINE_REPOSITORY;
  const inst = await call(env, "GET", `/repos/${repo}/installation`, jwt);
  if (!inst.ok) throw new DispatchError(`the WolOS Hub Pipeline App is not installed on ${repo} (GitHub said ${inst.status})`);
  const id = ((await inst.json()) as { id?: number }).id;
  if (!Number.isSafeInteger(id)) throw new DispatchError("GitHub gave no installation id");
  const tok = await call(env, "POST", `/app/installations/${id}/access_tokens`, jwt, {
    repositories: [repo.split("/")[1]], permissions: { actions: "write" },
  });
  if (!tok.ok) throw new DispatchError(`GitHub refused an installation token with actions: write on ${repo} (${tok.status})`);
  const t = ((await tok.json()) as { token?: string }).token;
  if (!t) throw new DispatchError("GitHub gave no installation token");
  return t;
}

/** The ca workflow file name, from PIPELINE_CA_WORKFLOW ("owner/repo/.github/workflows/ca.yml@refs/heads/main"). */
export function caWorkflowFile(env: Env): string {
  const m = env.PIPELINE_CA_WORKFLOW.match(/\/\.github\/workflows\/([A-Za-z0-9._-]+\.ya?ml)@refs\/heads\/([A-Za-z0-9._\/-]+)$/);
  if (!m) throw new DispatchError("PIPELINE_CA_WORKFLOW names no workflow file");
  return m[1];
}

/** Starts hub-index ca.yml on main for one approved request: an issue (r-...) or a revocation (v-...). */
export async function dispatchCa(env: Env, requestId: string): Promise<void> {
  const token = await pipelineToken(env);
  const file = caWorkflowFile(env);
  const r = await call(env, "POST", `/repos/${env.PIPELINE_REPOSITORY}/actions/workflows/${file}/dispatches`, token, {
    ref: "main", inputs: { request_id: requestId, dry_run: env.CA_DISPATCH_DRY_RUN === "true" ? "true" : "false" },
  });
  if (r.status !== 204 && r.status !== 200) throw new DispatchError(`GitHub did not start ${file} (${r.status})`);
}
