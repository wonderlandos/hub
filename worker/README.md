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
| `GITHUB_PIPELINE_APP_ID` | Optional. The numeric id of the second, private App "WolOS Hub Pipeline" (below) |
| `GITHUB_PIPELINE_APP_PRIVATE_KEY` | Optional. That App's private key, the `.pem` file GitHub gives (PKCS#1 or PKCS#8, whole file). Starts the ca workflow after an approval or a revocation; without the two, approvals and revocations are stored and the panel says the workflow was not started |

```sh
for s in GITHUB_APP_ID GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET WEBHOOK_SECRET SESSION_SECRET GITHUB_PIPELINE_APP_ID GITHUB_PIPELINE_APP_PRIVATE_KEY; do
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

"WolOS Hub" has no Actions permission: GitHub sets App permissions for every installation, so authors who install it
would be asked for Actions too. The certificate dispatch goes through a second App.

## Registering the second GitHub App "WolOS Hub Pipeline" (what the lead registers)

In the `wonderlandos` organisation: Settings, Developer settings, GitHub Apps, New GitHub App.

| Field | Value |
|---|---|
| Name | WolOS Hub Pipeline |
| Homepage URL | `https://hub.wolos.org` |
| Callback URL | empty; "Request user authorization (OAuth)", "Device Flow" off |
| Webhook | inactive (untick "Active") |
| Where can this app be installed | Only on this account |
| Permissions | Repository, Actions: Read and write; Repository, Metadata: Read-only (required by GitHub); nothing else |
| Events | none |

Then: generate a private key (the `.pem`), note the App ID, and install the App on `wonderlandos` with
**Only select repositories: `hub-index`**. Set `GITHUB_PIPELINE_APP_ID` and `GITHUB_PIPELINE_APP_PRIVATE_KEY` with
`wrangler secret put`. The Worker asks for an installation token narrowed to `hub-index` and `actions: write`
(`src/ghapp.ts`), uses it once for `POST /repos/wonderlandos/hub-index/actions/workflows/ca.yml/dispatches` and keeps
it nowhere. The `ca` environment's OIDC check is unchanged (the Worker never pushes; ca.yml runs from `main`).

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
- `ADMINS`: the owners of the admin panel, GitHub logins separated by commas (case does not matter); seeded into
  `admin_roles` at their sign-in and counted only while they are in the variable. hub-index's variable `CA_APPROVERS`
  must list everyone who may approve a trusted request (these, and the admins and reviewers granted in the panel): the
  ca job refuses an approval by anyone else.
