// SPDX-License-Identifier: GPL-2.0-or-later
// Per-request context shared by the route handlers.

import type { Env } from "./env";
import { clientIp } from "./http";

export interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  ip: string;
  /** Set-Cookie headers to add to whatever response the handler returns. */
  cookies: string[];
  waitUntil(p: Promise<unknown>): void;
}

export function makeCtx(req: Request, env: Env, exec?: { waitUntil(p: Promise<unknown>): void }): Ctx {
  return {
    req, env, url: new URL(req.url), ip: clientIp(req), cookies: [],
    waitUntil: (p) => (exec ? exec.waitUntil(p) : void p.catch(() => {})),
  };
}
