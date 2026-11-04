// SPDX-License-Identifier: GPL-2.0-or-later
// The invented review catalogue (data/index.json: makers that do not exist, TEST-signed statements, links into
// GitHub repositories that do not exist under logins that do) never reaches hub.wolos.org (QA-WEB-PRIVACY-1).
// This builds the hub three ways into temporary folders and checks each:
//   1. production (no HUB_FIXTURE): the catalogue is empty, not one invented login is anywhere in dist/, no
//      review marker, the sitemap and robots.txt are the real ones, no fixture picture;
//   2. review (HUB_FIXTURE=1): every page says it is example data and asks not to be indexed, robots.txt
//      disallows everything and names no sitemap, and the scanner does find the invented logins (so 1. means something);
//   3. production given the fixture index by mistake (HUB_INDEX=data/index.json): the build FAILS.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { at } from "./lib/paths.mjs";
import { FIXTURE_BANNER, FIXTURE_LOGINS, FIXTURE_META, allFiles, fixtureLeaks } from "./lib/fixture.mjs";

const bad = [];
const tmp = mkdtempSync(join(tmpdir(), "hub-fixture-"));
const run = (dist, env) => spawnSync(process.execPath, [at("scripts/build.mjs")], { env: { ...process.env, HUB_FIXTURE: "", HUB_INDEX: "", ...env, DIST: dist }, encoding: "utf8" });
const read = (dist, f) => (existsSync(join(dist, f)) ? readFileSync(join(dist, f), "utf8") : null);
const htmls = (dist) => allFiles(dist).filter((f) => f.endsWith(".html"));

try {
  // 1. production
  const prod = join(tmp, "prod"), r1 = run(prod, {});
  if (r1.status !== 0) bad.push(`production build failed: ${r1.stderr.trim().split("\n")[0]}`);
  else {
    const leaks = fixtureLeaks(prod);
    if (leaks.length) bad.push(`production dist names the invented makers: ${leaks.slice(0, 5).join("; ")}`);
    const marked = htmls(prod).filter((f) => readFileSync(f, "utf8").includes(FIXTURE_META));
    if (marked.length) bad.push(`production pages carry the review marker: ${marked.length}`);
    if (!/Disallow: \/auth\//.test(read(prod, "robots.txt") ?? "") || !/Sitemap:/.test(read(prod, "robots.txt") ?? "")) bad.push("production robots.txt is not the real one");
    if (!existsSync(join(prod, "sitemap.xml"))) bad.push("production has no sitemap.xml");
    if (existsSync(join(prod, "img/listings"))) bad.push("production dist carries the pictures of the invented listings (img/listings)");
    if (existsSync(join(prod, "statements"))) bad.push("production dist carries statements (the empty catalogue has none)");
    const search = JSON.parse(read(prod, "search.json") ?? "null");
    if (!Array.isArray(search) || search.length) bad.push("production search.json is not empty");
    if (/^\/\*\n  X-Robots-Tag/m.test(read(prod, "_headers") ?? "")) bad.push("production _headers asks for noindex on everything");
  }
  // 2. review
  const rev = join(tmp, "review"), r2 = run(rev, { HUB_FIXTURE: "1" });
  if (r2.status !== 0) bad.push(`review build failed: ${r2.stderr.trim().split("\n")[0]}`);
  else {
    const pages = htmls(rev).filter((f) => !f.endsWith("admin/index.html"));
    const unmarked = pages.filter((f) => { const h = readFileSync(f, "utf8"); return !h.includes(FIXTURE_META) || !/<meta name="robots" content="noindex, nofollow">/.test(h) || !h.includes(FIXTURE_BANNER); });
    if (unmarked.length) bad.push(`${unmarked.length} review page(s) do not say they are example data and noindex: ${unmarked[0]}`);
    if (read(rev, "robots.txt") !== "User-agent: *\nDisallow: /\n") bad.push("review robots.txt does not disallow everything");
    // The sitemap file exists (the link check reads it) but nothing points crawlers at it, and noindex covers every page.
    if (!/^\/\*\n  X-Robots-Tag: noindex, nofollow$/m.test(read(rev, "_headers") ?? "")) bad.push("review _headers has no X-Robots-Tag noindex for /*");
    const found = new Set(fixtureLeaks(rev).map((l) => l.split(": ")[1].toLowerCase()));
    for (const l of FIXTURE_LOGINS) if (!found.has(l)) bad.push(`the scanner did not find the invented login ${l} in the review build: it would miss a leak`);
  }
  // 3. the fixture index handed to a production build
  const r3 = run(join(tmp, "mistake"), { HUB_INDEX: at("data/index.json") });
  if (r3.status === 0) bad.push("a production build given the fixture index did not fail");
  else if (!/invented review makers/.test(r3.stderr)) bad.push(`that build failed for another reason: ${r3.stderr.trim().split("\n")[0]}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (bad.length) { console.error(`check-fixture: ${bad.length} problem(s)\n  ${bad.join("\n  ")}`); process.exit(1); }
console.log(`check-fixture: production hub has an empty catalogue and none of the ${FIXTURE_LOGINS.length} invented logins; the review build is marked, noindex and names no sitemap; the fixture index in a production build fails`);
