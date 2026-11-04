# hub Worker

The small server behind hub.wolos.org: GitHub sign-in, the contributor agreement (CLA),
organisations, listings, release webhooks, reports, and the API the hub-index pipeline
calls. It runs on the Cloudflare Workers free plan with one D1 database and one KV
namespace. It never signs, downloads or hashes a release file: the pipeline does that.

```sh
bun install
bun test                 # in-memory D1 and a mocked GitHub, no network
bunx tsc -p .            # types
bunx wrangler deploy --dry-run --outdir dist   # bundle check only
```

## Secrets (set by the lead, never in the repository)

| Name | What it is |
|---|---|
| `GITHUB_APP_ID` | The numeric id of the "WolOS Hub" GitHub App (kept for the installation tokens of phase 2) |
| `GITHUB_CLIENT_ID` | The App's client id (starts with `Iv`) |
| `GITHUB_CLIENT_SECRET` | A client secret generated on the App's page |
| `WEBHOOK_SECRET` | The webhook secret typed into the App's page; at least 32 random characters |
| `SESSION_SECRET` | Signs the session cookies and seals the GitHub token inside them; at least 32 random bytes (48 bytes from any secure random source, base64) |

```sh
for s in GITHUB_APP_ID GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET WEBHOOK_SECRET SESSION_SECRET; do
  wrangler secret put "$s"
done
```

Without all five the Worker answers 503 to everything. Changing `SESSION_SECRET` signs
everyone out. No secret, token or cookie is ever logged (`src/log.ts`, tested).

## Registering the GitHub App "WolOS Hub"

In the `wonderlandos` organisation: Settings, Developer settings, GitHub Apps, New GitHub App.

| Field | Value |
|---|---|
| Name | WolOS Hub |
| Homepage URL | `https://hub.wolos.org` |
| Callback URL | `https://hub.wolos.org/auth/callback` (one only) |
| Expire user authorization tokens | on (the Worker refreshes them) |
| Request user authorization (OAuth) during installation | off |
| Enable Device Flow | off |
| Setup URL | empty |
| Webhook | active, URL `https://hub.wolos.org/api/webhook/github`, secret = `WEBHOOK_SECRET` |
| Where can this app be installed | Any account |

Permissions, all read-only, nothing else:

| Group | Permission | Access | Why |
|---|---|---|---|
| Repository | Metadata | Read-only | Required by GitHub; repository owner and id checks |
| Repository | Contents | Read-only | Needed to receive `release` events; the Worker reads no file |
| Organization | Members | Read-only | An organisation's owners and members, for linking and publishing under it |
| Account | (none) | | The public profile comes with every user token |

Events to subscribe to: **Release**, **Repository** (renames and transfers; a transferred
repository withdraws its listings).

A person installs the App on the repositories they publish from (that sends the release
events). An organisation's owner installs it on the organisation, which also lets the hub
see its members.

## Bindings and variables (`wrangler.toml`)

- `DB`: D1 database `wolos-hub` (`wrangler d1 create wolos-hub`, put its id in `wrangler.toml`,
  then `wrangler d1 migrations apply wolos-hub --remote`).
- `KV`: namespace `hub-cache` (`wrangler kv namespace create hub-cache`): only GitHub's
  token signing keys, about 24 writes a day.
- `OIDC_AUDIENCE`, `PIPELINE_*`: the pipeline identity below.
- `RATE_STORE`: `d1` (default) or `kv`. `CLA_VERSION`: which text in `src/cla.ts` is current.
- `GITHUB_WEB`, `GITHUB_API`, `OIDC_ISSUER`: unset in production; tests point them at mocks.

## HTTP API (I4)

JSON in and out; every error is `{error, sentence}`, where `sentence` is meant for people.
State-changing requests with the session cookie must carry `Origin: https://hub.wolos.org`.
Request bodies: 16 KiB for the API, 512 KiB for webhooks, 256 KiB for verdicts.

| Route | Who | What |
|---|---|---|
| `GET /auth/login?next=/path` | anyone | Redirect to GitHub (state + PKCE S256); `next` must be a path on the hub |
| `GET /auth/callback` | GitHub | Sets `__Host-hub_session` (HttpOnly, Secure, SameSite=Lax, 7 days); errors go to `/signin?error=state\|denied\|banned` |
| `POST /auth/logout` | person | Clears the cookie and voids all older sessions of that person |
| `GET /api/me` | person | `{github_id, login, name, avatar, role, cla, orgs[]}` |
| `GET /api/cla` | anyone | `{version, text, sha256}` |
| `POST /api/cla` | person | `{version, sha256}`: accept the current CLA |
| `GET /api/orgs` | person | `{orgs: [{github_org_id, login, role, linked, cla}]}` from GitHub, cached 10 min |
| `POST /api/orgs` | GitHub owner | `{org, version, sha256}`: link the organisation and accept the CLA for it |
| `POST /api/listings` | person with CLA | `{id, kind, host?, repo, asset, name, summary, license, owner?}` |
| `GET /api/listings/:id` | anyone | The listing, owner, source and its releases |
| `POST /api/webhook/github` | GitHub | `release` published/deleted, `repository` renamed/transferred; signature checked; idempotent |
| `POST /api/reports` | person, account 7+ days | `{listing_id, version?, reason, text}`, 5 a day |
| `GET /api/reports/:id` | reporter or moderator | The report and its moderation state |
| `GET /api/index/preview` | anyone | What the sign job will publish next (unsigned) |
| `GET /api/pipeline/pending` | check job | Releases waiting for a verdict |
| `POST /api/pipeline/verdicts` | check job | `{verdicts: [{listing_id, version, verdict, sha256, size?, commit?, findings[]}]}` |
| `GET /api/pipeline/export` | sign job | The same entries as the preview, for signing |

