---
title: Hub Policies
version: 1
effective: [effective date]
---

# Hub Policies

Version 1, effective [effective date].

> **In short (not the binding text; the numbered sections below are):**
> The hub is slow on purpose. A stranger's first app waits a week; updates wait three days. Bad actors hate calendars.
> No code at install, no network at install, no files outside your own folders. No exceptions.
> Your name lives in your namespace. Look-alikes of someone else's name wait for a person, and usually lose.
> Report malware and a person looks within 24 hours, often within 4. Other reports within 3 to 7 days.
> Every decision comes with a reason, and you can ask a different person to look again.

## 1. What this page is

1.1. These are the rules for listings, names, waiting times, reports and appeals on WolOS Hub. They are part of the [Terms of Use](/terms/usage) and the [Publisher Agreement](/terms/publisher). The definitions in section 2 of the Terms of Use apply.

1.2. The numbers here are the rules today. We change them only by a new version of this page, listed in the [Changes Log](/terms/changes).

## 2. What may be listed

2.1. The hub lists apps, plugins and extensions for WolOS, published by their makers or with their makers' permission.

2.2. **Hard rules for every Release.** The hub does not list a Release that:
1. runs code, or reaches the network, while it is installed;
2. puts files outside the package's own folders, or carries setuid files, device files, hidden names or duplicate paths;
3. is larger than the limits: an app 1 GiB; a plugin 2 MiB, with at most 256 files of 256 KiB each;
4. replaces a file already published under the same version, or has a lower version than one already listed;
5. lacks an id, a name, a version or a licence;
6. is not a GitHub release on a tag of the linked repository, whose commit is on the repository's default branch;
7. fails the signature or Certificate checks;
8. is found to contain malware.

2.3. **Flags.** A Release that asks for new permissions, adds an install script, grows a lot in size, changes owner, key or kind, or carries its own script runtime, is listed with a flag that people see, and, at the Trusted level, waits for a reviewer.

2.4. **Content rules.** Listing text, icons, screenshots and release notes:
- describe the Work honestly and in the present;
- follow the Wonderland Doctrine;
- contain no sexual content, no gore, and nothing that targets people;
- contain no advertising for other things, no keyword stuffing, no fake reviews or ratings;
- use no WolOS mark in a way the [Trade Mark Policy](/terms/trademark) does not allow.

## 3. What is not allowed

In addition to section 7 of the Terms of Use:
1. Malware, spyware, stalkerware, ransomware, credential stealers, hidden miners, and tools whose main purpose is to harm others' machines or accounts.
2. Work that collects personal data without saying so, or sends it somewhere the listing does not say.
3. Work that tricks people: fake system dialogs, fake updates, fake "cleaners", deceptive buttons or settings.
4. Copies of someone else's Work published without permission, or with its author's name removed.
5. Work that infringes copyright, trade marks or other rights, or helps others do so as its main purpose.
6. Content that is illegal in Brazil or where the hub is offered: content that sexualises minors, incites violence, terror, or crimes against people for who they are, or invades someone's privacy.
7. Look-alikes and impersonation (section 4).
8. Spam: many near-identical listings, listings that only link elsewhere, or names held with nothing behind them.
9. Selling, renting or transferring namespaces, listings, accounts or Certificates.
10. Anything else the Doctrine does not allow.

## 4. Names and look-alikes

4.1. **Namespaces.** Each Work's id lives in its publisher's namespace (for example `alice.notes` for the account `alice`), and the hub always shows the publisher's GitHub login next to the name.

4.2. **Form.** Ids use lower-case ASCII letters, digits, dots and dashes. Display names have at most 40 characters. Mixed scripts and characters that look like others are refused.

4.3. **Reserved words.** These cannot be used as an id or a namespace, or as a display name that suggests WolOS made the Work: wolos, wol, cryswol, rsh, system, store, hub, settings, update, official, verified, trusted, the id of every WolOS system app, and any word that promises software is harmless.

4.4. **Look-alikes.** A name or id that is within two letters of an existing listing's, equal to one after removing dots and dashes, or uses a confusable character, waits for a moderator before it is listed. So does a name that copies a known brand when you are not its owner.

