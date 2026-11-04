---
title: Certificate Terms
version: 1
effective: 2026-11-04
---

# Certificate Terms

Version 1, effective 2026-11-04.

> **In short (not the binding text; the numbered sections below are):**
> A certificate says who you are and which repositories you sign. It says nothing about whether your code is any good.
> A certificate is a licence we give you: to use the WolOS Authors certificate and its signature lines. Free, personal, not transferable, revocable at our call. It is never a licence over your code.
> Why a licence? One that we give and may take back holds in every country. It does not hang on local rules about your code, consumer contracts or platform liability.
> Origin is automatic if you meet the rules. Trusted needs people, a review of every release, and an incident contact that answers.
> Your keys never leave your machine. Lose one, or think someone has it? Tell us within 24 hours.
> We can revoke, downgrade, suspend or withdraw any certificate, any time, with or without notice, at our call. We owe you nothing for it. Your files then stop counting, as the reason says.
> If we think our own keys leaked, every certificate can go at once. You then ask for a new one.
> A certificate says who you are. Checked never means harmless, and your certificate never says so either.
> If your code hurts someone and they come after us, that one is on you: you defend us and pay for it.

## 1. What this programme is

1.1. The WolOS author certificate programme lets publishers sign their Work so that WolOS can prove who published a file and from which repository. These terms are between you, as holder or applicant, and Júlia Klee, the operator of WolOS Hub ("we"). The definitions in section 2 of the [Terms of Use](/terms/usage) apply.

1.2. You accept these terms, with the [Trust Terms](/terms/trust), with every certificate request. The hub records the version, the SHA-256 hash of the exact text and the time. The [Publisher Agreement](/terms/publisher) also applies to you.

1.3. **A Certificate is a licence.** Each Certificate, and the signature lines that WolOS and the hub show for a file signed with it (who signed it, from which repository, at which level), belong to the WolOS Authors certificate authority. Issuing a Certificate grants you a licence to use it, and to have those lines shown for your files. The licence is:
- non-exclusive;
- free;
- personal to you, and to the organisation it names;
- not transferable: you may not sell, lend, sublicense or pass it on;
- revocable at our sole discretion, at any time, with or without cause, and with or without notice, where the law allows (section 6).

All rights in the certificate authority, its keys, its Certificates and the signature lines are reserved.

1.4. You must be 16 or older and not barred by section 21.9 (export control and sanctions) of the Terms of Use.

1.5. **Never a licence over your code.** The Certificate is a licence over what is ours. It gives us no right in your code, and it does not change, add to or replace your Work's own licence, which stays yours. What we may do with your files to check, hash and sign them is in section 5 of the [Publisher Agreement](/terms/publisher).

1.6. **Why a licence.** We use this shape on purpose. A licence that we grant, and may revoke, rests only on our own rights in the certificate authority. That makes it enforceable in every jurisdiction, without depending on local rules about your code, consumer contracts or platform liability. The protections that the law gives you and that sections 6.5 and 7.2 keep still apply.

1.7. **When we revoke it.** The licence ends, and your files count or stop counting as section 5 says for the reason given. To the extent the law allows, we owe you nothing for a revocation, a downgrade or a suspension (section 7.2).

## 2. Who can get which level

2.1. **Origin.** The hub issues an Origin Certificate automatically, with no person involved, when every rule holds at the time of the request:
- you accepted the current Contributor Licence Agreement, Publisher Agreement, Trust Terms and these terms;
- two-factor sign-in is on for your GitHub account;
- your GitHub account is at least 30 days old;
- you have no open or refused request for the same subject;
- no Certificate of yours or of the subject was revoked for cause before;
- the subject made no other Origin request in the last 7 days, and you made no more than 3 requests today.

If a request fails a rule, the hub refuses it and stores nothing but the record of the refusal. If you had a refused request or a revocation for cause before, a person looks at your request instead.

2.2. **Trusted.** A Trusted Certificate needs:
- a live Origin Certificate for the same subject;
- that the subject is an organisation (a company, a foundation, or a project with a public governance page) or a person whose public work our reviewers can name, with a public page that shows it;
- approval by two of our reviewers, never including you;
- an incident contact: an email address that answers, and a second person;
- that each Release is built by one registered workflow on one protected branch of the repository, with build provenance, and that published releases cannot be changed;
- that you accept a review of every Release before it is listed.

2.3. A Trusted Certificate lasts one year and is renewed only by the same approval.

2.4. We may refuse any request, at either level, at our sole discretion, with or without giving a reason, where the law allows. Meeting the rules does not entitle you to a Certificate.

## 3. What we verify, and what we do not

3.1. **We verify:**
- for Origin: the rules in 2.1, as GitHub reports them to us at the time;
- that you control the GitHub account or organisation the Certificate names, and the repositories it covers;
- that you hold the private key that matches the public key you sent, by a signature;
- for Trusted: the identity and public work in 2.2, by a person; the incident contact, at approval and every 6 months.

3.2. **We do not verify:**
- your legal name or papers, unless you give them for Trusted;
- what your code does, beyond the hub's automatic checks and, for Trusted, a reviewer's reading of each Release;
- that your Work is lawful, harmless, without faults or fit for any purpose.