Listing rules: `id` starts with the owner's GitHub login in lower case and a dot
(`alice.notes`); `org.wolos.` is reserved; the repository must be public and owned (by
numeric id) by the person or the linked organisation; `asset` is the release file name with
at most one `*`, ending in `.wol` for apps and `.wolplug` for plugins; extensions name the
app they extend in `host`. Status moves `draft` (registered), `checking` (a release is
waiting), `listed` (a release passed or was flagged), `withdrawn` (repository transferred).
A file that changes behind an already checked release is blocked; the first sha256 stays.

## Pipeline identity (I9)

The hub-index workflows ask GitHub for an OIDC token with audience `hub.wolos.org`
(`core.getIDToken('hub.wolos.org')`, `permissions: id-token: write`) and send it as
`Authorization: Bearer`. The Worker checks the RS256 signature against GitHub's published
keys, then: `iss` = `https://token.actions.githubusercontent.com`, `aud` contains
`hub.wolos.org`, `repository` = `wonderlandos/hub-index`, `workflow_ref` =
`wonderlandos/hub-index/.github/workflows/check.yml@refs/heads/main` (or `sign.yml` for the
export), `ref` = `refs/heads/main`, `environment` = `check` (or `sign`), `event_name` not a
pull request, `runner_environment` = `github-hosted`, `exp` not past, `iat` within the last
15 minutes. `job_workflow_sha` and `run_id` are stored with each verdict. There is no
shared secret.

## Data (I5)

`schema.sql` is the whole schema; `migrations/` holds the same, step by step, and only ever
adds (a test applies them and compares). Tables: `persons`, `orgs`, `memberships` (a cache
of GitHub roles), `cla_acceptances`, `listings`, `releases`, `verdicts`, `reports`,
`audit_log`, `deliveries` (webhook ids, 30 days), `rate_counters` (2 days). No IP address
is stored anywhere; sessions are cookies, not rows.

## Limits and the free plan

Rate limits are fixed windows counted in D1 (free KV allows only about 1,000 writes a day):
sign-in 10 a minute per address; any write 60 a minute per address and 30 per person;
reports 5 a day; releases 20 a day per owner; listings 50 per person; the pipeline 120
calls a minute per run. A daily cron removes old counters and webhook ids.

Measured rows written to D1 (in-memory D1, `total_changes()`): a sign-in 6 (with two
organisations), `/api/me` 0, a CLA acceptance 3, a listing 4, a release webhook 5, an
ignored webhook 1. So 10,000 sign-ins a day use about 60,000 of the 100,000 free daily
writes; that is the first limit to watch (free-plan numbers from ADR 0047, unverified).

## Timings (this box, 2026-11-04)

`wrangler dev --local` (workerd, local D1), 200 requests each, measured from the client,
so every figure includes the dev proxy (a route that touches nothing: p50 6.6 ms):

| Route | p50 | p95 |
|---|---|---|
| `GET /api/cla` | 9.5 ms | 15.6 ms |
| `GET /api/me` (signed out) | 6.7 ms | 13.0 ms |
| `GET /api/listings/:id` | 13.4 ms | 20.9 ms |
| `GET /api/index/preview` | 18.9 ms | 29.9 ms |
| `GET /auth/login` (D1 counter) | 13.2 ms | 20.9 ms |
| `POST /api/webhook/github` | 32.8 ms | 44.0 ms |

First request after the server was ready: 568 ms by the dev server's log (isolate start,
bundle, D1 open). The handlers themselves, in process on the in-memory D1, take 0.01 to
0.06 ms. The bundle is 55 KiB (16 KiB gzipped). `bun bench/bench.ts` and
`bun bench/e2e-local.ts` repeat these against a running `wrangler dev` (put the test values of
`test/harness.ts` `SECRETS` in a local, ignored `.dev.vars`; start it with `--var GITHUB_WEB:http://127.0.0.1:8798/web --var GITHUB_API:http://127.0.0.1:8798/api --var OIDC_ISSUER:http://127.0.0.1:8798/oidc`).

## License

GPL-2.0-or-later. See `../LICENSE`.
