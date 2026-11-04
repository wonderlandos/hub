# legal

The agreements and policies of WolOS Hub (hub.wolos.org). English is the original; translations come later through the l10n process.

**Review note:** reviewed by the operator; legal counsel review recommended before relying on it in a dispute.

## Versions

Version 1 of every text. The effective date is set when the texts go live: replace `[effective date]` in each file (and in this table), then recompute the hashes, because the hub records the SHA-256 of the exact bytes it serves with every acceptance.

| File | Route | Title | Version | Effective | Words | SHA-256 | How it binds |
|---|---|---|---|---|---|---|---|
| `CLA.md` | /terms/cla | Contributor Licence Agreement | 1 | [effective date] | 1137 | `b1cb352ab8f26a59d72da322899c901e2b93711cb1deccf24017e0a4846d867c` | accepted at first sign-in (and by an owner for an organisation) |
| `TERMS-OF-USE.md` | /terms/usage | Terms of Use | 1 | [effective date] | 3317 | `c5d6f8d8a494259a6e005e971630890015d502c2d4c2eea47c8bef9159239f9d` | accepted at first sign-in |
| `PRIVACY.md` | /terms/privacy | Privacy Policy | 1 | [effective date] | 3182 | `81c0d120d4e394ef455f9a33c7d702bfae70d2ff13e336d25474dba798ac9b89` | notice, not accepted |
| `COOKIES.md` | /terms/cookies | Cookie Notice | 1 | [effective date] | 447 | `ced39e68bc5a5826ff8a4fa62d683db1e73404036f3017f6d8d75d7b908f99f5` | notice, not accepted |
| `PUBLISHER-AGREEMENT.md` | /terms/publisher | Publisher Agreement | 1 | [effective date] | 1674 | `ed27afdb0c4bc6017c562fc42d4aa51cd5b6f2e8e50f75f48e121db9ad997274` | accepted before the first publish |
| `TRUST-TERMS.md` | /terms/trust | Trust Terms | 1 | [effective date] | 911 | `3a4f978bd2e5453e29e4e814cecb7f19e93a06edf10971a3caaedf78c4a4ed18` | accepted with every certificate request |
| `CERTIFICATE-TERMS.md` | /terms/certificates | Certificate Terms | 1 | [effective date] | 1497 | `6254a7f980c60b592c19fa7c888622a50d3c211a05a4802549a527d11ab79f47` | accepted with every certificate request, through the Trust Terms |
| `HUB-POLICIES.md` | /terms/policies | Hub Policies | 1 | [effective date] | 1665 | `68161f163071ef8c8c889749f89968563e1ad8a39d670e359329d658cb259c88` | part of the Terms of Use and the Publisher Agreement |
| `DMCA-AND-NOTICES.md` | /terms/notices | Notices and Takedown | 1 | [effective date] | 1574 | `ed76c212e3b48211484fa9c208ec2c973b52ff40b448254077d5b32027160679` | part of the Terms of Use |
| `SECURITY-POLICY.md` | /terms/disclosure | Disclosure Policy | 1 | [effective date] | 822 | `f5a1391301079facec488cdb56125b8087ebaee56ad287bdfb4e29d544768050` | part of the Terms of Use |
| `TRADEMARK.md` | /terms/trademark | Trade Mark Policy | 1 | [effective date] | 772 | `2e3ab5094818579a17c1faeb1edf660bbbec27725eab306d1a092735ea06d67c` | part of the Terms of Use |
| `CHANGES-LOG.md` | /terms/changes | Changes Log | 1 | [effective date] | 604 | `b812b603e280eeaf6ec4259321ca2f684212e2243dfc0e0d7755af96af5e8f4c` | part of the Terms of Use |

`RESEARCH.md` is internal: the sources, the duty table and the style sheet behind these texts. It is not served and has no route.

## File format

Each text starts with front matter (`title`, `version`, `effective`), then the `# Title`, then the line `Version N, effective [effective date].` (the Worker reads the version from that line), then an "In short" box that is marked as not binding, then numbered sections. Definitions live in one place: section 2 of the Terms of Use.

## Changing a text

1. Edit the file, raise its version on both the front matter and the `Version` line, and set the new effective date.
2. Add an entry to section 4 of `CHANGES-LOG.md`.
3. Recompute the SHA-256 in the table above (`sha256sum *.md`).
4. Announce changes that matter to people 30 days ahead, as `CHANGES-LOG.md` section 2 says.
