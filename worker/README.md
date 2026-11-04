# hub Worker

The small server behind hub.wolos.org: GitHub sign-in, the contributor agreement (CLA) and the
other two texts, organisations, listings, release webhooks, reports, certificate requests, the
admin panel, and the API the hub-index pipeline calls. It runs on the Cloudflare Workers free plan with one D1 database and one KV
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
| `GITHUB_APP_ID` | The numeric id of the "WolOS Hub" GitHub App (the `iss` of the App JWT for installation tokens) |
| `GITHUB_CLIENT_ID` | The App's client id (starts with `Iv`) |
| `GITHUB_CLIENT_SECRET` | A client secret generated on the App's page |
| `WEBHOOK_SECRET` | The webhook secret typed into the App's page; at least 32 random characters |
| `SESSION_SECRET` | Signs the session cookies and seals the GitHub token inside them; at least 32 random bytes (48 bytes from any secure random source, base64) |
| `GITHUB_APP_PRIVATE_KEY` | Optional. The App's private key, the `.pem` file GitHub gives (PKCS#1 or PKCS#8, whole file). Starts the ca workflow after an approval; without it approvals are stored and the panel says the workflow was not started |

```sh
for s in GITHUB_APP_ID GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET WEBHOOK_SECRET SESSION_SECRET GITHUB_APP_PRIVATE_KEY; do
  wrangler secret put "$s"
done
```

Without the first five the Worker answers 503 to everything. Changing `SESSION_SECRET` signs
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

For the certificate dispatch the Worker also needs, on `wonderlandos/hub-index` only:

| Group | Permission | Access | Why |
|---|---|---|---|
| Repository | Actions | Read and write | `POST /repos/wonderlandos/hub-index/actions/workflows/ca.yml/dispatches` after an approval |

