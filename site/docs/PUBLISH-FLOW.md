# Publishing on WolOS Hub: the flow

Status: design for the lead (HUB-publish, 2026-11-04). The spec is the lead's of 02:31Z: publishing is tag-driven; a
status page per version; one dashboard for an author or an organisation; an admin queue with one-click actions; a
`wol publish` command that mirrors the flow. Speed is part of the design (section 7). Doctrine: no upstream names, no
engineer talk on pages, honest states only (the hub is real; nothing on a production page is example data).

Wireframes (this folder, `wireframes/`): `1-publish.png`, `2-status-published.png`, `3-status-failed.png`,
`4-dashboard.png`, `5-admin-queue.png` (SVG next to each; `wireframes.py` draws them with the hub's tokens).

## 1. What was wrong

- The publish page was a form with 8 fields (id, name, summary, licence, repository, file name, kind, owner) that the
  hub could have filled itself, then a single sentence "push a tag". No sign that anything arrived.
- After "push a tag" a developer saw nothing: a release without the right file, a bad tag or a rate limit were only
  written to a private audit log. The only place to look was the dashboard, which said "Checking" or "Flagged".
- The pages asked the Worker six times in a row (`/api/me`, then more) and `/api/me` alone made 14 D1 round trips.

## 2. The developer path, from zero to published

Five screens the first time, one command afterwards.

| # | Where | What the developer does | Done when |
|---|---|---|---|
| 1 | hub | Presses **Sign in with GitHub** | session exists |
| 2 | hub | Reads and accepts the two agreements on one screen (**Accept and continue**) | Contributor Agreement and Publisher Agreement are current |
| 3 | GitHub | Sees every public repository of theirs (or of an organisation, tabs) with its state: WolOS Hub installed, not installed yet, connected. Presses **Install and connect** on one: GitHub's address for exactly that repository (`/installations/new/permissions?target_id=..&repository_ids[]=..&state=connect.<id>.<kind>`); GitHub's setup step brings them back to `/publish?state=..` and the page connects it without another click (the browser also remembers the choice for 30 minutes, for when the Setup URL is not set). "Choose the repositories on GitHub" is the alternative link | the hub App is installed on a public repository the person owns |
| 4 | hub | Picks the repository in the list, picks **App / Plugin / Extension**, presses **Connect** (id, file name, name, summary and licence are filled from the repository; **Details** opens them for editing) | a listing exists in state "Connected" |
| 5 | terminal | `git tag v1.0.0 && git push origin v1.0.0 && gh release create v1.0.0 alice.notes-1.0.0.wol` (the hub shows these three lines with the real names filled in), or `wol publish` | the status page of v1.0.0 shows Published |

After that: **push a tag**. The hub sees the tag at once ("Waiting for your release"), the release when it is published
("Received"), and walks the version through Checked, Signed and Published on its status page, which refreshes itself.

Signing with your own certificate (a name on your files) is not in the way. It is offered on the status page of the
first version ("Listed as Community. Sign your releases to show your name") and on the dashboard.

## 3. Screens and states

### 3.1 Publish (`/publish`), wireframe 1

A rail on the left with the five steps; the page shows the step that needs the person, and folds the finished ones into
one line each ("Signed in as alice", "Agreements accepted, version 1"). Every state appears instantly as a skeleton; the
person's real state streams in. Returning visitors land on the first unfinished step.

| State | What is shown |
|---|---|
| Signed out | "Publish an app, a plugin or an extension. Your files stay on GitHub; the hub checks every version and lists it." + **Sign in with GitHub**. The five steps are listed greyed so the whole path is visible. |
| Agreements missing | One card, two tabs (Contributor Agreement, Publisher Agreement) with the text in a scrolling box, two checkboxes, **Accept and continue**. When a text changed: "The Publisher Agreement has a new version. Read it and accept it before your next release." |
| Hub not installed | "Install WolOS Hub on the repositories you publish from. It only reads their releases." **Install on GitHub**. |
| The list of repositories | A search field ("Find a repository", filters as one types), the count ("320 repositories, 150 with WolOS Hub"), the long list (fixed rows, its own scroll, only the rows in view in the page; `src/kit.js`), sorted connected, installed, most recently pushed. Loading: a skeleton. Empty: "This account has no public repository on GitHub yet. Make one public on GitHub, then come back." No match: "No repository has that in its name." GitHub down: the Worker's sentence and **Try again**. Past the Worker's caps: "Only the most recently pushed are listed. Type part of a name to find another." |
| Installed, no public repository | "WolOS Hub is installed, but only on private repositories. People download your files from your releases, so the repository must be public. Make one public on GitHub, then come back." |
| Pick a repository | A list: repository, "Public"/"Private", and "Connected as alice.notes" for the ones already connected. Private ones are greyed with "Private. Make it public on GitHub to publish it." Organisations the person owns but has not linked: **Link acme** ("Linking accepts the Contributor Agreement for acme."). |
| Connect | Chips App / Plugin / Extension (extension asks "Which app does it extend?"), a line "It will be listed as alice.notes. Releases need a file named alice.notes-*.wol.", **Connect alice/notes**. **Details** edits id, name, one sentence, licence, file name. |
| Connected | Success with the three terminal lines (copy button) and **Open the dashboard**. If the repository already has a tag or release with the right file, the hub says so: "v0.9.0 is already on GitHub with the right file. Publish it again to send it to the hub." |

### 3.2 Version status (`/status?l=alice.notes&v=1.0.0`), wireframes 2 and 3

One page per version, the place the dashboard, the terminal and the e-mail-free world point to. It names the listing,
version, tag and repository, then shows a four-stage track.

Stages: **Received**, **Checked**, **Signed**, **Published**. Each is `done` (with the time), `current`, `waiting`,
`failed` or `skipped`. Under the track, one headline (title, one or two sentences, and what to do), then:

- **The signature line**, once signed: "Signed by WolOS Hub on 4 November 2026 (statement 3f2a91bc)." and "Your own signature: none. This version shows as Community: nobody vouches for who made it." (or origin, trusted).
- **The file**: name, size, SHA-256 with a copy button, link to the release on GitHub.
- **What the check found**, a list of plain sentences; for a blocked version, each is a thing to fix.
- **Actions**: **Check again** (the owner; asks GitHub for the release now), **Open the listing** (when published), **Report** nothing here.

The page asks `GET /api/listings/:id/versions/:v/status` every 5 seconds while a stage is current, then every 15 and 30,
with a conditional request (cheap `304`). It stops at a final state. Without JavaScript it shows what was last known.

### 3.3 Dashboard (`/dashboard`), wireframe 4

Everything for one author or organisation on one page; the account switch (person, organisations) keeps working as
HUB-ux built it (no load, header untouched). Sections, in a left rail that scrolls to them:

1. **Needs your attention**: only when there is something: a blocked version ("alice.notes 1.1.0 was not listed. See why"), a revoked certificate, a newer agreement to accept, a tag waiting for its release.
2. **Listings**: one card per listing (icon, name, kind, repository, "Connected"), the latest version with its four-stage mini track, and the last three versions as rows linking to their status pages. **Show all versions**. A **Connect another repository** card.
3. **Certificates**: origin and trusted cards as today, plus the `wol cert request` command for this account.
4. **Agreements**: version, day, who accepted, SHA-256 of each text.
5. **Reports** about these listings, open and closed, with the reporter never named.
6. **Members and roles** of the organisation (from GitHub).

### 3.4 Admin queue (`/admin`, closed), wireframe 5

The panel exists for roles only (404 to everyone else; two-factor on). The Queue tab is now one list in order of
urgency with the buttons on the row, not in a dialog:

- **Certificate requests**: **Approve** (one click, optional note on the row) and **Refuse** (opens a reason field in the row; the reason is shown to the person).
- **Revocations**: **Approve as second admin** (a reason field opens on the row: the revocation is irreversible and withdraws signed files, so it is never one click).
- **Reports**: **Resolve** (one click), **Take down** / **Flag version** / **Withdraw version** (reason on the row).
- **Versions to look at** (new): versions whose check flagged or blocked them, or could not read the file, in the last 14 days, with **Flag** and **Withdraw**.
- **Revoke** and **Downgrade** stay in Look up (a login), with a reason and the choice "key was stolen / abuse".

Rules that stay: nobody decides about their own certificate; a stolen key acts at once, abuse needs a second admin;
every action lands in the audit trail with the reason.

Since the session hardening (lead 2026-11-04 10:28Z; Worker `docs/SECURITY-SESSIONS.md`):

- The header says how long the GitHub sign-in stays fresh ("Sign-in fresh for 12 mins") and offers **Sign in again**:
  every action needs a sign-in younger than 15 minutes; a stale one answers "Confirm it is you" with the same link.
  A session that moved network and browser at once is kept out of the panel (sign in again).
- **People** tab: search by login or name, a person's page with their signed-in browsers (network as a one-way code, never the address; last use; moved or not),
  listings and last actions; **Ban** / **Unban** (reason on the row; a ban ends every sign-in of theirs) and **End their sessions**.
- **Listings** tab: search by id, name or repository, or by state; **Take down** without a report and **Restore** (reason on the row).
- **Audit trail** tab: filters (who, what, on what, from, to), pages, and **Export as a file** (NDJSON of the same filter).
- **Health** tab: signed-in sessions, rate limits hit in 24 hours, error reports, the last release notices and tags taken in, the trail's last day.
- These tabs are a second script, loaded when one of them opens (the panel's first script is at the 12 KB budget); each shows its outline until the answer arrives.
- Dashboard, **Where you are signed in**: each browser the person signed in from, its network only as "same network as now"
  or "another network" (the hub keeps a one-way code, never the prefix), **End** per row and **Sign out everywhere**.
- The audit trail keeps sign-in entries 90 days; admin decisions stay (legal/PRIVACY.md 3.7).

## 4. Error states, with the exact sentences

The Worker writes these (`src/status.ts`); the status page, the dashboard and `wol publish` show them as they are. `{x}` is filled in.

| Code | Title | Sentence | What to do |
|---|---|---|---|
| `waiting-release` | Waiting for your release | The hub saw the tag {tag} on {repo}. A version is received when you publish a release for that tag with a file named {asset} attached. | On GitHub, publish a release for {tag} and attach {file}. |
| `draft` | Waiting for you to publish | The release {tag} is still a draft. The hub looks at a release when you publish it. | Publish the draft on GitHub. |
| `no-asset` | No file found in the release | The release {tag} has no file named {asset}. | Attach the file to the release on GitHub, then press Check again. |
| `ambiguous-asset` | More than one file fits | The release {tag} has more than one file named like {asset}: {names}. | Leave one file on the release, then press Check again. |
| `bad-tag` | The tag is not a version | The tag {tag} is not a version the hub can use. A version is a number such as v1.2.3 or 1.2.3. | Tag the release with a version such as v1.0.1 and publish it again. |
| `rate-limited` | Too many releases today | {owner} has published 20 releases in the last day, which is the daily limit. | Press Check again tomorrow. |
| `checking` | Being checked | The hub has your file and is checking it. This usually takes about fifteen minutes. | Nothing. This page updates by itself. |
| `signing` | Checked, waiting to be signed | The check is done. The hub signs and lists new versions every hour. | Nothing. This page updates by itself. |
| `published` | Published | {name} {version} is listed on the hub and offered to install. | |
| `published-notes` | Published, with notes | {name} {version} is listed. People see these notes next to it. | Fix them in your next version if you can. |
| `blocked` | Not listed | The check found something that stops this version from being listed. | Fix the points below, then publish a new version with a new tag. A version that was checked is never replaced. |
| `not-checked` | The check could not read the file | The hub could not download or open {file}. Nothing was found against it. | Make sure the release is public and the file opens, then press Check again. |
| `prerelease` | Kept off the list | {tag} is marked as a pre-release on GitHub, so the hub checks it but does not list it. | Publish it as a full release when it is ready. |
| `removed` | Removed | You deleted the release {tag} on GitHub. The hub no longer offers this version. | |
| `withdrawn` | Withdrawn by WolOS Hub | WolOS Hub withdrew this version. It is not offered to install or as an update. Reason: {reason}. | Fix what the reason says and publish a new version. |
| `listing-taken-down` | Listing taken down | WolOS Hub took this listing down. It is not offered to install or as an update. | Write to the hub if you think this is a mistake. |
| `listing-withdrawn` | Listing withdrawn | {repo} changed hands on GitHub, so the hub stopped listing it. | Connect the repository again from the publish page. |

The file-changed case (`asset-changed`, from the check) reads: "The release file changed after it was first checked."
and its fix is "Never change a file after publishing. Publish the new file as a new version."

Connecting a repository (the Worker's existing sentences, shown on the row of the repository):
`id-taken` "{id} is already registered." / `wrong-namespace` "Ids you publish as {login} start with {login}." /
`private-repo` "The repository must be public: people download the files from its releases." /
`not-your-repo` "{repo} is not owned by {login} on GitHub." / `org-not-linked` "{org} is not linked to the hub yet. An owner of it links it first." /
`too-many-listings` "One person can register at most 50 listings." / `app-not-installed` "WolOS Hub is not installed on {repo}. Install it on GitHub, then connect the repository: {link}" / `two-factor-needed` "Turn on two-factor sign-in on your GitHub account first. The Publisher Agreement asks for it." / `account-too-new` "Your GitHub account is younger than 90 days. The hub lists a first app once the account is 90 days old." / `cla-needed`, `publisher-terms-needed` "Accept the {agreement} (version {n}) first."

Network: "The hub can't be reached. Check your connection and try again." (every page; the last known data stays on screen, marked "as of {time}").

## 5. What the Worker offers (new in bold)

| Route | Who | What |
|---|---|---|
| **`GET /api/my/overview?as=`** | person | One answer per page: the person, accounts, listings with versions and stages, attention list, reports, certificates, agreements, members. 2 D1 round trips. ETag. |
| **`GET /api/repos[?as=org]`** | person | Every page of the hub App's installations the person sees, and the public repositories of the person (or the organisation) the App is not on yet; per repository `app`, `install` (GitHub's address for it), `pushed_at`, `connected` and the autofill (id, asset, name, summary, licence); `truncated` past the caps (at most 36 GitHub calls). |
| `POST /api/listings` | person | Now also `{repo, kind?, owner?}` only: the rest is filled from GitHub (explicit fields still win). |
| **`GET /api/listings/:id/versions/:v/status`** | anyone | The stage model above. Public, cacheable for 5 seconds; the owner also gets `withdrawn_reason` and `can.recheck`. |
| **`POST /api/listings/:id/recheck`** | owner | `{tag}`: asks GitHub for that release now and takes it in as if the webhook had come. |
| **`GET /api/listings?repo=owner/name`** | anyone | Which listings a repository has (for `wol publish`). |
| `POST /api/webhook/github` | GitHub | Now also the tag `create` event and every release outcome becomes a row the status page can read (`tag_intake`). |
| `GET /api/me` | person | Same answer, 1 D1 round trip instead of 14. |
| `GET /api/admin/queue` | role | Adds `attention`: the versions to look at. |

## 6. `wol publish`

Specified in `WOL-PUBLISH-SPEC.md` (same folder), for the system worker.

## 7. Speed

Targets: `/api/me` and the dashboard/publish answers under about 150 ms at the edge; one round trip per page; the page is
usable (skeleton, header, steps) at once and the data streams in; no blank wait. How:

1. D1: the work of a request is one `batch` of reads, not a chain (me: 14 round trips to 1; dashboard: 44 over six calls to 2 in one call). Indexes on the new lookups (`reports(listing_id)`, `tag_intake(listing_id, at)`).
2. One call per page (`/api/my/overview`; the header takes the person from it, so `/api/me` is not asked on these pages), with an `ETag` and `Cache-Control: private, max-age=15, stale-while-revalidate=120, Vary: Cookie`. The legal texts (12 KB) are cacheable by their hash (`/api/terms/*`: `public, max-age=3600, stale-while-revalidate=86400`, ETag = the SHA-256) and are fetched only when a text must be accepted.
3. The browser: pages draw from the last answer kept in `sessionStorage` (marked as of a time), then replace it; hovering or touching **Publish** or **Dashboard** in the header prefetches the page's data into the HTTP cache; the polling of the status page uses `If-None-Match`.
4. The per-person KV cache asked for is **not** used: KV allows about 1,000 writes a day on the free plan and reads can be a minute old, so a profile cache would be both costly and a stale-permissions risk (a ban or a role change must act at once). One batched D1 read is the cheaper way to the same time. If the measured D1 time is still too long, the next step is D1 read replication.

The numbers (before and after) are in `wt/hub-worker/bench/budget-before.txt` / `budget-after.txt` and in the hand-back. Measured on the live hub from the build box: a route with no D1 read answers in 44 ms (median), one with a single D1 read in 59 ms, so a D1 round trip costs about 15 ms and `/api/me` used to cost about 14 of them.

## 8. Open points for the lead

- The agreements step has one **Accept and continue** with one checkbox per agreement. Whether one button for two documents is acceptable is the lead's call; the alternative is one button per agreement.
- `POST /api/listings` now enforces what the Publisher Agreement 2.1 and the Hub Policies say about the person: two-factor on, and a GitHub account of at least 90 days for a first listing. The repository rules (30 days old, 5 commits, protected branch and tags) are not enforced yet.

## 9. What needs the lead

- GitHub App "WolOS Hub", settings: subscribe to **Create** (tag pushes) in addition to Release and Repository; set **Setup URL** to `https://hub.wolos.org/publish` and tick "Redirect on update", so the person lands back on the wizard after installing. Without them everything still works: the hub sees the release (not the bare tag), and the wizard notices the install when the tab regains focus.
- Optional: enable **Device Flow** on the App, so `wol publish` can connect a repository from the terminal (see the spec, "later").

## 10. Freshness, agreements, the admin door, analytics (2026-11-04)

- **Never an old copy.** `/api/my/overview` is sent `private, max-age=15, stale-while-revalidate=120` with an ETag. The pages
  ask it with `cache: "no-cache"` (a 304 when nothing changed), never the browser's copy unasked: before, a page drew a body up
  to two minutes old (after a sign-in, an install, a release elsewhere) and never the new one. A sign-in or sign-out in another
  tab redraws this tab's header and page (`hub:who`), and an account switch asks again after 5 s.
- **One agreement component.** Every agreement on a page (publish step 2, the dashboard's Trust Terms and each agreement card's
  "Read the text here") is the text of `/api/terms/<doc>` drawn by `src/kit.js` the way `/terms/<doc>` draws it: title,
  version line, the In short box, numbered sections, lists; never the raw Markdown.
- **Admin.** The header and the dashboard show Admin (queue, people, listings, audit trail) only when the overview names a panel
  role; the address is made by `hub.js` for that person only, so no page names it (`check-links.mjs`).
- **Cloudflare Web Analytics.** The zone's Web Analytics adds its beacon at Cloudflare's edge, not the hub's pages; it sets no
  cookie. The CSP allows exactly it: `script-src-elem 'self' https://static.cloudflareinsights.com` and
  `connect-src 'self' https://cloudflareinsights.com` (`scripts/check-headers.mjs`); `script-src` stays `'self'`.

### 10.1 Organisations: whose agreement is whose (2026-11-04)

The lead asked who accepts the agreements for an organisation and whether the owner's own acceptance counts. It does not:

- **Contributor Licence Agreement:** an organisation accepts it as itself. An owner of it on GitHub accepts it for the
  organisation (`POST /api/orgs {org, version, sha256}`, which links it, checks the owner live on GitHub and records the
  acceptance with `accepted_by`). The owner's personal acceptance never counts for it, and a member's never does.
- **Publisher Agreement:** personal, always; an organisation has none.
- **Trust Terms and Certificate Terms:** accepted with each certificate request, for the subject of that request.

What the pages show:

- The dashboard's account switcher names each account with its state: "agreements accepted" or "CLA pending" (the person's
  own: "CLA pending" or "Publisher Agreement pending" until both are accepted). From `me.orgs[].cla` of the one overview.
- An organisation whose CLA is not accepted gets a card at the top of `/dashboard` and at step 2 of `/publish?as=<org>`:
  "<org> still needs to accept the Contributor Licence Agreement (version X)". An owner gets **Accept as an owner of
  <org>**; a member gets "Ask an owner of <org> to accept it", with the owners the hub knows (`me.orgs[].owners`: members
  with the owner role who signed in to the hub; none known: "on GitHub").
- The organisation's agreements list says who accepted it ("Version 1 accepted by kleeedolinux as an owner, 4 November
  2026"); the person's list says "accepted by you" and that it counts only for the person.
- `/publish?as=<org>` step 2 lists the organisation's CLA and the person's Publisher Agreement as two rows, each with its
  state and its accept action (an owner ticks "Accept as an owner of <org>"; the person's own CLA shows too while it is not
  accepted), and keeps one **Accept and continue**. Until the organisation's CLA is accepted steps 3 to 5 wait; a member
  cannot get past step 2 and has "Publish as yourself instead".
- The repository picker shows on each account's tab only that account's repositories (the lead saw an organisation's
  repository under the personal tab): `GET /api/repos` filters by the owner, and the page filters again by `account.login`.

The Worker enforces the same: connecting a repository as the organisation (`POST /api/listings` with `owner` or `?as=`),
Check again on its listing and its certificate request answer 403 `cla-needed` with "<org> still needs to accept the
Contributor Licence Agreement (version X). An owner of <org> accepts it as the organisation on the hub first."
Tests: `tests/org-agreements.mjs` (browser), `hub-worker/test/org-cla.test.ts` and `test/repos.test.ts`.
