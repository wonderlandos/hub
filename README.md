# WolOS Hub

The place where apps, plugins and extensions for WolOS are published: hub.wolos.org.

## What is here (public)

```
site/     the static site of hub.wolos.org (npm run site; npm run build:site)
          `npm run build:site` is the production build: an empty catalogue until HUB_INDEX names the published index.
          The invented review catalogue (site/data/index.json) is built only with `HUB_FIXTURE=1` / `--fixture` (`npm run build:review` in site/): every page says it is example data and is noindex; never deploy it to hub.wolos.org.
wasm/     hubcheck: the checker the pipeline runs on every release, and its wasm build for the site
legal/    the hub's legal texts (rendered at /terms/<doc>)
```

## Deploy

`.github/workflows/deploy.yml` runs on every push to `main` and on manual dispatch: `npm run site` (the checks; no `npm ci`, the site has no dependencies and no lockfile),
then the production build `npm run build:site` (never the fixture build), then `bunx wrangler pages deploy site/dist --project-name wolos-hub --branch main`.
Permissions are `contents: read`; one `deploy` concurrency group. It needs two repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
The workflow does not set `HUB_INDEX`, so the catalogue is empty until it is wired in.

## What is elsewhere

Lead decision 2026-11-04: the parts only the hub runs are private, to cut the attack surface.

| repository | visibility | holds |
|---|---|---|
| `wonderlandos/hub-worker` | private | the Cloudflare Worker (API, sign-in, admin panel, pipeline endpoints); moved out of `worker/` here, with history |
| `wonderlandos/hub-pipeline` | private | the check, sign and CA workflows and their scripts (was `wonderlandos/hub-index`) |
| `wonderlandos/hub-log` | public | the published, signed output: the index, verdicts, certificates, revocations, and the index schemas; how to verify with woltrust |
| `wonderlandos/wolos` | public | woltrust, the trust library and command every check uses |

The Worker serves four of the texts in `legal/` (CLA, Publisher Agreement, Trust Terms, Certificate Terms) from its own
copy: after changing one here, run `scripts/sync-legal.sh <this checkout> <commit>` in hub-worker and deploy it.

Licence GPL-2.0-or-later.