The Worker asks for an installation token narrowed to `hub-index` and `actions: write` (`src/ghapp.ts`), uses it
once and keeps it nowhere. GitHub sets App permissions for every installation, so with this one App a person who
installs it on their own repositories is asked for Actions too (the Worker never uses it there). A second, private
App installed only on `hub-index` would avoid that; that choice is open (the lead's).

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
- `PIPELINE_CA_WORKFLOW`, `PIPELINE_CA_ENVIRONMENT`: the ca job (`ca.yml` on `main`, environment `ca`); the workflow
  file name is also the one the Worker dispatches.
- `ADMINS`: the hub admins, GitHub logins separated by commas (case does not matter). Keep it equal to hub-index's
  variable `CA_APPROVERS`: the ca job refuses an approval by anyone else.
- `CA_DISPATCH_DRY_RUN`: `true` starts ca.yml as a dry run (TEST CA, nothing issued); `false` (default) issues.
- `RATE_STORE`: `d1` (default) or `kv`. `CLA_VERSION`: the version line of `cla/CLA.md` (a test checks they agree).
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
| `GET /api/me` | person | `{github_id, login, name, avatar, role, admin, cla, terms: {publisher, trust}, orgs[]}` |
| `GET /api/cla` | anyone | `{version, text, sha256}` |
| `GET /api/terms/cla\|publisher\|trust` | anyone | `{doc, version, text, sha256}` |
| `POST /api/terms/cla\|publisher\|trust` | person | `{version, sha256}`: accept the current text |
| `POST /api/cla` | person | `{version, sha256}`: accept the current CLA |
| `GET /api/orgs` | person | `{orgs: [{github_org_id, login, role, linked, cla}]}` from GitHub, cached 10 min |
| `POST /api/orgs` | GitHub owner | `{org, version, sha256}`: link the organisation and accept the CLA for it |
| `POST /api/listings` | person with CLA and Publisher Agreement | `{id, kind, host?, repo, asset, name, summary, license, owner?}` |
| `GET /api/listings/:id` | anyone | The listing, owner, source and its releases |
| `POST /api/webhook/github` | GitHub | `release` published/deleted, `repository` renamed/transferred; signature checked; idempotent |
| `POST /api/reports` | person, account 7+ days | `{listing_id, version?, reason, text}`, 5 a day |
| `GET /api/reports/:id` | reporter or moderator | The report and its moderation state |
| `GET /api/index/preview` | anyone | What the sign job will publish next (unsigned) |
| `GET /api/pipeline/pending` | check job | Releases waiting for a verdict |
| `POST /api/pipeline/verdicts` | check job | `{verdicts: [{listing_id, version, verdict, sha256, size?, commit?, findings[]}]}` |
| `GET /api/pipeline/export` | sign job | The same entries as the preview, for signing |
| `POST /api/cert/request` | person with CLA | The woltrust request (`wol cert request`) plus `trust_terms: {version, sha256}`; 3 a day |
| `GET /api/cert/requests` | person | `{requests: [...]}`: their own requests, with the certificate once issued |
| `GET /api/certs/:login` | anyone | `{login, certs: [{serial, kind, login, not_before, not_after, issued_at, cert}]}` for the person's or organisation's page |
| `GET /api/pipeline/requests/:id` | ca job | The request file (hub-index `schema/request.schema.json`) of an approved request without a certificate |
| `POST /api/pipeline/certs` | ca job | `{request_id, serial, cert}`: the issued `.wolcert`; stored, shown, request marked issued |
| `GET /api/admin/queue` | admin | `{requests: [pending, approved], reports: [open]}` |
| `POST /api/admin/requests/:id/approve` | admin, not the subject | Approve and start ca.yml; 200 started, 202 approved but not started (approve again to retry) |
| `POST /api/admin/requests/:id/refuse` | admin | `{reason}` |
| `POST /api/admin/reports/:id/resolve` | admin | `{note?}`: close without action |
| `POST /api/admin/reports/:id/takedown` | admin | `{note?}`: withdraw the listing; the export names it in `withdrawn` |

Listing rules: `id` starts with the owner's GitHub login in lower case and a dot
(`alice.notes`); `org.wolos.` is reserved; the repository must be public and owned (by
numeric id) by the person or the linked organisation; `asset` is the release file name with
at most one `*`, ending in `.wol` for apps and `.wolplug` for plugins; extensions name the
app they extend in `host`. Status moves `draft` (registered), `checking` (a release is
waiting), `listed` (a release passed or was flagged), `withdrawn` (repository transferred).
A file that changes behind an already checked release is blocked; the first sha256 stays.

Verdicts may also carry what hubcheck found in the file: `kinds` and `permissions` (lists of at most 16 words),
`min_wolos` (`0.13`, `0.13.1` or empty), `trust` (hubcheck's: `wolos`, `trusted`, `origin`, `community`, `withdrawn`,
`invalid`; an older hubcheck's `verified` counts as `origin`) and `cert` (16 hex). The export then gives plugins their
`kinds` and `permissions` (0.12 drops a plugin without `kinds`; apps and extensions never carry them), every entry its
`min_wolos`, its trust as the index has it (`wolos`, `trusted`, `origin` or `community`; `withdrawn` and `invalid` show
as `community`) and `cert` unless that is `community`. `GET /api/listings/:id` shows the same trust and cert. Absent facts change nothing. The export (and the
preview) also lists `withdrawn: [{id, kind, at, reason}]`, `reason` `takedown` or `transferred`, for every withdrawn
listing that had been listed, so the sign job can mark it.

## Certificates (ADR 0046) and the admin panel

1. A signed-in person with the CLA sends `POST /api/cert/request` with the JSON `wol cert request` wrote and the
   Trust Terms they accepted. The Worker checks the shape only (fields, key and proof sizes, no unknown field, no
   `id`, `verified_at` or approval from the client; woltrust checks the proof in the ca job), checks the account with
   GitHub at that moment (that time is `verified_at`), refuses a request made for another GitHub id, takes the login
   from GitHub, takes `subject.org` (optional, person only) from the person's live GitHub membership, and allows only
   namespaces under the subject's own `<login>.`, never `org.wolos.`. An organisation's request comes from an owner,
   for a linked organisation with its CLA. One open request per subject.
2. An admin (`ADMINS`) approves it in the panel. The approver cannot be the subject, the person who asked, or (for an
   organisation) a member of it. The Worker then starts `ca.yml` on `main` with `{request_id, dry_run}` using the App
   installation token. If that fails, the approval stays and the panel shows `dispatch_error`; approving again retries.
3. The ca job reads `GET /api/pipeline/requests/<id>` (OIDC, `ca.yml`, environment `ca`): the request with `id`,
   `tier: "trusted"`, `verified_at`, `approved_by: [<admin login>]` and `approved_at`. After issuing it posts
   `POST /api/pipeline/certs`; the Worker checks the certificate's body names the same serial, kind, subject, signing
   key and namespaces, stores it, marks the request issued and shows it on `GET /api/certs/<login>`.

Every step is in `audit_log` (`cert.request`, `cert.approve`, `cert.dispatch`, `cert.dispatch-failed`, `cert.refuse`,
`cert.issued`, `report.resolve`, `listing.takedown`, `publisher.accept`, `trust.accept`).

## The three texts (`cla/`)

`cla/CLA.md` (the contributor agreement, accepted after the first sign-in), `cla/PUBLISHER-AGREEMENT.md` (before the
first publish) and `cla/TRUST-TERMS.md` (with every certificate request). Each is a draft for a lawyer, starts with
`Version N, date.`, is bundled as text (`wrangler.toml` rules) and served byte for byte with the SHA-256 of those bytes;
an acceptance stores version and hash. A new version: edit the file and its version line (and `CLA_VERSION` for the
CLA); everyone accepts it again before the next publish or request. Wording on the hub and in the Store: "checked" and
"verified identity", never "safe", "secure" or "approved software" (a test checks the three texts).

## Pipeline identity (I9)

The hub-index workflows ask GitHub for an OIDC token with audience `hub.wolos.org`
(`core.getIDToken('hub.wolos.org')`, `permissions: id-token: write`) and send it as
`Authorization: Bearer`. The Worker checks the RS256 signature against GitHub's published
keys, then: `iss` = `https://token.actions.githubusercontent.com`, `aud` contains
`hub.wolos.org`, `repository` = `wonderlandos/hub-index`, `workflow_ref` =
`wonderlandos/hub-index/.github/workflows/check.yml@refs/heads/main` (or `sign.yml` for the
export, `ca.yml` for certificate requests and certificates), `ref` = `refs/heads/main`, `environment` = `check`
(or `sign`, `ca`), `event_name` not a
pull request, `runner_environment` = `github-hosted`, `exp` not past, `iat` within the last
15 minutes. `job_workflow_sha` and `run_id` are stored with each verdict. There is no
shared secret.

## Data (I5)

`schema.sql` is the whole schema; `migrations/` holds the same, step by step, and only ever
adds (a test applies them and compares). Tables: `persons`, `orgs`, `memberships` (a cache
of GitHub roles), `cla_acceptances`, `listings`, `releases`, `verdicts`, `reports`,
`audit_log`, `deliveries` (webhook ids, 30 days), `rate_counters` (2 days); from migration 0002
`release_facts` (what the check found in a file), `takedowns`, `cert_requests`, `certs`,
`terms_acceptances` (Publisher Agreement and Trust Terms). No IP address
is stored anywhere; sessions are cookies, not rows.

## Limits and the free plan

Rate limits are fixed windows counted in D1 (free KV allows only about 1,000 writes a day):
sign-in 10 a minute per address; any write 60 a minute per address and 30 per person;
reports 5 a day; certificate requests 3 a day per person; releases 20 a day per owner; listings 50 per person; the pipeline 120
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
0.06 ms. The bundle was 55 KiB (16 KiB gzipped) then; with certificates, the admin panel and the three
texts it is 97 KiB (28 KiB gzipped), `wrangler deploy --dry-run`, 2026-11-04 (timings not measured again). `bun bench/bench.ts` and
`bun bench/e2e-local.ts` repeat these against a running `wrangler dev` (put the test values of
`test/harness.ts` `SECRETS` in a local, ignored `.dev.vars`; start it with `--var GITHUB_WEB:http://127.0.0.1:8798/web --var GITHUB_API:http://127.0.0.1:8798/api --var OIDC_ISSUER:http://127.0.0.1:8798/oidc`).

## License

GPL-2.0-or-later. See `../LICENSE`.
