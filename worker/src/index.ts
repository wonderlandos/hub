// SPDX-License-Identifier: GPL-2.0-or-later
// hub.wolos.org Worker (I4): routes /auth/* and /api/*; the static site serves the rest.

import type { Env } from "./env";
import { SECRETS } from "./env";
import { makeCtx, type Ctx } from "./ctx";
import { errorResponse, fail, HttpError, json } from "./http";
import { limit, purge, RULES } from "./ratelimit";
import { callback, login, logout, me } from "./auth";
import { getCla, getTerms, postCla, postTerms } from "./cla";
import { getOrgs, postOrgs } from "./orgs";
import { getListing, postListing } from "./listings";
import { webhook } from "./webhook";
import { getReport, postReport } from "./reports";
import { getPreview } from "./preview";
import { exportIndex, pending, postVerdicts } from "./pipeline";
import { getCerts, getMyCertRequests, pipelineCerts, pipelineRequest, postCertRequest } from "./certs";
import { approveRequest, queue, refuseRequest, resolveReport, takedown } from "./admin";
import { log } from "./log";

export type { Env };

type Handler = (ctx: Ctx, ...params: string[]) => Promise<Response>;
interface Route { method: "GET" | "POST"; path: RegExp; handler: Handler; ipLimit?: boolean }

/** The frozen I4 table. ipLimit marks person-facing writes counted per address. */
export const ROUTES: Route[] = [
  { method: "GET", path: /^\/auth\/login$/, handler: login },
  { method: "GET", path: /^\/auth\/callback$/, handler: callback },
  { method: "POST", path: /^\/auth\/logout$/, handler: logout, ipLimit: true },
  { method: "GET", path: /^\/api\/me$/, handler: me },
  { method: "GET", path: /^\/api\/cla$/, handler: getCla },
  { method: "POST", path: /^\/api\/cla$/, handler: postCla, ipLimit: true },
  { method: "GET", path: /^\/api\/orgs$/, handler: getOrgs },
  { method: "POST", path: /^\/api\/orgs$/, handler: postOrgs, ipLimit: true },
  { method: "POST", path: /^\/api\/listings$/, handler: postListing, ipLimit: true },
  { method: "GET", path: /^\/api\/listings\/([^/]{1,128})$/, handler: getListing },
  { method: "POST", path: /^\/api\/webhook\/github$/, handler: webhook },
  { method: "POST", path: /^\/api\/reports$/, handler: postReport, ipLimit: true },
  { method: "GET", path: /^\/api\/reports\/([^/]{1,20})$/, handler: getReport },
  { method: "GET", path: /^\/api\/index\/preview$/, handler: getPreview },
  { method: "GET", path: /^\/api\/pipeline\/pending$/, handler: pending },
  { method: "POST", path: /^\/api\/pipeline\/verdicts$/, handler: postVerdicts },
  { method: "GET", path: /^\/api\/pipeline\/export$/, handler: exportIndex },
  // Phase 2: the agreements, certificates and the admin panel.
  { method: "GET", path: /^\/api\/terms\/([a-z]{1,16})$/, handler: getTerms },
  { method: "POST", path: /^\/api\/terms\/([a-z]{1,16})$/, handler: postTerms, ipLimit: true },
  { method: "POST", path: /^\/api\/cert\/request$/, handler: postCertRequest, ipLimit: true },
  { method: "GET", path: /^\/api\/cert\/requests$/, handler: getMyCertRequests },
  { method: "GET", path: /^\/api\/certs\/([^/]{1,39})$/, handler: getCerts },
  { method: "GET", path: /^\/api\/pipeline\/requests\/([^/]{1,64})$/, handler: pipelineRequest },
  { method: "POST", path: /^\/api\/pipeline\/certs$/, handler: pipelineCerts },
  { method: "GET", path: /^\/api\/admin\/queue$/, handler: queue },
  { method: "POST", path: /^\/api\/admin\/requests\/([^/]{1,64})\/approve$/, handler: approveRequest, ipLimit: true },
  { method: "POST", path: /^\/api\/admin\/requests\/([^/]{1,64})\/refuse$/, handler: refuseRequest, ipLimit: true },
  { method: "POST", path: /^\/api\/admin\/reports\/([^/]{1,20})\/resolve$/, handler: resolveReport, ipLimit: true },
  { method: "POST", path: /^\/api\/admin\/reports\/([^/]{1,20})\/takedown$/, handler: takedown, ipLimit: true },
];

function withCookies(r: Response, cookies: string[]): Response {
  if (!cookies.length) return r;
  const out = new Response(r.body, r);
  for (const c of cookies) out.headers.append("set-cookie", c);
  return out;
}

export async function handle(req: Request, env: Env, exec?: ExecutionContext): Promise<Response> {
  const ctx = makeCtx(req, env, exec);
  try {
    if (SECRETS.some((k) => !env[k])) fail(503, "not-configured", "The hub is not set up yet.");
    const path = ctx.url.pathname;
    const method = req.method === "HEAD" ? "GET" : req.method;
    const matching = ROUTES.filter((r) => r.path.test(path));
    if (!matching.length) fail(404, "not-found", "There is nothing at this address.");
    const route = matching.find((r) => r.method === method);
    if (!route) fail(405, "wrong-method", `Use ${matching.map((r) => r.method).join(" or ")}.`, { allow: matching.map((r) => r.method).join(", ") });
    if (route!.ipLimit) await limit(env, RULES.writeIp, ctx.ip);
    const params = (path.match(route!.path) ?? []).slice(1).map((p) => {
      try { return decodeURIComponent(p); } catch { return ""; }
    });
    return withCookies(await route!.handler(ctx, ...params), ctx.cookies);
  } catch (e) {
    if (e instanceof HttpError) return withCookies(errorResponse(e), ctx.cookies);
    log("error", { path: ctx.url.pathname, message: e instanceof Error ? e.message : String(e) });
    return json({ error: "internal", sentence: "Something went wrong on the hub. Try again." }, 500);
  }
}

export default {
  fetch: (req: Request, env: Env, exec: ExecutionContext) => handle(req, env, exec),
  async scheduled(_c: ScheduledController, env: Env, exec: ExecutionContext) {
    exec.waitUntil(purge(env));
  },
} satisfies ExportedHandler<Env>;
