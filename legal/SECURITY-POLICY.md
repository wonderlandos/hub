---
title: Disclosure Policy
version: 1
effective: [effective date]
---

# Disclosure Policy

Version 1, effective [effective date].

> **In short (not the binding text; the numbered sections below are):**
> Found a hole in the hub, in WolOS or in the way we sign things? Tell us first, privately: security@wolos.org.
> We answer within 2 working days, fix it in the open, and name you if you want.
> Test in good faith, touch only your own data, stop when you find something. Do that and we will not come after you.
> No bounty. We are a small project; we pay in thanks and credit.
> Bugs in someone else's app go to its publisher, or to the report button.

## 1. What this page is

1.1. This page says how to tell us about a weakness in WolOS or WolOS Hub, and what we promise in return. It is part of the [Terms of Use](/terms/usage); the definitions in its section 2 apply.

1.2. It is our policy for coordinated disclosure: you tell us first, we fix, then we publish together.

## 2. What is covered

- WolOS Hub at hub.wolos.org: its pages, its programming interface, sign-in, the admin panel, the automatic checks, the signed index, the revocation list and the public log.
- The certificate programme and the code that checks signatures and certificates.
- WolOS itself: the operating system, its packages, its update and install tools, and the site wolos.org.
- The source code of all of these in the WolOS repositories.

## 3. What is not covered

- Work published by others on the hub. Tell its publisher, and use the report button on the listing. If the publisher does not answer and people are at risk, write to us.
- The services of our providers (GitHub, Cloudflare). Report to them under their own programmes.
- Floods and denial-of-service tests, spam, social engineering of our people, physical attacks.
- Reports from automated scanners with no shown impact.

## 4. How to report

4.1. Email **security@wolos.org**. If you cannot reach it, use julia@wolos.org with "disclosure" in the subject.

4.2. Tell us: what is affected, the steps to reproduce, what an attacker could do, and how to reach you. A short proof is enough; do not send data that belongs to others.

4.3. You may write in English or Portuguese. If you want to encrypt, ask us for a key in your first message.

## 5. What we promise

5.1. We confirm receipt and give a first answer **within 2 working days**.

5.2. We keep you informed while we work on it, at least every 14 days.

5.3. We fix in the open. For problems that put people at risk, we may revoke keys, withdraw Releases or pause features at once.

5.4. We agree a disclosure date with you. By default, details are published when a fix is out, or after 90 days, whichever comes first. We may ask for more time for a hard problem, and we may publish sooner if attackers already use it.

5.5. If you wish, we name you in the advisory and in the release notes. If you prefer, you stay anonymous.

5.6. **No bounty.** We do not pay for reports, and nothing on this page promises payment.

## 6. Good-faith research

6.1. Research is in good faith when you:
- test only against your own accounts, organisations and data, or test copies you run yourself;
- do not access, change, keep or share other people's data; if you reach it by accident, stop, tell us, and delete what you have;
- do not degrade the hub for others, and stop at the first proof;
- do not publish Releases or sign files that could reach other people's machines;
- tell us before anyone else, and give us reasonable time to fix;
- follow the law that applies to you, apart from what this page allows.

6.2. **Our promise to good-faith researchers:** as far as the law lets us, we consider your research authorised, we will not take legal action against you for it, and we will not report it to the police or ask anyone to do so. If someone else takes action against you for research that followed this page, we will say publicly that you acted in good faith and within our rules.

6.3. We cannot give permission for systems we do not control, such as GitHub's or Cloudflare's, nor stop a public prosecutor or a third party acting on its own.

6.4. If you are unsure whether something is allowed, ask us first.

## 7. Our own disclosures

We publish advisories for fixed problems in WolOS and the hub, with what was affected, what to do, and credit. We follow the reporting duties that apply to us by law.

## 8. Changes and contact

We change this page only by a new version, listed in the [Changes Log](/terms/changes). Contact: security@wolos.org.