- `CA_DISPATCH_DRY_RUN`: `true` starts ca.yml as a dry run (TEST CA, nothing issued); `false` (default) issues.
- `RATE_STORE`: `d1` (default) or `kv`. `CLA_VERSION`: the version line of `../legal/CLA.md` (a test checks they agree).
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
| `GET /api/me` | person | `{github_id, login, name, avatar, role, admin, admin_role?, cla, terms: {publisher, trust}, certs: {origin, trusted}, two_factor, orgs[]}`; `certs` per tier `none\|pending\|issued\|revoked`; `admin_role` only for a role holder with two-factor |
| `GET /api/cla` | anyone | `{version, text, sha256}` |
| `GET /api/terms/cla\|publisher\|trust\|certificates` | anyone | `{doc, version, text, sha256}` |
| `POST /api/terms/cla\|publisher\|trust` | person | `{version, sha256}`: accept the current text (the Certificate Terms only come with a certificate request) |
| `POST /api/cla` | person | `{version, sha256}`: accept the current CLA |
| `GET /api/my/listings` | person | `{listings: [...]}`: the person's and their organisations' listings, every version with `status` (`checking`, `listed`, `flagged`, `block`, `not-checked`, `yanked`, `withdrawn`) and `findings: [{rule, sentence}]` of its last check |
| `GET /api/orgs/:login/members` | member of that organisation | `{org, members: [{login, role, synced_at}]}` as the Worker knows them (synced at sign-in); 404 for anyone else |
| `GET /api/orgs` | person | `{orgs: [{github_org_id, login, role, linked, cla}]}` from GitHub, cached 10 min |
| `POST /api/orgs` | GitHub owner | `{org, version, sha256}`: link the organisation and accept the CLA for it |
| `POST /api/listings` | person with CLA and Publisher Agreement | `{id, kind, host?, repo, asset, name, summary, license, owner?}` |
| `GET /api/listings/:id` | anyone | The listing (name and summary as shown, `registered`, `override`, `description`, `icon`, `screenshots`), owner, source and its releases (each with `flag` and `file_certificate`) |
| `PATCH /api/listings/:id` | the owner (or a member of the owning organisation) | `{name?, summary?}`: the author's own; `null` goes back to the package's. Icon, screenshots and description always come from the package |
| `POST /api/webhook/github` | GitHub | `release` published/deleted, `repository` renamed/transferred; signature checked; idempotent |
| `POST /api/reports` | person, account 7+ days | `{listing_id, version?, reason, text}`, 5 a day |
| `GET /api/reports/:id` | reporter or moderator | The report and its moderation state |
| `GET /api/index/preview` | anyone | What the sign job will publish next (unsigned) |
| `GET /api/pipeline/pending` | check job | Releases waiting for a verdict |
| `POST /api/pipeline/verdicts` | check job | `{verdicts: [{listing_id, version, verdict, sha256, size?, commit?, findings[]}]}` |
| `GET /api/pipeline/export` | sign job | The same entries as the preview, for signing |
| `POST /api/cert/request` | person with CLA | The woltrust request (`wol cert request`) plus `trust_terms` and `certificate_terms` (each `{version, sha256}`, stored with the request) and `tier: origin\|trusted` (absent: origin); 3 a day; 201 `{request, auto, dispatched?, sentence}` |
| `GET /api/cert/requests` | person | `{requests: [...]}`: their own requests (`tier`, `status`, `auto`, `origin_cert`), with the certificate once issued |
| `GET /api/certs/:login` | anyone | `{login, certs: [{serial, kind, tier, login, not_before, not_after, issued_at, revoked_at, revoke_reason, origin_cert, cert}]}` for the person's or organisation's page |
| `GET /api/pipeline/requests/:id` | ca job | The request file (hub-index `schema/request.schema.json`): `r-…` an approved issue request without a certificate, `v-…` an approved revocation not done yet (action `revoke`) |
| `POST /api/pipeline/certs` | ca job | `{request_id, serial, tier?, cert}`: the issued `.wolcert`; stored, shown, request marked issued |
| `POST /api/pipeline/revocations` | ca job | `{request_id, serial}`: the revocation is on `revocations.json`; the certificate is marked revoked (an origin one for cause: the trusted ones on it too) |
| `POST /api/pipeline/file-certificates` | sign job | `{file_certificates: [{listing_id, version, serial, url, checked_at, verdict}]}`: each release's signed statement, shown as `file_certificate` |
| `GET /api/admin/queue` | any role | `{role, can, requests?, reports?, revocations?, withdrawals?}`: `can` lists the actions the role may take, the rest what it may handle |
| `POST /api/admin/requests/:id/approve` | owner, admin, reviewer; not the subject | `{note?}`. Approve and start ca.yml; 200 started, 202 approved but not started (approve again to retry) |
| `POST /api/admin/requests/:id/refuse` | owner, admin, reviewer | `{reason}`; not once ca.yml was started |
| `POST /api/admin/certs/:serial/revoke` | owner, admin; not the subject | `{reason: key-compromise\|abuse, note?}`: revokes every live certificate of that subject; key-compromise starts at once, abuse waits for a second admin |
| `POST /api/admin/certs/:serial/downgrade` | owner, admin; not the subject | `{note}`: a trusted certificate revoked as `superseded`; origin stays |
| `POST /api/admin/revocations/:group/approve` | owner, admin, a second person | `{note?}`: the second approval for abuse, or a retry of a failed dispatch |
| `POST /api/admin/reports/:id/resolve` | owner, admin, support | `{note?}`: close without action |
| `POST /api/admin/reports/:id/takedown` | owner, admin | `{note?}`: withdraw the listing; the export names it in `withdrawn` |
| `POST /api/admin/releases/:id/:version/flag` | owner, admin, reviewer | `{reason}`: the release shows verdict `flag`, the reason first among its findings |
| `POST /api/admin/releases/:id/:version/withdraw` | owner, admin | `{reason}`: the version's file certificate goes on the revocation list with reason `withdrawn-version` (ca.yml fetches `v-…` as a revoke file, then `POST /api/pipeline/revocations`); export and listing mark the version `withdrawn: true`; 409 without a file certificate |
| `GET /api/admin/audit?before=&limit=` | owner, admin | `{entries: [{id, at, actor_kind, actor_id, actor_login, action, target, detail}], next}`, newest first, at most 100 a page |
| `GET /api/admin/roles` | owner | `{roles: [{github_id, login, role, granted_by, granted_at, seeded, two_factor}]}` |
| `POST /api/admin/roles` | owner | `{login, role: owner\|admin\|reviewer\|support\|none, reason}`; never yourself or an `ADMINS` owner; the person signed in with two-factor |