4.5. **Disputes about names.** If you think someone uses your name or mark, see the [Notices and Takedown](/terms/notices) page.

## 5. Accounts, waiting times and limits

5.1. **First listing.** To publish your first listing:
- your GitHub account is at least 90 days old and has two-factor sign-in on;
- the repository is public, at least 30 days old, with at least 5 commits before the first release, its default branch protected against force-push, and its tags protected.

Younger accounts may still sign in, accept the texts and check their files in the browser.

5.2. **Waiting times.**
- A first listing of an account appears 7 days after its first passing check. During that week it is shown only on your own page, with the date it will be listed. A report during that week stops the clock until a moderator looks.
- Later Releases of a listed Origin publisher are visible on the listing at once, and offered as updates 72 hours later. You can install your own Release at once from your page.
- Trusted Releases have no waiting time, because a reviewer read them.

5.3. **Trusted review.** A reviewer reads each Trusted Release before it is listed, with a target of 2 working days. A Release the reviewer cannot finish in 30 minutes is listed at the Origin level, marked as not read by a reviewer, never silently approved. Two reviewers look at a publisher's first Trusted Release and at Releases that widen permissions.

5.4. **Limits.** At most 50 listings per person and 20 Releases per listing owner per day. Rate limits apply to sign-in and to every change; going over them gives a short wait.

5.5. **Unmaintained.** A listing with no Release for 24 months is marked as unmaintained and leaves the top of search.

5.6. **Changing hands.** A repository that moves to another owner withdraws its listing. A new owner, a new maintainer or a new signing key is a flag, and at the Trusted level waits for a reviewer.

## 6. Reports

6.1. **Who.** Anyone signed in with an account at least 7 days old may report a listing or a Release, up to 5 reports a day. Anyone, signed in or not, may send a legal notice by the [Notices and Takedown](/terms/notices) page.

6.2. **Reasons.** Malware, impersonation, broken, licence, conduct.

6.3. **What happens at once.**
- A malware report from a reporter whose earlier reports held up, or three malware reports from different accounts, hides the listing at once and stops its updates.
- Any other malware report puts the listing "under review": hidden from search, still reachable by its link with a visible line that says it was reported and is being looked at.

6.4. **Response times** (from the report):
- **Malware or an exposed key**: a moderator looks within 4 hours in waking time, at most within 24 hours.
- **Impersonation, licence**: a moderator looks within 3 days.
- **Broken**: a moderator looks within 7 days.
- **Conduct**: a moderator looks within 7 days; threats at once.

A decision to hide or withdraw takes effect in the signed index within about an hour. A revocation for misuse or key exposure is decided by two people on the same day.

6.5. **Privacy of reporters.** We never tell the publisher or the public who reported. The public log records the decision, never the reporter.

6.6. **Bad-faith reports.** We may stop handling reports from someone who often sends reports that are clearly unfounded, after a warning, for a period that fits the case (usually 30 days, longer if it happens again). We look at how many, what share of all their reports, how serious, and the intent we can see.

## 7. Decisions and reasons

7.1. Every action is in the public log, without the reporter's name.

7.2. When we act on your Work or account, we tell you: what we did, for how long and where, the facts, the rule or law, whether it came from a report or our own checks, whether a machine or a person decided, and how to ask us to look again (section 10.4 of the Terms of Use).

7.3. A hidden listing comes back only through a moderator.

## 8. Appeals

8.1. You can ask us to look again at any decision about your Work, your account, your Certificate or your report, within 6 months, free: answer our message, or write to julia@wolos.org.

8.2. A person who did not take the first decision decides, when we have one. We answer within 14 days, with reasons.

8.3. You keep every other way: courts, and, in the EU, certified out-of-court dispute settlement bodies under the Digital Services Act.

## 9. Repeat breaches

9.1. We suspend, for a period that fits the case and after a warning, accounts that often publish content that is clearly illegal or clearly against these policies. Malware and threats end access at once, without a warning.

9.2. We close the hub accounts of people who infringe copyright again and again, as the [Notices and Takedown](/terms/notices) page says.

## 10. Contact

Reports: the report button on each listing. Legal notices: [Notices and Takedown](/terms/notices). Everything else: julia@wolos.org.
