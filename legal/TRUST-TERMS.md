---
title: Trust Terms
version: 1
effective: [effective date]
---

# Trust Terms

Version 1, effective [effective date].

> **In short (not the binding text; the numbered sections below are):**
> "Checked" means a machine looked at that exact file and wrote down what it found. Not more.
> "Origin" means we know who published it and from which repository. "Trusted" means people vetted the publisher and a reviewer read each release.
> None of this means "harmless". We look at what a release declares and what changed. We do not run it for you.
> A revoked certificate or a withdrawn version shows up on every WolOS machine that checks the list.
> If you ask for a certificate, you accept this page and the Certificate Terms each time.

## 1. What this page is

1.1. This page explains what each trust label on WolOS Hub and in WolOS means, and what it never means. It is part of the [Terms of Use](/terms/usage), whose definitions (section 2) apply here.

1.2. Every certificate request includes acceptance of this page and of the [Certificate Terms](/terms/certificates), in their current versions. The hub records the version, the SHA-256 hash of the exact text and the time with each request.

## 2. What "checked" means

2.1. Before a Release is listed, the hub downloads that exact file, computes its hash and runs automatic checks on it: format and size, the manifest and what it asks for, files outside the package's own folders, code that would run at install, known malware patterns, the signature and the certificate, and what changed since the previous version.

2.2. The result is one of:
- **Nothing to report**: the checks found nothing that needs your attention.
- **Things to look at**: the checks found something you should read before installing, shown with the Release.
- **Not listed**: the checks found something the hub does not accept.
- **Not checked**: the hub could not check this file; WolOS shows it as such.

2.3. The result is public, with the date of the check and the file's hash. Anyone can verify the hub's signed statement about it offline.

2.4. **Checked is not a guarantee.** Automatic checks find known patterns and rule breaks. They do not prove that software is harmless, does what it says, has no faults, or is legal where you are.

## 3. The levels

3.1. **Made by WolOS**: software the WolOS project makes and signs itself.

3.2. **Trusted**: the publisher holds a Trusted Certificate. People on our side checked the publisher's identity (an organisation or a person whose public work they can name), and a reviewer read each Release before it was listed: the findings, what changed in the manifest and the file list, and the source tag. A Trusted Release that a reviewer has not read is shown at the Origin level until it is read.

3.3. **Origin**: the publisher holds an Origin Certificate, given automatically when the rules in the Certificate Terms are met. It proves which GitHub account or organisation published the file and from which repository. **Nobody at WolOS reviewed what it does.**

3.4. **Community**: the file has no WolOS author Certificate. The hub still checks it. WolOS asks you before installing it.

3.5. **Legacy**: the file is signed with an earlier WolOS key that had no Certificate.

3.6. **Withdrawn**: the publisher's Trusted status, or that version, was withdrawn. The label says which.

3.7. **Invalid**: the signature, the Certificate or the hash does not check out. WolOS does not install it.

## 4. What a Certificate states

4.1. **Identity**: the GitHub account or organisation it names, as GitHub showed it to us when we checked. For a Trusted Certificate, a person on our side, never the holder, verified that identity.

4.2. **Repository**: a file signed with it names the repository and version it was built from, and that repository belongs to that account or organisation.

4.3. **Namespace**: the ids the holder may sign. A file outside them is shown as invalid.

4.4. A Certificate is about the publisher, not about any file. It never states that software is harmless or fit for a purpose.

## 5. Revocation and withdrawal

5.1. We publish revoked Certificates and withdrawn Releases in the signed revocation list. WolOS machines read it and act on it the next time they check it, online or from a copy.

5.2. What a revocation means for files:
- **Key exposed**: WolOS no longer accepts files signed with that Certificate.
- **Misused**: WolOS no longer accepts files signed with that Certificate.
- **Replaced or stopped publishing**: files the signed index saw before the revocation still count; new ones do not.
- **Trusted status withdrawn**: the publisher drops to the Origin level; who published the file is still proven.
- **Version withdrawn**: that version is no longer offered, and WolOS tells people who have it.

5.3. We may revoke or withdraw at any time, as the [Certificate Terms](/terms/certificates) say.

## 6. No guarantee

6.1. **The checks, the labels, the Certificates, the index and the revocation list are given as they are, without any warranty, to the extent the law allows.** Sections 14 and 15 of the Terms of Use apply, with their protections for consumers.

6.2. **We are not the maker, seller or supplier of any Work published by others.** Its publisher answers for it.

## 7. Changes and contact

We change this page only by a new version, as the [Changes Log](/terms/changes) says. Questions: julia@wolos.org.