Listing rules: `id` starts with the owner's GitHub login in lower case and a dot
(`alice.notes`); `org.wolos.` is reserved; the repository must be public and owned (by
numeric id) by the person or the linked organisation; `id` follows hub-index `index.schema.json` (at most 64
characters, no `-` at the start or end of a part), `name` at most 40 characters; `asset` is the release file name with
at most one `*`, ending in `.wol` for apps, `.wolplug` for plugins and `.wolext` for extensions; extensions name the
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

## Certificates (ADR 0046): two tiers

Lead decision 2026-11-04: an **origin** certificate (who made a file and from which repository) is issued by policy,
without a person; a **trusted** one (a vetted developer or organisation) needs a person's approval in the panel and
builds on the subject's live origin certificate.

1. A signed-in person with the CLA sends `POST /api/cert/request` with the JSON `wol cert request` wrote, the Trust
   Terms they accepted and the tier. The Worker checks the shape only (fields, key and proof sizes, no unknown field, no
   `id`, `verified_at` or approval from the client; woltrust checks the proof in the ca job), checks the account with
   GitHub at that moment (that time is `verified_at`), refuses a request made for another GitHub id, takes the login
   from GitHub, takes `subject.org` (optional, person only) from the person's live GitHub membership, and allows only
   namespaces under the subject's own `<login>.`, never `org.wolos.`. An organisation's request comes from an owner,
   for a linked organisation with its CLA. One open request per subject; one live certificate per subject and tier.
2. **origin**, the gates (`src/certs.ts` `originGates`, each value stored with the request and in `audit_log`): the CLA,
   the Publisher Agreement and the Trust Terms accepted; the GitHub account older than 30 days; two-factor
   authentication on (GitHub's `two_factor_authentication` for the user's token; absent counts as off); no open request;
   at most one origin request per subject per 7 days. A missing gate refuses the request (403 `publisher-terms-needed`,
   `two-factor-needed`, `account-too-new`, 429 `origin-weekly`; nothing stored, `cert.origin-refused` in `audit_log`).
   When every gate holds the request is approved with `approved_by = "policy"` (`cert.approve` by `system:policy`) and
   ca.yml starts at once, unless the subject had a refused request or a certificate revoked for key-compromise or abuse:
   then it waits in the panel (`cert.review`) for a person. The request file carries `cla_accepted_at` and no approval.
3. **trusted**: the subject must hold a live origin certificate (`409 origin-first`); the request records it as
   `origin_cert`. An owner, admin or reviewer approves it in the panel, never the subject, the person who asked, or
   (for an organisation) a member of it. The file carries `approved_by`, `approved_at` and `origin_cert`.
4. The Worker starts `ca.yml` on `main` with `{request_id, dry_run}` using the pipeline App's installation token. If that
   fails, the approval stays and the panel shows `dispatch_error`; approving again retries.
5. The ca job reads `GET /api/pipeline/requests/<id>` (OIDC, `ca.yml`, environment `ca`). After issuing it posts
   `POST /api/pipeline/certs`; the Worker checks the certificate's body names the same serial, kind, subject, signing
   key and namespaces (and, when present, `class` = the tier and `origin_cert`), stores it with its tier, marks the
   request issued and shows it on `GET /api/certs/<login>`.

Revocations: `revoke` (reason `key-compromise` or `abuse`) kills everything: every live certificate of the subject gets
a revocation (one group) and its pending requests are refused; `key-compromise` starts ca.yml at once, `abuse` needs a
second admin (hub-index requires two approvers). `downgrade` revokes a trusted certificate as `superseded`; the origin
one stays and the index shows what the trusted one signed as origin. The ca job fetches `v-<id>` as a revoke request
file and reports `POST /api/pipeline/revocations`; then the certificate is marked revoked, and an origin certificate
revoked for cause marks the trusted ones built on it revoked too.

