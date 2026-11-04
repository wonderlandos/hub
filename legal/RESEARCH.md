# Legal research for the WolOS Hub texts (internal, not published)

Prepared 2026-11-04 for the lead's order of 03:10Z, 03:12Z, 03:13Z and 03:14Z. This file is the working basis of every text in `legal/`. It is not a legal opinion. It is not served by the hub and is not linked from any page.

Status marks used below:
- **[fetched]**: the primary text was downloaded on 2026-11-04 and the passage relied on was read in it.
- **[mirror]**: the official site refused automated access from the build box (EUR-Lex answers with a bot challenge, Planalto resets the connection, California's leginfo answers 403), so the final text was read on a public mirror of the official text. The article numbers are the official ones; check the wording against the official site before relying on it in a dispute.
- **[known]**: not fetched today; stated from prior knowledge of the text. Verify before relying on it.

## 1. What the hub is, in legal terms

- An **intermediary service** that stores information provided by its users (listing names, summaries, release notes, reports, certificate requests) and shows part of it to the public: a **hosting service** and, because it shows that information to the public at a user's request, an **online platform** under the DSA (Reg. 2022/2065, art. 3(g)(iii) and 3(i)) [mirror].
- It does **not** host the software files. Files stay on the publishers' own GitHub releases; the hub stores their hash, metadata and its check results. For copyright, this is closest to an **information location tool** (17 U.S.C. 512(d)) for the files and **storage at the direction of a user** (512(c)) for the listing text [fetched].
- It has **no payments** and no contracts of sale between publishers and users. So the DSA rules for marketplaces (art. 30-32, traceability of traders) do not bite, and the hub is not a "distributor" that sells anything [mirror].
- The operator is a **natural person** (Júlia Klee) in Brazil, running the hub without charge and without advertising. This matters for: CCPA "business" (needs a for-profit entity and thresholds), Marco Civil art. 15 (only legal persons acting for profit must keep access logs), CRA "open-source software steward" (must be a legal person), DSA art. 19 (micro and small enterprises are exempt from most platform duties), ANPD Resolution 2/2022 (small processing agents).

## 2. Sources (all accessed 2026-11-04)

### European Union
| # | Source | URL | Mark |
|---|---|---|---|
| E1 | GDPR, Reg. (EU) 2016/679, arts. 3, 6, 7, 8, 12, 13, 15-18, 20-22, 27, 28, 33, 34, 37, 44-46, 49 | https://gdpr-info.eu/art-6-gdpr/ (one page per article; official text at https://eur-lex.europa.eu/eli/reg/2016/679/oj) | mirror |
| E2 | Digital Services Act, Reg. (EU) 2022/2065, arts. 3, 6, 11-14, 16-24, 30 | https://www.eu-digital-services-act.com/Digital_Services_Act_Article_16.html (official: https://eur-lex.europa.eu/eli/reg/2022/2065/oj) | mirror |
| E3 | Cyber Resilience Act, Reg. (EU) 2024/2847, arts. 3, 13, 24, 64 | https://www.european-cyber-resilience-act.com/Cyber_Resilience_Act_Article_24.html (official: https://eur-lex.europa.eu/eli/reg/2024/2847/oj) | mirror |
| E4 | Product Liability Directive (EU) 2024/2853, arts. 2(2), 4(1), 8, 11, 17 | https://eur-lex.europa.eu/eli/dir/2024/2853/oj | known (EUR-Lex challenge) |
| E5 | ePrivacy Directive 2002/58/EC art. 5(3) as amended by 2009/136/EC | https://eur-lex.europa.eu/eli/dir/2002/58/oj | known (EUR-Lex challenge) |
| E6 | EDPB Guidelines 05/2020 on consent | https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-052020-consent-under-regulation-2016679_en | fetched (landing page) |
| E7 | Article 29 WP / EDPB Guidelines on transparency (WP260 rev.01) | https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/transparency_en | fetched (landing page) |
| E8 | Rome I Reg. 593/2008 art. 6; Brussels Ia Reg. 1215/2012 arts. 17-19; Unfair Terms Directive 93/13/EEC | eur-lex | known |

### Brazil
| # | Source | URL | Mark |
|---|---|---|---|
| B1 | LGPD, Lei 13.709/2018, arts. 7, 11, 14, 18, 19, 33, 41, 46, 48 (original publication) | https://www2.camara.leg.br/legin/fed/lei/2018/lei-13709-14-agosto-2018-787077-publicacaooriginal-156212-pl.html | fetched (original text; later amendments by Lei 13.853/2019 known, not fetched) |
| B2 | Marco Civil da Internet, Lei 12.965/2014, arts. 15, 19, 20, 21 | https://www2.camara.leg.br/legin/fed/lei/2014/lei-12965-23-abril-2014-778630-publicacaooriginal-143980-pl.html | fetched |
| B3 | STF, Temas 533 and 987 (judgment of 26 June 2025): art. 19 partly unconstitutional; liability after extrajudicial notice for clearly illegal content, court order still needed for crimes against honour | stf.jus.br | known |
| B4 | Código de Defesa do Consumidor, Lei 8.078/1990, arts. 6, 25, 51, 101 | https://www2.camara.leg.br/legin/fed/lei/1990/lei-8078-11-setembro-1990-365086-publicacaooriginal-1-pl.html | fetched |
| B5 | Decreto 8.771/2016 (rules of the Marco Civil, data records and protection standards, art. 13) | planalto.gov.br | known (not reachable) |
| B6 | ANPD Resolution CD/ANPD 2/2022 (small processing agents): art. 11 (no duty to appoint an encarregado, but a channel), art. 14 (double deadlines) | https://www.gov.br/anpd/pt-br/documentos-e-publicacoes/regulamentacoes-da-anpd/resolucao-cd-anpd-no-2-de-27-de-janeiro-de-2022 | fetched |
| B7 | ANPD Resolution 15/2024 (incident reporting: 3 working days), 18/2024 (encarregado), 19/2024 (international transfers, standard clauses) | gov.br/anpd | known (pages moved, 404) |
| B8 | Lei 9.610/1998 (copyright) art. 27 (moral rights inalienable and cannot be waived), arts. 24 | planalto.gov.br | known |

### United States
| # | Source | URL | Mark |
|---|---|---|---|
| U1 | 17 U.S.C. 512 (DMCA): (c)(2) agent, (c)(3) notice, (d) location tools, (f) misrepresentation, (g) counter-notice and 10-14 business days, (i) repeat infringers | https://www.law.cornell.edu/uscode/text/17/512 | fetched |
| U2 | U.S. Copyright Office DMCA designated agent directory | https://www.copyright.gov/dmca-directory/ | fetched |
| U3 | 47 U.S.C. 230(c)(1) and (c)(2) | https://www.law.cornell.edu/uscode/text/47/230 | fetched |
| U4 | COPPA Rule, 16 CFR Part 312 (definitions of operator, "directed to children", actual knowledge) | https://www.ecfr.gov/api/renderer/v1/content/enhanced/current/title-16?part=312 | fetched |
| U5 | CCPA as amended by CPRA, Cal. Civ. Code 1798.100-1798.199.100 (CPPA statute PDF): 1798.100 (notice at collection), 1798.105 (delete), 1798.106 (correct), 1798.110/115 (know), 1798.120 (opt-out of sale or sharing), 1798.121 (limit sensitive), 1798.125 (no discrimination), 1798.130 (45 days, one extension of 45), 1798.135 (links, opt-out preference signal), 1798.140(d) (who is a "business") | https://cppa.ca.gov/regulations/pdf/ccpa_statute.pdf | fetched |
| U6 | CCPA Regulations, 11 CCR 7000 et seq., incl. 7025 (opt-out preference signals / GPC), 7011 (privacy policy contents), 7012 (notice at collection) | https://www.law.cornell.edu/regulations/california/title-11/division-6/chapter-1 | fetched (index) |
| U7 | California AG CCPA guidance | https://oag.ca.gov/privacy/ccpa | fetched |
| U8 | CalOPPA, Bus. & Prof. Code 22575(b)(5)-(6) (disclose response to Do Not Track) | https://california.public.law/codes/business_and_professions_code_section_22575 | mirror |
| U9 | Shine the Light, Cal. Civ. Code 1798.83 (disclosure of sharing for direct marketing) | https://california.public.law/codes/civil_code_section_1798.83 | mirror |
| U10 | California Age-Appropriate Design Code Act, Civ. Code 1798.99.28-1798.99.40 | https://california.public.law/codes/civil_code_section_1798.99.29 | mirror; enforcement enjoined in NetChoice v. Bonta (N.D. Cal.; 9th Cir. 2024; renewed injunction 2025) [known] |
| U11 | Unfair Competition Law, Bus. & Prof. Code 17200 | https://california.public.law/codes/business_and_professions_code_section_17200 | mirror |
| U12 | Virginia CDPA, Va. Code 59.1-575 to 59.1-585 (scope 59.1-576: 100,000 consumers) | https://law.lis.virginia.gov/vacodefull/title59.1/chapter53/ | fetched |
| U13 | Colorado Privacy Act, C.R.S. 6-1-1301 et seq. and AG rules (universal opt-out) | https://coag.gov/resources/colorado-privacy-act/ | fetched (guidance page) |
| U14 | Connecticut Data Privacy Act, Conn. Gen. Stat. 42-515 et seq. | https://portal.ct.gov/ag/sections/privacy/the-connecticut-data-privacy-act | fetched (guidance page) |
| U15 | Texas Data Privacy and Security Act, Bus. & Com. Code ch. 541 (applies regardless of revenue to non-small businesses; small businesses still may not sell sensitive data without consent) | https://statutes.capitol.texas.gov/Docs/BC/htm/BC.541.htm | fetched (index only) |
| U16 | FTC Act 15 U.S.C. 45; FTC staff report "Bringing Dark Patterns to Light" (Sept 2022); FTC guidance on clear disclosures (".com Disclosures") | ftc.gov | known (ftc.gov URLs answered 404 to the box) |

### Processors and structural templates
| # | Source | URL | Mark |
|---|---|---|---|
| P1 | Cloudflare Customer DPA (EU SCCs under Decision 2021/914; EU-US Data Privacy Framework) | https://www.cloudflare.com/cloudflare-customer-dpa/ | fetched |
| P2 | GitHub General Privacy Statement (effective 27 April 2026; DPF participation) | https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement | fetched |
| P3 | GitHub Data Protection Agreement | https://docs.github.com/en/site-policy/privacy-policies/github-data-protection-agreement | fetched (page shell) |
| P4 | GitHub Marketplace Developer Agreement (structure only; no text copied) | https://docs.github.com/en/site-policy/github-terms/github-marketplace-developer-agreement | fetched |
| P5 | Large app stores' developer agreements (structure: definitions, programme requirements, review, takedown, indemnity, termination, law) | vendor sites | known; structure only |

## 3. Findings that shape the texts

1. **GDPR applies by art. 3(2)(a)**: the hub offers a service to people in the EU. A non-EU controller must name an EU representative (art. 27(1)) unless processing is occasional, not large scale and has no special categories (art. 27(2)(a)). The hub's processing is continuous, so the exemption is arguable at best. **Open point for the lead (see section 6).**
2. **Legal bases.** No processing relies on consent: contract (GDPR 6(1)(b) / LGPD 7 V), legal obligation (6(1)(c) / 7 II), legitimate interests (6(1)(f) / 7 IX), legal claims (LGPD 7 VI). No special categories (GDPR 9, LGPD 11): the hub asks for none.
3. **Cookie.** One strictly necessary session cookie is exempt from consent under ePrivacy art. 5(3), second sentence [known]. No banner is needed; disclosure is still needed (GDPR 13).
4. **Children.** GDPR art. 8 sets 16 as default for consent-based services; LGPD art. 14 requires parental consent for children (under 12) and best interest for adolescents; COPPA applies to services directed to under-13s or with actual knowledge. A 16+ rule, with deletion on discovery, meets all three. The California AADC is enjoined; we still meet its main ideas (no profiling, no dark patterns, high privacy by default).
5. **Rights deadlines.** GDPR art. 12(3): one month, +2 months for complex cases. LGPD art. 19 II: full statement within 15 days (small agents get double, Res. 2/2022 art. 14, but we promise 15). CCPA 1798.130(a)(2): 45 days, +45 once. The texts promise the strictest: 15 days, extension only where the law of the person allows, and never past that law's limit.
6. **Breach.** GDPR art. 33: authority within 72 hours; art. 34: people without undue delay if high risk. LGPD art. 48 and ANPD Res. 15/2024: authority and people in 3 working days. US states: "without unreasonable delay", California Civ. Code 1798.82 [known]. Texts promise 72 hours to authorities, 3 working days to people, and earlier where a law asks for it.
7. **Encarregado / DPO.** LGPD art. 41 requires one; Res. 2/2022 art. 11 lets small agents offer a channel instead. GDPR art. 37 does not require a DPO here. We name the operator as encarregado anyway (good practice, art. 52 §1 IX).
8. **Transfers.** EU to Brazil (the operator) and to the US (processors): GDPR art. 46(2)(c) standard clauses in the processors' DPAs; art. 45 adequacy for DPF-certified US providers. Brazil out: LGPD art. 33 II(b) standard clauses and art. 33 IX with art. 7 V (needed to perform the service you asked for).
9. **CCPA.** The operator is not a "business" (1798.140(d): a for-profit entity with thresholds). The texts honour the rights anyway, say plainly that nothing is sold or shared (1798.120, 1798.135), that no sensitive personal information is used to infer anything (1798.121), that opt-out preference signals (GPC) are honoured (1798.135(e), 11 CCR 7025), and answer in 45 days at the latest. Shine the Light (1798.83): no sharing for direct marketing, so nothing to disclose; say so. CalOPPA (22575(b)(5)): disclose Do Not Track response; there is no tracking across sites, so the signal changes nothing; say so.
10. **Other US states** (VA 59.1-576, CO, CT, TX): thresholds not met, but all require: privacy notice with categories, purposes, rights, appeal of a refused request, and a universal opt-out signal in CO/CT. The texts include an appeal path for refused privacy requests (VA 59.1-577(C), CO, CT) [fetched VA; others known].
11. **DSA.** As an online platform: art. 11-12 points of contact and language; art. 13 legal representative in the EU (no exemption for small providers) [mirror]; art. 14 terms must describe moderation, tools, automated decisions, complaint handling, in plain language; art. 16 notice-and-action with the four elements and confirmation of receipt; art. 17 statement of reasons for every restriction; art. 18 report suspected crimes that threaten life or safety; art. 20-23 (complaints, out-of-court settlement, trusted flaggers, misuse) do not apply to micro and small enterprises (art. 19), but we provide complaints and the misuse policy as good practice, which also serves 23(4). Art. 24(3) still applies but only on request.
12. **Marco Civil.** Art. 19: civil liability for third-party content only after a specific court order, as limited by STF 2025 (Temas 533/987): for clearly illegal content, liability may follow an extrajudicial notice. Art. 20: tell the user why content was removed, so they can defend themselves. Art. 21: intimate images without consent must come down on notice from the person. Art. 15 log duty does not apply (not a legal person acting for profit), and a court may still order it (art. 15 §1).
13. **DMCA.** The texts name julia@wolos.org as the "designated contact" and do not say an agent is registered, because none is (lead, 03:32Z). Without the registration the 512(c) and 512(d) liability exemption is not available; the hub still acts on notices, and section 230 does not cover copyright (230(e)(2)) [known]. The 512 exemption needs a designated agent registered with the Copyright Office and published on the site (512(c)(2)), a repeat-infringer policy (512(i)(1)(A)), the notice elements (512(c)(3)), and the counter-notice process with restoration in 10-14 business days (512(g)). Brazil's copyright takedown is outside art. 19 (art. 19 §2): ordinary liability rules apply, so we act on notice for copyright too.
14. **Section 230.** Protects us from being treated as publisher of users' content (c)(1) and for good-faith moderation (c)(2); the texts reserve moderation "at our discretion" to keep (c)(2) clean, while DSA art. 14(4) and 17 require diligence and reasons. The texts do both: discretion, plus reasons.
15. **Consumer law.** CDC art. 25 and 51 I void clauses that exclude or reduce the supplier's duty to compensate a consumer; art. 101 I lets a consumer sue at home. Rome I art. 6 keeps the mandatory law of an EU consumer's habitual residence; Brussels Ia art. 18 lets them sue at home. Unfair Terms Directive: terms not individually negotiated must be fair and plain. US: no forced arbitration. Since the lead's defensive order (2026-11-04 03:31Z) the texts carry an individual-claims clause "where enforceable" (TERMS 18.4), with carve-outs for consumers in Brazil and the EU, void-by-statute states (California CLRA, Civ. Code 1751) and public or representative actions; without an arbitration clause the Federal Arbitration Act does not shield it, so it holds only where state law lets a stand-alone waiver stand [known]; severability keeps the rest. Disclaimers must be conspicuous (UCC 2-316 style; FTC clear-disclosure practice) [known]: written in bold plain words.
16. **Free and open-source software.** CRA (2024/2847) covers products made available in the course of a commercial activity; obligations on manufacturers apply from 11 December 2027, reporting under art. 14 from 11 September 2026 (art. 71) [known for dates]. The hub does not place products on the market under its own name; publishers who monetise are manufacturers and must follow the CRA. The operator is a natural person, so not a "steward" (art. 3(14) requires a legal person) [mirror]; we still adopt a disclosure policy in the spirit of art. 24(1). PLD 2024/2853 treats software as a product for products placed on the market after 9 December 2026 and excludes free and open-source software supplied outside a commercial activity (art. 2(2)) [known].
17. **Licence grant.** GPL-2.0-or-later contributions: inbound equals outbound is the simplest fair rule. GPLv2 has no express patent licence; GPLv3 (reachable by "or later") has one (s. 11). "No patent trap" means: the CLA grants no patent licence beyond what the licence of the repository grants.
18. **Moral rights.** Cannot be waived in Brazil (Lei 9.610 art. 27) and most EU states; waivable or absent in the US for software. The CLA asks for a non-assertion only where the law allows it.
19. **Electronic acceptance.** Valid under E-SIGN (15 U.S.C. 7001) [known], eIDAS (simple electronic signature, art. 25) [known], and Brazilian MP 2.200-2/2001 art. 10 §2 [known]. Record: version, SHA-256 of the exact text, time, account. Clickwrap with the text shown before acceptance is the enforceable form in US case law; browsewrap is not [known].
20. **Dark patterns.** FTC 2022 report and CPRA 1798.140(l) and (h): no pre-ticked boxes, no confusing choices, accept and decline equal in weight [known; 1798.140 fetched].

## 3a. California, the strictest US baseline

| Rule | Source | What it asks | Where we meet it |
|---|---|---|---|
| Notice at collection | Civ. Code 1798.100(a)-(b); 11 CCR 7012 | Categories, purposes, whether sold or shared, retention, at or before collection | PRIVACY 3, 4, 5, 11.1 (linked from the sign-in page) |
| Right to know and access | 1798.100, 1798.110, 1798.115 | Categories and specific pieces, sources, purposes, recipients | PRIVACY 8.1, 11.7, 11.9 |
| Right to delete | 1798.105 | Delete, with listed exceptions | PRIVACY 8.1, 5 |
| Right to correct | 1798.106 | Correct inaccurate data | PRIVACY 8.1 |
| Opt-out of sale or sharing; "Do Not Sell or Share My Personal Information" | 1798.120, 1798.135(a) | A link, unless the business does not sell or share and says so | PRIVACY 11.3 (we do not sell or share; statement given) |
| "Limit the Use of My Sensitive Personal Information" | 1798.121, 1798.135(a) | A link, unless sensitive data is only used for allowed purposes | PRIVACY 11.2, 11.3 (none collected) |
| Opt-out preference signals (Global Privacy Control) | 1798.135(b),(e); 11 CCR 7025 | Treat the signal as a valid opt-out | PRIVACY 11.4; COOKIES 4 |
| Response time | 1798.130(a)(2) | 45 days, one 45-day extension with notice | PRIVACY 9.3, 11.7 |
| No discrimination | 1798.125 | No worse treatment for using rights | PRIVACY 8.1 |
| Under-16 opt-in for sale | 1798.120(c) | No sale of under-16 data without opt-in | PRIVACY 11.3, 14 (no sale; 16+) |
| Do Not Track disclosure | Bus. & Prof. Code 22575(b)(5)-(6) [mirror] | Say how the site answers DNT and whether others track | PRIVACY 11.5; COOKIES 4 |
| Shine the Light | Civ. Code 1798.83 [mirror] | Disclose sharing for third parties' direct marketing | PRIVACY 11.6 (none) |
| Age-Appropriate Design Code | Civ. Code 1798.99.28-.40 [mirror]; enjoined (NetChoice v. Bonta) [known] | High privacy by default, no profiling, no dark patterns for children likely to access | TERMS 3 and PRIVACY 14 (16+), PRIVACY 2 (no profiling), CHANGES-LOG 3 (no silent new uses) |
| Unfair Competition Law | Bus. & Prof. Code 17200 [mirror] | No unlawful, unfair or fraudulent practice, no misleading statements | Every text: "checked", never a promise of harmlessness; TRUST 2.4, 6 |

The operator is not a CCPA "business" (1798.140(d)(1): for-profit entity and thresholds). The texts follow the CCPA anyway, as the strictest US model.

## 4. Duty table

| Duty | Source | Our document | Section |
|---|---|---|---|
| Identity and contact of controller | GDPR 13(1)(a); LGPD 9 | PRIVACY | 1 |
| DPO / encarregado contact | GDPR 13(1)(b), 37; LGPD 41; ANPD Res. 2/2022 art. 11 | PRIVACY | 1, 13 |
| Categories of data | GDPR 13-14; CCPA 1798.100(a), 1798.110; VA 59.1-578 | PRIVACY | 3 |
| Purposes and legal bases per purpose | GDPR 6, 13(1)(c); LGPD 7, 9 | PRIVACY | 4 |
| Legitimate interests stated | GDPR 13(1)(d) | PRIVACY | 4 |
| Retention per category | GDPR 13(2)(a); CCPA 1798.100(a)(3) | PRIVACY | 5 |
| Recipients, processors, contracts | GDPR 13(1)(e), 28; LGPD 9 V, 39 | PRIVACY | 6 |
| International transfers and safeguards | GDPR 13(1)(f), 44-46, 49; LGPD 33 | PRIVACY | 7 |
| Rights list and how to use them | GDPR 15-22, 12; LGPD 18; CCPA 1798.105-.125; VA/CO/CT | PRIVACY | 8, 9 |
| Response times | GDPR 12(3); LGPD 19; CCPA 1798.130 | PRIVACY | 9 |
| Appeal of a refused privacy request; complaint to authority | GDPR 13(2)(d), 77; LGPD 18 §1; VA 59.1-577(C) | PRIVACY | 9, 10 |
| Automated decisions | GDPR 13(2)(f), 22; LGPD 20 | PRIVACY | 4; TERMS 9; POLICIES 5 |
| Do not sell or share; limit sensitive; GPC | CCPA 1798.120, .121, .135; 11 CCR 7025 | PRIVACY | 11 |
| Do Not Track disclosure | Cal. B&P 22575(b)(5) | PRIVACY 11; COOKIES 4 |
| Shine the Light | Cal. Civ. 1798.83 | PRIVACY | 11 |
| Cookies | ePrivacy 5(3); GDPR 13 | COOKIES; PRIVACY 12 |
| Children | GDPR 8; LGPD 14; COPPA 16 CFR 312; Cal. AADC | TERMS 3; PRIVACY 14 |
| Protection measures | GDPR 32; LGPD 46; Dec. 8.771 art. 13 | PRIVACY | 15 |
| Breach notification | GDPR 33-34; LGPD 48; ANPD Res. 15/2024; Cal. Civ. 1798.82 | PRIVACY | 16 |
| Terms describe moderation, automated tools, complaints | DSA 14(1) | TERMS 9-11; POLICIES 4-8 |
| Notify significant changes | DSA 14(2); Unfair Terms Dir. | TERMS 19; CHANGES-LOG |
| Diligent, proportionate enforcement | DSA 14(4) | TERMS 10; POLICIES 6 |
| Points of contact, languages | DSA 11-12 | TERMS 20; NOTICES 8 |
| EU legal representative | DSA 13; GDPR 27 | TERMS, PRIVACY, NOTICES | TERMS 20.3; PRIVACY 1.6; NOTICES 2.1 ("to be appointed"; open, section 6) |
| Notice-and-action with elements and receipt | DSA 16 | NOTICES 3 |
| Statement of reasons | DSA 17; Marco Civil 20 | TERMS 10; POLICIES 7; NOTICES 6 |
| Report threats to life | DSA 18 | NOTICES 7 |
| Internal complaints, misuse policy | DSA 20, 23 (good practice under 19) | POLICIES 8-9; NOTICES 6 |
| DMCA agent, notice elements, counter-notice, repeat infringers, misrepresentation | 17 U.S.C. 512(c)(2),(c)(3),(f),(g),(i) | NOTICES 4-5, 9 |
| Marco Civil notice regime; intimate images | MCI 19-21; STF Temas 533/987 | NOTICES 3, 5 |
| Consumer carve-outs on liability and venue | CDC 25, 51, 101; Rome I 6; Brussels Ia 18; 93/13/EEC | TERMS 15-18 |
| Clear, conspicuous disclaimers | FTC Act 5; consumer law | TERMS 14 (bold) |
| Clickwrap acceptance with record | E-SIGN; eIDAS 25; MP 2.200-2 art. 10 §2 | CLA 9; TERMS 4; README |
| Licence grant, originality, employer rights, moral rights | GPL-2.0; Lei 9.610 art. 27 | CLA 3-7 |
| Disclosure policy for weaknesses | CRA 24(1) spirit; good practice | SECURITY-POLICY |
| Publisher legal duties (CRA, PLD, consumer, export) | CRA 13; PLD 2024/2853 | PUBLISHER 4 |
| Trade marks | Lanham Act; Lei 9.279/1996; EUTMR [known] | TRADEMARK |

## 4a. Defensive clauses and the law that bounds them

Added on the lead's order of 2026-11-04 03:31Z ("very defensive for us, with every authority and exemption the law allows") and 03:32Z (no EU representative, no DMCA registration, no postal address). Each row gives where the clause lives, what lets us write it, and the consumer-law limit that keeps it valid. Every limiting clause says "where the law allows" or "to the extent the law allows", and TERMS 15.4 to 15.7, 16.3 and 18.2 carry the carve-outs.

| Clause | Where | Legal basis | Consumer-law limit that bounds it |
|---|---|---|---|
| All rights reserved; only rights stated in words | TERMS 1.4; CLA 7.4; TRUST 6.4; CERT 1.3; TRADEMARK 2 | Lei 9.610/1998 art. 4 and 49 (licences read narrowly) and Lei 9.279/1996; 17 U.S.C. 106; Lanham Act; InfoSoc Dir. 2001/29 [known] | None; the GPL grants of the code stay (TERMS 13.2) |
| Sole discretion to list, delist, suspend, revoke, downgrade, withdraw, change or end, with or without cause or notice | TERMS 5.3, 10.1, 10.8; PUBLISHER 2.3, 7.1; CERT 2.4, 6.1; POLICIES 1.3, 4.6; TRUST 5.3 | 47 U.S.C. 230(c)(2) good-faith moderation; freedom of contract (Código Civil art. 421) [known] | EU: DSA 14(4) diligence, 17 statement of reasons, UCTD Annex 1(g) reasonable notice to end a contract of indefinite duration; BR: Marco Civil art. 20 reasons, CDC 51 IV and XI. TERMS 10.3 keeps ground + reasons, 5.3 keeps 30 days for ending the hub |
| No duty to publish, review, monitor or keep | TERMS 5.4; POLICIES 1.3; CLA 7.1 | DSA art. 8 (no general monitoring); Marco Civil art. 19; 17 U.S.C. 512(m) [known] | Where a law requires keeping (PRIVACY 5) or the texts promise it (public log), that wins |
| Third-party content is the publisher's alone | TERMS 5.5, 14.2; PUBLISHER 5.7; NOTICES 3.5 | DSA art. 6; Marco Civil art. 19; 47 U.S.C. 230(c)(1) | CDC 7 sole paragraph and 25 §1 (joint liability in the supply chain) can still reach us for a consumer; TERMS 15.5 keeps it |
| Intermediary role and voluntary checks keep the exemptions | TERMS 5.6 | DSA art. 4-7 (art. 7 own-initiative investigations); Marco Civil 18-19; 230; 512 | Lost for content we know is clearly illegal and leave up (DSA 6(1)(b); STF Temas 533/987) |
| No warranty of any kind, "as is", "as available"; no warranty from statements | TERMS 14.1 to 14.4; TRUST 6.1, 6.3; CERT 7.2; PUBLISHER 11.1; CLA 7.5 | UCC 2-316 (conspicuous, bold); GPL-2.0 s. 11-12 for code | CDC 24 and 25 (legal warranty cannot be waived), 51 I; EU Dir. 2019/770 (digital services, also where the consumer gives personal data beyond what the service needs, art. 3(1)) [known]; state implied-warranty bars (TERMS 15.7) |
| Indirect loss excluded; listed causes excluded; cap at the lowest amount the law allows, never more than 100 US dollars | TERMS 15.1 to 15.3; PUBLISHER 11.1; CERT 7.2 | Código Civil art. 393 and 402-403 (direct and immediate loss); Cal. Civ. Code 1668 bounds it [known] | Never for intent, gross negligence, fraud, death or injury (TERMS 15.4; Código Civil art. 187 and 927; Cal. 1668); CDC 51 I (only "in justified situations" for a legal person; void for a natural person); UCTD Annex 1(a)-(b) |
| Contractual time limit on claims | not written | Código Civil art. 192: limitation periods cannot be changed by agreement; CDC 26-27 | Omitted on purpose: Brazilian law governs and would void it |
| Indemnity with defence and costs; we may take over the defence; no settlement in our name | TERMS 16; PUBLISHER 9.2 to 9.4; CERT 8.2; TRADEMARK 7.5 | Código Civil art. 186, 927 and 934 (recourse); freedom of contract; US contract law (Cal. Civ. Code 2772-2778 rules of interpretation) [known] | CDC 51 IV and XV (unfair burden on a consumer); UCTD Annex 1; limited for consumers to loss caused by their fault (TERMS 16.3) |
| Individual claims only, where enforceable | TERMS 18.4 | Freedom of contract; enforceable in some US states outside arbitration [known] | BR: CDC 81-104 and Lei 7.347/1985 (collective actions by legitimated entities cannot be waived); EU: Dir. 2020/1828; Cal. Civ. Code 1751 (CLRA rights cannot be waived); public authorities never bound |
| Act on reasonable suspicion | TERMS 10.6; PUBLISHER 7.2; CERT 6.3; SECURITY 6.5 | 230(c)(2); DSA art. 7 | DSA 17 (reasons) and 20 (complaint) still apply; undo on error (TERMS 11.2) |
| Cooperate with authorities, preserve and disclose | TERMS 10.7; PUBLISHER 8.3; NOTICES 8.3; PRIVACY 4, 6.5 | DSA 9, 10, 18; Marco Civil 10 §1 and 22; GDPR 6(1)(c), 6(1)(d), 6(1)(f); LGPD 7 II, VII, IX; 18 U.S.C. 2702(b) and (c) voluntary disclosure in emergencies [known] | GDPR 5(1)(c) minimisation; Marco Civil 10 (court order for content of communications); tell the person unless forbidden |
| Emergency revocation of our own keys and every dependent certificate | TRUST 5.4; CERT 6.4, 7.2 | Freedom of contract; the certificates are ours (CERT 1.3) | Liability limits as above; notice on the hub and public log |
| Hub distribution and Certificates are licences we grant, revocable at sole discretion, never a licence over the publisher's code (lead, 2026-11-04 03:56Z) | PUBLISHER 2.4 to 2.8, 3, 5.6; CERT 1.3, 1.5 to 1.7; TRUST 4.5; POLICIES 1.3; TERMS 2.1, 5.7, 8.3 | The licensor's own rights in the hub, index, signatures and CA (Lei 9.610/1998 art. 49; 17 U.S.C. 106; InfoSoc Dir. 2001/29); revocable gratuitous licence; freedom of contract (Código Civil art. 421) [known] | Same as the discretion row: reasons and appeal (DSA 17, 20; Marco Civil 20) and the consumer carve-outs of TERMS 15.5 to 15.7 stay |
| Survival | TERMS 17.4; CLA 9.3; PUBLISHER 12.4; CERT 9.2 | Contract law | None |
| Severability with the closest valid rule | TERMS 21.1 | Código Civil art. 184 (partial invalidity) | EU: CJEU case law forbids a court from rewriting an unfair term for a consumer (C-618/10 Banco Español) [known]; for EU consumers the unfair part simply falls |
| Entire agreement | TERMS 21.4; CLA 10.2 | Contract law | Never limits liability for fraud; CDC 30 (advertising binds) and 48 still apply |
| Assignment by us without consent | TERMS 21.3; CLA 10.2; TRADEMARK 2 | Código Civil art. 286 (assignment of rights) [known] | UCTD Annex 1(p): may not reduce a consumer's guarantees; we tell them |
| No waiver | TERMS 21.2; TRADEMARK 7.4 | Contract law | None |
| Force majeure | TERMS 21.8; 15.2 | Código Civil art. 393 | Does not cover our own fault; CDC 14 §3 limits excuses for a supplier |
| Export control and sanctions | TERMS 3.4, 21.9; PUBLISHER 4.6; CLA 5.6; CERT 1.4; SECURITY 6.6 | 15 CFR 730-774 (EAR, incl. 734.7 and 742.15(b) for published encryption source); 31 CFR 500-599 (OFAC); Reg. (EU) 2021/821; Lei 9.112/1995 [known] | None for consumers; applies to everyone |
| Age 16+ confirmed at sign-in | TERMS 3.1, 3.4; CLA 8.1; CERT 1.4; SECURITY 6.6; PRIVACY 14 | GDPR 8; LGPD 14; COPPA | Deletion on discovery (PRIVACY 14.2) |
| "Checked never means harmless" | TERMS 6.5; TRUST 2.4; CERT 7.1; POLICIES 1.4; PUBLISHER 4.11; CLA 7.5 | FTC Act 5 and Cal. B&P 17200 (no misleading promise); CDC 37 | It is a statement of fact that narrows what we promise; it cannot exclude CDC liability for a defect of our own service |
| Notices to us only by email to the designated contact; electronic notices to you | TERMS 20.1, 20.5; NOTICES 2.1, 2.3 | DSA 11, 12, 16(1) (electronic means); E-SIGN 7001(c); MP 2.200-2 art. 10 §2 | E-SIGN consumer consent: agreed in TERMS 20.5; court service follows the law of the court |
| EU representative "to be appointed; until then contact the controller directly" | TERMS 20.3; PRIVACY 1.6, 18; NOTICES 2.1; COOKIES 1 | DSA 13 and GDPR 27 require one; the texts do not pretend | Open point 6.1 |
| Address "São Paulo, Brazil, full address on request" | TERMS 20.4; PRIVACY 1.7, 18; NOTICES 2.1 | DSA 13(4) and 512(c)(2) need a full address | Open point 6.3 |
| Limits on privacy rights the law sets | PRIVACY 8.5, 9.4 | GDPR 11, 12(5), 15(4), 17(3)(b),(e), 21(1); LGPD 16 I; CCPA 1798.105(d), 1798.145 | LGPD 18 §5 (always free in Brazil); "the law that protects you more" (PRIVACY 1.5) |
| Response times are targets | POLICIES 6.4 | Contract law | DSA 16(6) "timely, diligent" still binds |
| Names are permissions, reclaimable | POLICIES 4.6; TERMS 10.1 | Contract law; trade mark law | Notice before, unless harm |
| Incident tightening of rules without a new version | POLICIES 1.2 | Contract law; DSA 14 allows restrictions described in the terms | Logged publicly; DSA 14(2) informs of significant changes |
| Disclosure research: promise only inside the rules; report licence; confidentiality; no reward | SECURITY 5.6, 5.7, 6.5 | Contract law; CFAA (18 U.S.C. 1030) and Lei 12.737/2012 authorisation scope [known] | The good-faith promise (6.2) stays for research within 6.1 |
| Ideas and feedback used freely | TERMS 8.5 | Contract law | Code and content in repositories stay under the CLA |
| Continued use after the effective date accepts a policy | CHANGES 3.2 | Contract law; clickwrap for the texts that bind | UCTD Annex 1(j) and DSA 14(2): agreements are re-accepted (CHANGES 3.1); no change for the past (CHANGES 3.4) |

## 5. Style sheet (applied to every text)

From the Wonderland Doctrine and the lead's UX lessons:
1. Address the reader as "you"; the operator is "we". Never "the User" or "the Licensee".
2. Short sentences: aim for 20 words or fewer; one idea per sentence. Lists for anything with three or more parts.
3. Plain words first. A legal term only when the law needs that exact word (for example "controller", "counter-notice"), and then explained once, in the same sentence.
4. Present tense, active voice: "We delete it", not "Data shall be deleted".
5. No hedging and no status talk: no "not yet", "planned", "in review", "coming soon".
6. Never call software "safe" or "secure". Say "checked", "verified identity", "reviewed". The texts avoid the words "safe", "safety", "secure" and "security" altogether (the site's word check forbids them on /terms pages); the one exception is the email address of the disclosure policy.
7. Numbered sections, short headings that say what the section does.
8. Routes: the five ordered (/terms/cla, usage, privacy, publisher, trust) plus /terms/cookies, certificates, policies, notices, disclosure (not "security", which the word check would refuse), trademark, changes.
9. Every document starts with front matter, the title, the "Version N, effective DATE." line (version 1 of all twelve: "Version 1, effective 2026-11-04.") (the Worker reads it) and an "In short" box that is not binding.
10. Bold only for what a law requires to be conspicuous (disclaimers, limits, choice of law).
11. No upstream project or author names. Cloud providers are named only where the law requires it (privacy, cookies).
12. The Doctrine is the conduct rule; the texts link it and do not restate it.

## 6. Open points the texts cannot close (for the CTO and the lead)

1. **EU representative** (DSA art. 13, GDPR art. 27): needs a person or firm in an EU member state, named in writing. The texts say "to be appointed; until then contact the controller directly" (TERMS 20.3, PRIVACY 1.6 and 18, NOTICES 2.1, COOKIES 1). This is a gap, not a text problem: DSA art. 13 has no small-provider exemption.
2. **DMCA designated agent**: none registered (lead, 03:32Z). The texts name julia@wolos.org as the designated contact for notices and counter-notices (NOTICES 2.1) and never say an agent is registered. Registering (U.S. Copyright Office online form, small fee, renew every three years, postal address and phone number) is what turns on the 512(c)/(d) exemption.
3. **Postal address**: none for now (lead, 03:32Z). DMCA 512(c)(2) and DSA art. 13(4) need one; the texts say "São Paulo, Brazil, full address on request" (TERMS 20.4, PRIVACY 1.7 and 18, NOTICES 2.1). Publish the full address once chosen (a mailbox service is fine).
4. **Retention promises** that are not yet automatic in code: only rate counters (2 days) and webhook delivery ids (30 days) are purged by the daily job (`hub-worker src/ratelimit.ts` purge). The texts promise more (reports, account deletion); those are manual until code follows.
5. **Rate counters contain the network address** for the per-address limits (`hub-worker src/ratelimit.ts` limit, `hub-worker src/http.ts` clientIp). The texts disclose this honestly: "no IP address is stored, except as the key of a rate counter, which is deleted within 2 days".
6. **Account facts held at sign-in**: the Worker stores the GitHub account's creation date and two-factor status for every person (`hub-worker src/auth.ts`, persons table). The privacy policy lists them under the account category.
7. **Account age numbers**: the Worker's origin gate uses 30 days (`hub-worker src/certs.ts` ORIGIN_MIN_ACCOUNT_AGE); ADR 0049 O2 proposes 90 days for a first listing. The texts keep 30 days for an Origin certificate and 90 days for a first listing, as both records say.
8. **Integration**: the site renderer (`scripts/lib/legal.mjs` in the hub site) reads `legal/<slug>.md` (cla, usage, privacy, publisher, trust) and has no tables; the files here use the names the lead ordered (CLA.md, TERMS-OF-USE.md, ...) and contain no tables. The Worker (`hub-worker src/cla.ts`) still bundles `worker/cla/*.md`; pointing it at these files changes the hashes people accept. The Certificate Terms are accepted through the Trust Terms (TRUST 1.2), because the Worker knows three documents.
9. **Second cookie**: the Worker also sets `__Host-hub_oauth` for 10 minutes during sign-in (`hub-worker src/auth.ts` OAUTH_TTL). The texts disclose it.
10. **security@wolos.org** appears in the Disclosure Policy only; the site's word check refuses "security" on /terms pages, so that page needs an exception for the address, or another address.
