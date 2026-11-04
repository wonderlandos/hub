// SPDX-License-Identifier: GPL-2.0-or-later
// Bindings, variables and secrets of the hub Worker.

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  // Secrets (wrangler secret put): never logged, never returned.
  GITHUB_APP_ID: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  WEBHOOK_SECRET: string;
  SESSION_SECRET: string;
  /** PEM private key of the GitHub App, for installation tokens (the ca dispatch). Optional: without it an
   * approval is stored and the dispatch is reported as not sent. */
  GITHUB_APP_PRIVATE_KEY?: string;
  // Variables (wrangler.toml).
  HUB_ORIGIN: string;
  OIDC_AUDIENCE: string;
  PIPELINE_REPOSITORY: string;
  PIPELINE_CHECK_WORKFLOW: string;
  PIPELINE_CHECK_ENVIRONMENT: string;
  PIPELINE_SIGN_WORKFLOW: string;
  PIPELINE_SIGN_ENVIRONMENT: string;
  PIPELINE_CA_WORKFLOW: string;
  PIPELINE_CA_ENVIRONMENT: string;
  /** GitHub logins of the hub admins, comma separated (the same list as hub-index's CA_APPROVERS). */
  ADMINS?: string;
  /** "true" sends the ca dispatch as a dry run (TEST CA); anything else issues for real. */
  CA_DISPATCH_DRY_RUN?: string;
  RATE_STORE?: string; // "d1" (default) or "kv"
  CLA_VERSION?: string;
  // Test hooks only; unset in production.
  GITHUB_WEB?: string; // default https://github.com
  GITHUB_API?: string; // default https://api.github.com
  OIDC_ISSUER?: string; // default https://token.actions.githubusercontent.com
}

export const SECRETS = ["GITHUB_APP_ID", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "WEBHOOK_SECRET", "SESSION_SECRET"] as const;

export const ghWeb = (env: Env) => env.GITHUB_WEB ?? "https://github.com";
export const ghApi = (env: Env) => env.GITHUB_API ?? "https://api.github.com";
export const oidcIssuer = (env: Env) => env.OIDC_ISSUER ?? "https://token.actions.githubusercontent.com";

/** The hub admins, lower case. */
export const admins = (env: Env): Set<string> =>
  new Set((env.ADMINS ?? "").split(/[\s,]+/).filter(Boolean).map((s) => s.toLowerCase()));

export const now = () => Math.floor(Date.now() / 1000);