3.3. A Certificate states only what section 4 of the [Trust Terms](/terms/trust) says.

## 4. Your duties

4.1. **Keys.** You make your keys on your own machine. Never send a private key to us; we never ask for it. Keep private keys encrypted with a strong passphrase or in a hardware key. If a build workflow signs, keep the key in a protected secret that only the registered release workflow can read.

4.2. **Accounts.** Keep two-factor sign-in on, for your account and, for organisations, for every member who can publish.

4.3. **Sign only your own Work**, from the repositories and in the namespace your Certificate allows.

4.4. **Incidents within 24 hours.** Tell us within 24 hours of learning that a private key, a GitHub account, an organisation, a repository or a build workflow may be in someone else's hands, or that a signed Release contains harmful code. Write to julia@wolos.org with "incident" in the subject, and include what happened, since when, and which Releases may be affected. Ask us to revoke at once when in doubt.

4.5. **Trusted holders** also keep the incident contact answering. A contact that does not answer within 14 days drops the Certificate to the Origin level.

4.6. **Cooperation.** You cooperate with us, and, as far as the law allows you, with authorities, in any investigation of harm done through a file signed with your Certificate. You keep the logs of your release builds for at least 12 months.

4.7. You tell us when the facts we verified change: a new owner, a new organisation, a lost domain, or a public page that is gone.

## 5. What revocation does to your files

5.1. A revocation is published in the signed revocation list. WolOS machines act on it the next time they check it.

5.2. By reason:
- **Key exposed** or **misused**: WolOS no longer accepts any file signed with that Certificate, including files from before the revocation.
- **Replaced** or **stopped publishing**: files the signed index saw before the revocation still count; new ones do not.
- **Downgrade** from Trusted to Origin: your files stay valid at the Origin level.
- **Version withdrawn**: that version is no longer offered, and WolOS tells people who have it.

5.3. Revoking an Origin Certificate also revokes the Trusted Certificate built on it.

## 6. Our right to revoke, downgrade or withdraw

6.1. **At our sole discretion, at any time, with or without cause, and with or without notice, where the law allows**, we may revoke, downgrade, suspend, refuse to renew or withdraw any Certificate, and with it the licence in section 1.3, or any Release signed with it. Our usual grounds are that we think:
- a key, account, organisation, repository or build may be compromised;
- the Certificate was misused, or used outside its repositories or namespace;
- you broke these terms, the Trust Terms, the Publisher Agreement, the Terms of Use or the Doctrine;
- a fact we verified is no longer true;
- the law, a court or an authority requires it, or a valid notice says so;
- you asked us to.

6.2. Revocation for misuse needs two of our people. A key-exposure revocation starts at once.

6.3. We may act on a reasonable suspicion, and we cooperate with authorities (Terms of Use, sections 10.6 and 10.7).

6.4. **Emergency revocation of our own keys.** If we think a key of the hub or of a WolOS certificate authority may be in someone else's hands, we may revoke it and, with it, every Certificate and signature that depends on it, yours included, at once. Files signed under those Certificates may stop counting until you get a new Certificate and sign again. We announce it on the hub and in the public log.

6.5. We tell you what we did and why, as section 10.4 of the Terms of Use says. You can ask us to look again (section 11 of the Terms of Use), but a revocation already published stays in the list; if we were wrong, we issue a new Certificate.

## 7. No guarantee to users

7.1. **A Certificate is not a promise to anyone that software is harmless, lawful or fit for a purpose. Checked never means harmless.** Each publisher answers for its own Work. You may never say or suggest that your Certificate means more.

7.2. **The certificate programme, the Certificates, the revocation list and the hub come "as is" and "as available", without warranty of any kind. To the extent the law allows, we are not liable to you for any loss from refusing, revoking, downgrading, suspending or withdrawing a Certificate, from an emergency revocation of our own keys, or from files that stop counting.** Sections 14 and 15 of the Terms of Use apply, with their protections for consumers.

## 8. Your responsibility for damage

8.1. You are responsible for every file signed with your Certificate, unless it was signed by someone who took your key without your fault and you told us within 24 hours of learning of it.

8.2. **If anyone brings a claim against us, or against our moderators or reviewers, because of your code, your data, a file signed with your Certificate, your conduct, or your breach of these terms, you defend us at your cost and pay our reasonable costs, losses, damages, settlements and legal fees from it.** Sections 9.2 to 9.4 of the [Publisher Agreement](/terms/publisher) and section 16 of the Terms of Use say how, including the limits for consumers.

## 9. Ending

9.1. You can ask us at any time to revoke your Certificate as "stopped publishing".

9.2. Sections 1.3, 1.5, 1.7, 4.6, 5, 6.4, 7, 8 and 10 continue after a Certificate ends, with section 17.4 of the Terms of Use.

## 10. Changes, law and contact

10.1. We change these terms only by a new version, listed in the [Changes Log](/terms/changes). A new version applies from your next request or renewal.

10.2. Section 18 (law and courts, including individual claims only where enforceable) and section 21 (general: severability, no waiver, assignment by us, entire agreement, events beyond our control, export control) of the Terms of Use apply.

10.3. Incidents, revocations, notices and disputes: julia@wolos.org, our designated contact.