Every step is in `audit_log` (`cert.request`, `cert.approve`, `cert.review`, `cert.origin-refused`, `cert.dispatch`,
`cert.dispatch-failed`, `cert.refuse`, `cert.issued`, `cert.revoke`, `cert.revoke-approve`, `cert.downgrade`,
`cert.revoked`, `report.resolve`, `listing.takedown`, `release.flag`, `role.set`, `listing.override`,
`publisher.accept`, `trust.accept`).

## The admin panel (closed, `src/roles.ts`)

Roles in `admin_roles`: `owner` (everything, including roles), `admin` (approve, refuse, revoke, downgrade, take down,
resolve reports, withdraw versions, read the audit log),
`reviewer` (approve and refuse requests, flag releases), `support` (resolve reports). The logins in `ADMINS` are owners.
Every route under `/api/admin` needs a role and two-factor authentication on GitHub (checked at sign-in and asked of
GitHub again when the last answer is older than an hour); anyone else gets the router's own 404 (never 401, 403, 405 or
429, and the address limit is counted only after the role check), and every response there carries
`X-Robots-Tag: noindex, nofollow, noarchive`. The public API links nowhere into the panel. Each action is in
`audit_log` with actor, role, target, reason and the address class (`ip_class` v4 or v6, and the country when
Cloudflare gives it; never the address). Writes per hour: owner and admin 120, reviewer and support 60, on top of the
general limits.

## Listing metadata from the package

The check posts hubcheck's `facts` with a verdict: `name` (80), `summary` (200), `description` (4000), `icon` and up to 8
`screenshots` as `{path, mime: image/png|image/webp, w, h, size, sha256}` (the pipeline puts the bytes on the CDN as
`<sha256>.<png|webp>`; no image goes through the Worker). They are kept per release (`release_meta`); the export and
`GET /api/listings/:id` carry `description`, `icon` and `screenshots` as `{sha256, mime, w, h, size, file}`. Name and
summary: the author's override (`PATCH`), else the package's, else the registered ones; a name over 40 characters (the
index's limit) is passed over, never cut. A verdict without facts keeps the last ones.

## The accepted texts (`../legal/`)

The Worker serves four of the hub's texts from the repository's `legal/` folder, byte for byte with the SHA-256 of those
bytes (the same hashes as `legal/README.md`; a test compares): `CLA.md` (accepted after the first sign-in),
`PUBLISHER-AGREEMENT.md` (before the first publish), `TRUST-TERMS.md` and `CERTIFICATE-TERMS.md` (both with every
certificate request). A text's version is its `Version N, effective DATE.` line; an acceptance stores version and hash.
A new version: edit the file, its version lines and the hash in `legal/README.md` (and `CLA_VERSION` for the CLA);
everyone accepts it again before the next publish or request. The other texts are the site's. Wording on the hub and in
the Store: "checked" and "verified identity", never "safe", "secure" or "approved software" (a test checks).

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
`terms_acceptances` (Publisher Agreement and Trust Terms); from migration 0004 `version_withdrawals` and
`cert_requests.terms`; from migration 0003 `admin_roles`, `revocations`,
`release_flags`, `release_meta`, `listing_overrides`, `file_certificates`, and the columns `cert_requests.tier`,
`gates`, `origin_cert`, `certs.tier`, `revoked_at`, `revoke_reason`, `origin_cert`, `persons.two_factor_checked_at`. No IP address
is stored anywhere; sessions are cookies, not rows.

## Limits and the free plan

Rate limits are fixed windows counted in D1 (free KV allows only about 1,000 writes a day):
sign-in 10 a minute per address; any write 60 a minute per address and 30 per person;
reports 5 a day; certificate requests 3 a day per person, origin requests 1 per subject per 7 days; panel writes per role an hour; releases 20 a day per owner; listings 50 per person; the pipeline 120
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
texts it is 97 KiB (28 KiB gzipped); with tiers, roles, revocations and listing metadata 136 KiB (37 KiB gzipped); with the legal texts, the dashboard
and the audit log 174 KiB (47 KiB gzipped),
`wrangler deploy --dry-run`, 2026-11-04 (timings not measured again). `bun bench/bench.ts` and
`bun bench/e2e-local.ts` repeat these against a running `wrangler dev` (put the test values of
`test/harness.ts` `SECRETS` in a local, ignored `.dev.vars`; start it with `--var GITHUB_WEB:http://127.0.0.1:8798/web --var GITHUB_API:http://127.0.0.1:8798/api --var OIDC_ISSUER:http://127.0.0.1:8798/oidc`).

## License

GPL-2.0-or-later. See `../LICENSE`.
