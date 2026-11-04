> Draft for review by a lawyer before launch.

# The WolOS Hub Trust Terms

Version 1, 2026-11-04.

You accept this page with every certificate request you send to the WolOS Hub. It says what a WolOS author certificate means, and what it never means.

## 1. Words used here

"You" is the GitHub account that sends the request, or the organisation an owner sends it for. "We" is the WolOS project, decided by its authority: today Julia Klee as lead, in the future the councils or maintainers the project formally appoints. A "certificate" is a WolOS author certificate, Origin or Trusted, issued by the WolOS Authors CA for keys you made on your own machine.

## 2. What a certificate states

A certificate states what was checked, and only that:

- Identity: the GitHub account or organisation it names, as GitHub showed it to us when we checked. A Trusted certificate also means a hub admin, never you, looked at that identity and verified it.
- Repository: a file signed with it says which repository and version it was built from, and that the repository belongs to that account or organisation.
- Each version: every version listed on the hub went through the hub's automatic checks, and their result is public.

A certificate never guarantees the software. It does not say a program is free of faults, does what it claims, or is fit for any purpose. We call such files "checked" and their authors "verified identity", nothing more.

## 3. What you are responsible for

- Your code, every version you sign, and what it does on people's machines.
- Your keys. They are made on your machine and never sent to us; we never ask for them. Keep them where only you can reach them. If you lose them, or anyone else may have them, tell us at once, so we can revoke the certificate.
- Signing only your own work, from the repositories the certificate allows.

## 4. What we may do

We may revoke or withdraw any certificate, or any version signed with it, at any time and without notice: when we suspect the keys or the account are compromised, when the certificate is misused, when you break these terms, the Publisher Agreement or the Doctrine, or when you ask. A revocation is published in the signed revocation list, and WolOS machines then treat the files as the revocation's reason says.

## 5. No warranty, limited liability

Certificates, the revocation list and the hub are offered as they are, with no warranty of any kind. To the extent the law allows, we are not liable for any loss that comes from a certificate, from software signed with it, or from its revocation or withdrawal.

## 6. Changes, disputes and contact

We change this page only by a new version; you see the new text with your next request. Disputes, takedowns and lost keys: julia@wolos.org.

This page is read and applied by the project's authority. Each version is a commit in the hub's repository, and the hub shows the hash of the exact text you accept.

Governing law: [to be set by the lawyer].
