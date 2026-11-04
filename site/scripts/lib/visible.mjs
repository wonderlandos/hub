// What a reader sees on a built page, for the "No engineer talk" rule (DESIGN.md): the text of
// dist/**/index.html with scripts, styles and SVG left out, plus image alt text. Used by
// scripts/check-doctrine.mjs after the build.
//
// Two lists, both matched in that visible text:
//   ENGINEER: path-like and internal tokens (repo paths, file names with .md/.rs/.sh, the changelog
//     by its file name, ADR numbers, release-run ids, the VM tool, test journeys, test- script
//     names, commit ids). Their exact form stays off the site, in docs/SOURCES.md.
//   HEDGES: the lead-report register (2026-11-03): pages speak in the present tense about what
//     WolOS does; what is unfinished is not on the page. Roadmap sentences belong in blog posts.
//
// The hub has no exempt pages. Code blocks (<pre>) are code, not citations. Copied from the WolOS site's
// scripts/lib/visible.mjs; the hub adds HUB_TALK (words that belong to how the hub is built, not to people).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const ENGINEER = [
  [/\b(?:docs|crates|tests)\/[\w./-]*/g, "a repository path"],
  [/[\w-]\.(?:md|rs|sh)\b/g, "a file name"],
  [/CHANGELOG/g, "the changelog by its file name"],
  [/\bADR\s?\d*/g, "a decision record number"],
  [/\brel\d{3,}\b/g, "a release-run id"],
  [/\b(?:on|in) KVM\b|\bKVM virtual/g, "the VM tool as a test caveat"],
  [/\b[Jj]ourneys?\b/g, "a test journey"],
  [/\btest-[\w-]+/g, "a test script name"],
  [/\b(?!ed25519\b)(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, "a commit id"],
];

export const HEDGES = [
  [/\bnot yet\b/gi, "\"not yet\""],
  [/\b(?:is|as) a preview\b|\bPreview in\b/gi, "\"preview\" as a status"],
  [/\bclaimed\b/gi, "\"claimed\""],
  [/\b(?:is|are) planned\b|\bplanned (?:for|too)\b|\bPlanned:/gi, "\"planned\""],
  [/\bunverified\b/gi, "\"unverified\""],
  [/\bin review\b/gi, "\"in review\""],
  [/\bnext build\b/gi, "\"the next build\""],
  [/\bVM figures?\b/gi, "a VM caveat"],
  [/\bnot (?:yet )?proven\b/gi, "\"not proven\""],
  [/\bproven on real hardware\b|\bnot (?:yet )?(?:tested|measured|verified) on real hardware\b/gi, "a real-hardware caveat"],
  [/\bhave not been run\b|\bnot been run again\b|\bnot run on this ISO\b/gi, "an untested-steps caveat"],
  [/\bcoming soon\b/gi, "\"coming soon\""],
];


/** Words of the hub's own build that a person never needs: how it is made, not what it does for them. */
export const HUB_TALK = [
  [/\b(?:JSON|API|endpoint|Cloudflare|wasm|WebAssembly|D1|KV|CORS|webhook|OAuth|JWT|HMAC|Ed25519|ML-DSA|SLH-DSA)\b/g, "a build word"],
  [/\b(?:safe|safely|safety|secure|secured|security)\b/gi, "a promise of safety (say checked, or verified identity)"],
  [/\bapproved (?:software|apps?|plugins?|extensions?)\b/gi, "\"approved software\" (the hub checks files and verifies identities)"],
  [/\bplaceholder\b|\bTODO\b|\blorem\b/gi, "placeholder text"],
];

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'" };
const decode = (t) => t.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => ENTITIES[e] ?? (e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : m));

/** The visible lines of one built page: text outside script, style, svg and code blocks (a <template> counts: scripts show it), plus alt text. */
export function visible(html) {
  let h = html.slice(Math.max(0, html.indexOf("<body")));
  h = h.replace(/<(script|style|svg|noscript|pre)\b[\s\S]*?<\/\1>/gi, " ");
  const alts = [...h.matchAll(/\balt="([^"]*)"/g)].map((m) => m[1]);
  return decode(h.replace(/<[^>]+>/g, "\n") + "\n" + alts.join("\n")).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** Problems in a list of visible lines: [line, token, why]. */
export function scan(lines, lists) {
  const out = [];
  for (const l of lines) for (const list of lists) for (const [re, why] of list) for (const m of l.matchAll(re)) out.push([l, m[0], why]);
  return out;
}

/** Every built page under `dist` as its route ("/", "/apps/org.wolos.notes"), plus 404. */
export function builtPages(dist) {
  const out = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f === "index.html") out.push("/" + relative(dist, d).replace(/\\/g, "/"));
      else if (f === "404.html" && d === dist) out.push("/404");
    }
  };
  walk(dist);
  return out.map((r) => (r === "/" ? r : r.replace(/\/$/, ""))).sort();
}
