# legal

The agreements and policies of WolOS Hub (hub.wolos.org). English is the original; translations come later through the l10n process.

**Review note:** reviewed by the operator; legal counsel review recommended before relying on it in a dispute.

## Versions

Version 1 of every text, effective 2026-11-04 (the Privacy Policy is at version 2, same day; Changes Log section 4). The hub records the SHA-256 of the exact bytes it serves with every acceptance, so any edit to a file needs a new hash here.

| File | Route | Title | Version | Effective | Words | SHA-256 | How it binds |
|---|---|---|---|---|---|---|---|
| `CLA.md` | /terms/cla | Contributor Licence Agreement | 1 | 2026-11-04 | 1445 | `3e986ec53c7e81e1728ec3115ba24f3424c47d1e18d291d0ae5a9a898b5197d2` | accepted at first sign-in (and by an owner for an organisation) |
| `TERMS-OF-USE.md` | /terms/usage | Terms of Use | 1 | 2026-11-04 | 5123 | `a3322489c509f98d72565662b9cfb45f1afeaa7a1fe52c8c8e42975fad7c6315` | accepted at first sign-in |
| `PRIVACY.md` | /terms/privacy | Privacy Policy | 2 | 2026-11-04 | 4161 | `6d347d9d60ed744fbc0be1e53e3e080689fa1e79631321c7c19635ea78a7cc9a` | notice, not accepted |
| `COOKIES.md` | /terms/cookies | Cookie Notice | 1 | 2026-11-04 | 524 | `b38e5578ed508d6d77e76411120060b50ff8726e8da9c33f3bfa3fc22c4f1ba8` | notice, not accepted |
| `PUBLISHER-AGREEMENT.md` | /terms/publisher | Publisher Agreement | 1 | 2026-11-04 | 2764 | `c7877a5a3a5e45946d2d3bd9d052190baf7f0c3edb65a2e857125edc357b94b7` | accepted before the first publish |
| `TRUST-TERMS.md` | /terms/trust | Trust Terms | 1 | 2026-11-04 | 1300 | `f3cc280c9413f219ae270b966686ec257f6943ff656c55a0982500fc3707d674` | accepted with every certificate request |
| `CERTIFICATE-TERMS.md` | /terms/certificates | Certificate Terms | 1 | 2026-11-04 | 2151 | `836204a896f287f703d17670a476eb941637c8bcfe4887220f5ae4b906c77879` | accepted with every certificate request, through the Trust Terms |
| `HUB-POLICIES.md` | /terms/policies | Hub Policies | 1 | 2026-11-04 | 1966 | `98b886745b34c4a73d65c3c2ac60eca09c8ca33b334558656877a74c3dab503a` | part of the Terms of Use and the Publisher Agreement |
| `DMCA-AND-NOTICES.md` | /terms/notices | Notices and Takedown | 1 | 2026-11-04 | 1878 | `c3a1b4bfde109b34430f86349074f4d4caff15aaa273c3ca32070260b9dbb893` | part of the Terms of Use |
| `SECURITY-POLICY.md` | /terms/disclosure | Disclosure Policy | 1 | 2026-11-04 | 1073 | `52afa496d11f5b28b42087073a01ce68441a955c1fc47ba35f2165933d249309` | part of the Terms of Use |
| `TRADEMARK.md` | /terms/trademark | Trade Mark Policy | 1 | 2026-11-04 | 994 | `d752ae17bcdf4fa1ca8c71a5dc1f579dc30b0107a63424315fce4de2eefc883e` | part of the Terms of Use |
| `CHANGES-LOG.md` | /terms/changes | Changes Log | 1 | 2026-11-04 | 764 | `6bef521ead2ad9832ed404480f49e7bbace3a82fca0d6e5e6dcea1160b9e6ef1` | part of the Terms of Use |

`RESEARCH.md` is internal: the sources, the duty table and the style sheet behind these texts. It is not served and has no route.

## File format

Each text starts with front matter (`title`, `version`, `effective`), then the `# Title`, then the line `Version N, effective DATE.` (the Worker reads the version from that line), then an "In short" box that is marked as not binding, then numbered sections. Definitions live in one place: section 2 of the Terms of Use.

## Changing a text

1. Edit the file, raise its version on both the front matter and the `Version` line, and set the new effective date.
2. Add an entry to section 4 of `CHANGES-LOG.md`.
3. Recompute the SHA-256 in the table above (`sha256sum *.md`).
4. Announce changes that matter to people 30 days ahead, as `CHANGES-LOG.md` section 2 says.
