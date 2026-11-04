# `wol publish`: specification for the system worker

Status: design (HUB-publish, 2026-11-04). Not code. It mirrors the hub's flow (PUBLISH-FLOW.md) in a terminal: tag, release,
then watch the same four stages the status page shows. The Worker side exists (`wt/hub-worker`): the CLI only needs the two
public routes below, no hub sign-in. The output sentences come from the Worker (`headline.sentence`, `headline.fix`,
`findings[].sentence`), so the terminal, the page and this spec always say the same thing.

## 1. Synopsis

```
wol publish [TAG] [--file FILE] [--repo OWNER/NAME] [--id ID] [--no-wait] [--json]
wol publish status [TAG] [--repo OWNER/NAME] [--json]
```

| Argument | Meaning |
|---|---|
| `TAG` | the version to publish, `v1.2.0` or `1.2.0`. Absent: the tag on `HEAD` (section 3). |
| `--file FILE` | the package to attach. Absent: the file the listing names (section 4). |
| `--repo OWNER/NAME` | the GitHub repository. Absent: the `origin` remote. |
| `--no-wait` | stop after "Received"; do not follow the check and signing. |
| `--json` | print one JSON object (the final `status` answer, plus `repo`, `tag`) on stdout and nothing else; progress goes to stderr. |
| `status` | only watch: do not tag or release anything. |

Register it like the other commands in the argument table of `crates/controller/src/cli.rs`: a positional optional `tag`, options `file`, `repo`, `id`, flags `no-wait` and `json`; `["publish","status"]` is a second command with the same options.
`["publish","status"]` is a second command with the same options. Help line: "Publish a version of your app, plugin or extension to WolOS Hub and watch it go through."

## 2. What it needs

- `git` (always) and `gh`, the GitHub command (to create the release). With no `gh` the command still works up to the release
  and then prints the address to do it in the browser (section 6, "No gh").
- The network, for `https://hub.wolos.org/api/...` (read only, no sign-in).
- The repository must already be connected on the hub (once, in the browser). The CLI does not sign in.

## 3. Finding the repository and the tag

1. Repository: `--repo`, else `git remote get-url origin` parsed as `github.com[:/]OWNER/NAME(.git)`; any other host: error 2 "The remote origin is not on GitHub. Give the repository with --repo OWNER/NAME."
2. Listing: `GET /api/listings?repo=OWNER/NAME` -> `{listings: [{id, kind, asset, status}]}`. One listing: use it. Several (a repository with an app and a plugin): ask which with a numbered list on a terminal, or fail with "This repository has more than one listing: a.b, a.c. Run it again with --id ID." and take `--id` (add `--id ID` to the synopsis for this case). None: section 6, "Not connected".
3. Tag: the argument, else the newest version tag that points at `HEAD` (`git tag --points-at HEAD`, sorted as versions), else error 2 "No tag on this commit. Run wol publish v1.0.0 to tag it and publish." With a `TAG` that does not exist locally, the command creates it on `HEAD` (`git tag TAG`) after showing "Tag v1.0.0 will be created on <short commit>." and, on a terminal, asking `[Y/n]`; then `git push origin TAG`.
4. The working tree must be clean for a tag it creates; otherwise error 2 "There are uncommitted changes. Commit them, then run it again."
5. Version = the tag without a leading `v` before a digit (the same rule as the hub: `versionOf`).
   The file has to say that same version (the check blocks it otherwise, `listing/version-mismatch`): `version` in
   `plugin.toml` / `extension.toml` for a plugin or extension, so its tag is `v<version>`; `version` in `Info.json` for
   an app, which is the pacman version of its payload, `<pkgver>-<pkgrel>`, so an app is tagged `v<pkgver>-<pkgrel>`
   (`v0.1.0-1`, file `<id>-0.1.0-1.wol`).

## 4. Finding the file

The listing's `asset` is a pattern with one star (`alice.notes-*.wol`). The file is the pattern with the version in place of the star.
Looked up in `.`, `dist/`, `build/` (first hit). `--file` wins and must match the pattern (else error 2 "The file name must match alice.notes-*.wol."). Not found:
- kind plugin: runs `wol plugin pack` with the output in `dist/` and looks again;
- otherwise error 2 "No file named alice.notes-1.0.0.wol in . or dist/. Build it, or give it with --file."

## 5. What it prints at each stage

Plain lines, no colour needed, no emoji; one line per change, written when it happens. On a terminal the current stage line is redrawn with a
spinner; on a pipe each change is a new line. Times are local, `HH:MM`. Exit codes: 0 published (or kept off the list: pre-release), 1 the hub did not list it, 2 the command was misused or something local is missing, 3 gave up waiting, 4 the hub or GitHub cannot be reached.

