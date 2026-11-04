# legal

The agreements and policies of WolOS Hub (hub.wolos.org). English is the original; translations come later through the l10n process.

**Review note:** reviewed by the operator; legal counsel review recommended before relying on it in a dispute.

## Versions

Version 1 of every text, effective 2026-11-04. The hub records the SHA-256 of the exact bytes it serves with every acceptance, so any edit to a file needs a new hash here.

| File | Route | Title | Version | Effective | Words | SHA-256 | How it binds |
|---|---|---|---|---|---|---|---|
| `CLA.md` | /terms/cla | Contributor Licence Agreement | 1 | 2026-11-04 | 1445 | `3e986ec53c7e81e1728ec3115ba24f3424c47d1e18d291d0ae5a9a898b5197d2` | accepted at first sign-in (and by an owner for an organisation) |
| `TERMS-OF-USE.md` | /terms/usage | Terms of Use | 1 | 2026-11-04 | 4910 | `db02ee5dfd48e1c17290b1844a448648acfd0ebd60eb67ecef17e0ddf5dd3db7` | accepted at first sign-in |
| `PRIVACY.md` | /terms/privacy | Privacy Policy | 1 | 2026-11-04 | 3608 | `1787fe6054f09d566c048f1591a2a49d15e1aa8e2a9baa743aa7d4f689d0f23a` | notice, not accepted |
| `COOKIES.md` | /terms/cookies | Cookie Notice | 1 | 2026-11-04 | 491 | `52e9e42f7df91497ab109d3e45ba0fe0c0636fd08fa0f020beec1b07b488dec5` | notice, not accepted |
| `PUBLISHER-AGREEMENT.md` | /terms/publisher | Publisher Agreement | 1 | 2026-11-04 | 2193 | `ad455505888df1110d240d176142bc91ef24dfa95facdfc392caa8ea85f03dd3` | accepted before the first publish |
| `TRUST-TERMS.md` | /terms/trust | Trust Terms | 1 | 2026-11-04 | 1194 | `e55a2896f8d311a1d2accf684fabbc70505306bb280b455a8a4e90663fcbb30a` | accepted with every certificate request |
| `CERTIFICATE-TERMS.md` | /terms/certificates | Certificate Terms | 1 | 2026-11-04 | 1819 | `c342c001643f75580722934bf2a2b8311b31d878192ef1aea2e5654604c8cd7d` | accepted with every certificate request, through the Trust Terms |
| `HUB-POLICIES.md` | /terms/policies | Hub Policies | 1 | 2026-11-04 | 1916 | `de4f2b3103efd1a9fdeb6b2037addb17653f6ac314c1774bf535cbd235d29c81` | part of the Terms of Use and the Publisher Agreement |
| `DMCA-AND-NOTICES.md` | /terms/notices | Notices and Takedown | 1 | 2026-11-04 | 1878 | `c3a1b4bfde109b34430f86349074f4d4caff15aaa273c3ca32070260b9dbb893` | part of the Terms of Use |
| `SECURITY-POLICY.md` | /terms/disclosure | Disclosure Policy | 1 | 2026-11-04 | 1073 | `52afa496d11f5b28b42087073a01ce68441a955c1fc47ba35f2165933d249309` | part of the Terms of Use |
| `TRADEMARK.md` | /terms/trademark | Trade Mark Policy | 1 | 2026-11-04 | 994 | `d752ae17bcdf4fa1ca8c71a5dc1f579dc30b0107a63424315fce4de2eefc883e` | part of the Terms of Use |
| `CHANGES-LOG.md` | /terms/changes | Changes Log | 1 | 2026-11-04 | 690 | `9c48426cb6af870bb908ae6c66fd2604f6e8455309c17cdc3caf146a70fe9882` | part of the Terms of Use |

`RESEARCH.md` is internal: the sources, the duty table and the style sheet behind these texts. It is not served and has no route.

## File format

Each text starts with front matter (`title`, `version`, `effective`), then the `# Title`, then the line `Version N, effective DATE.` (the Worker reads the version from that line), then an "In short" box that is marked as not binding, then numbered sections. Definitions live in one place: section 2 of the Terms of Use.

## Changing a text

1. Edit the file, raise its version on both the front matter and the `Version` line, and set the new effective date.
2. Add an entry to section 4 of `CHANGES-LOG.md`.
3. Recompute the SHA-256 in the table above (`sha256sum *.md`).
4. Announce changes that matter to people 30 days ahead, as `CHANGES-LOG.md` section 2 says.
