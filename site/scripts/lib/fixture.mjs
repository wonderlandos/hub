// SPDX-License-Identifier: GPL-2.0-or-later
// The review catalogue in data/ (index.json, statements/, facts/) is invented: its makers are not real
// publishers. It is built only with HUB_FIXTURE=1, and then every page says so and asks not to be indexed.
// A production build (no HUB_FIXTURE) must not carry one byte of it: fixtureLeaks() finds the invented
// GitHub logins anywhere in dist/, and the build and check-fixture.mjs fail on any hit.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** The GitHub logins the fixture invents (data/index.json owners). They exist on GitHub, so they must never be linked for real. */
export const FIXTURE_LOGINS = ["alicedoe", "examplelabs", "rivertools"];
export const FIXTURE_BANNER = "Example data for review, not real publishers";
/** The marker a fixture build puts in every page head; the checks read the build's mode from it. */
export const FIXTURE_META = '<meta name="hub-fixture" content="1">';

const files = (d, out = []) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? files(p, out) : out.push(p); } return out; };

/** Every file of `dist` that names a fixture login, as "path: login". */
export function fixtureLeaks(dist) {
  const re = new RegExp(`(?<![A-Za-z0-9-])(?:${FIXTURE_LOGINS.join("|")})(?![A-Za-z0-9-])`, "i");
  const out = [];
  for (const f of files(dist)) {
    const rel = relative(dist, f).replace(/\\/g, "/"), m = re.exec(rel) || re.exec(readFileSync(f).toString("latin1"));
    if (m) out.push(`${rel}: ${m[0]}`);
  }
  return out;
}
export const allFiles = files;