```
$ wol publish v1.0.0
Repository   alice/notes  (listing alice.notes, an app)
Tag          v1.0.0 on 3f2a91b           created and pushed
File         dist/alice.notes-1.0.0.wol  2.4 MB
Release      created on GitHub: https://github.com/alice/notes/releases/tag/v1.0.0

Received     10:02   The hub has your release.
Checked      10:14   The check found nothing to report.            (or: "The check found 2 things to look at." and the list)
Signed       11:20   Signed by WolOS Hub (statement 3f2a91bc).
Published    11:20   Notes 1.0.0 is listed on the hub and offered to install.

Your own signature: none. This version shows as Community: nobody vouches for who made it.
To show your name on your releases: wol cert request, then https://hub.wolos.org/dashboard#certs
https://hub.wolos.org/status?l=alice.notes&v=1.0.0
```

Rules:
- The four stage words are exactly the status page's: Received, Checked, Signed, Published. A stage not reached yet is not printed; the line under way ends in `...` and a spinner.
- The poll: `GET /api/listings/<id>/versions/<version>/status` with `If-None-Match` (a 304 changes nothing), every `poll` seconds the answer says (5, then 15), backing off 1.5x up to 30 s on no change. A stage line is printed when `stages[i].state` moves to `done` (time from `stages[i].at`), a `failed` stage prints `Failed` plus the headline.
- On `outcome` `working` for more than 90 minutes, stop with exit 3: "Still under way after 90 minutes. Follow it here: <status address>". (Signing runs every hour; a normal publish ends in under 80 minutes.) `--no-wait` exits 0 after Received.
- `--json` replaces all of the above on stdout with the last status object.

### Failures (exit 1), with the Worker's own sentences

```
Received     12:02   The hub has your release.
Checked      12:15   Not listed.
  The check found something that stops this version from being listed.
  - The package asks to read all your files.
  Fix the points above, then publish a new version with a new tag. A version that was checked is never replaced.
  Next: wol publish v1.1.1
```

```
$ wol publish v2.0.0
...
Received     --      No file found in the release.
  The release v2.0.0 has no file named alice.notes-*.wol.
  Attach the file to the release on GitHub, then press Check again: https://hub.wolos.org/status?l=alice.notes&v=2.0.0
```

(The CLI cannot press Check again: it needs a sign-in. The page does it; or run `wol publish status v2.0.0` after attaching the file, because the next GitHub event or the page's button makes the hub look again.)

Print `headline.title` as the line's text, `headline.sentence`, each `findings[].sentence` as `- ...` (and its `fix` indented under it), then `headline.fix`. For `blocked` add the line `Next: wol publish v<next patch>`.

## 6. Special cases

- **Not connected.** The lookup returns no listing:
  ```
  alice/notes is not connected to WolOS Hub yet. Connect it once, in the browser:
  https://hub.wolos.org/publish
  Waiting for you to connect it... (Ctrl-C to stop)
  ```
  Polls the lookup every 3 s for 10 minutes, then continues with the flow when the listing appears (and prints "Connected as alice.notes."); with `--no-wait` exit 2.
- **Already released.** The release for the tag exists (`gh release view TAG` succeeds): skip creating it, print `Release      already on GitHub: <url>`, and watch.
- **A bare tag.** If the tag is pushed but `gh` is missing: print
  ```
  The tag v1.0.0 is pushed. Publish the release with its file on GitHub:
  https://github.com/alice/notes/releases/new?tag=v1.0.0
  Then run: wol publish status v1.0.0
  ```
  and exit 0. (The hub already shows "Waiting for your release" at the status address, because the App sees the tag.)
- **Pre-release tags** (`v1.0.0-rc1`, `gh release create --prerelease`): create the release as a pre-release; the last line is the headline "Kept off the list" and exit 0.
- **The hub cannot be reached:** exit 4, "The hub can't be reached. Check your connection and try again." The tag and release already made are not undone.
- **`gh` not signed in:** exit 2, "gh is not signed in to GitHub. Run gh auth login, then run this again."
- Nothing is ever deleted or force-pushed. A re-run is safe: tagging, pushing and creating the release each skip what already exists.

## 7. Where it lives

`crates/controller/src/` next to `cert.rs`: `publish.rs` (argv, git/gh calls through the existing process runner, the poll loop) and the
command table entries in `cli.rs`. Pure functions to test without the network: `repo_from_remote`, `tag_on_head` (sorting), `asset_for(version, pattern)`, `render_status(&Status) -> Vec<String>` (the transcript above, given a status object), `next_patch`. The hub answers are the `Status` struct (`stages`, `outcome`, `headline`, `findings`, `poll`, `listed_path`, `signature`) from `wt/hub-worker/README.md` `GET /api/listings/:id/versions/:v/status`; a fixture file per outcome (published, published-notes, blocked, no-asset, waiting-release, prerelease, removed) belongs in `crates/controller/tests/fixtures/publish/`.

## 8. Later

- Connect a repository from the terminal: needs GitHub Device Flow enabled on the hub's App (a setting the lead owns) and a `POST /api/listings` with a device token; until then the browser is the one-time step.
- `wol publish --check-only` that runs hubcheck locally on the file before the release is made (the same checker the pipeline runs).
