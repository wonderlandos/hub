// SPDX-License-Identifier: GPL-2.0-or-later
//! Collects findings and turns them into the verdict of interface I7: `block` when a rule that
//! the system itself enforces broke, `not-checked` when the file could not be read to the end,
//! `flag` for everything that is listed with a sentence, `pass` when nothing broke. A clean
//! result means only that no rule broke (ADR 0022).
use crate::listing::Facts;
use crate::report::{FileId, Report, Trust};
use woltrust::{Finding, Verdict};

/// Most findings kept in one report; the rest are counted in the last one.
pub const MAX_FINDINGS: usize = 100;
/// Longest evidence text.
const MAX_EVIDENCE: usize = 200;

/// What kind of file is being looked at.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// A `.wol` package file (ADR 0011).
    App,
    /// A `.wolplug` file (ADR 0031).
    Plugin,
    /// An extension (ADR 0047, H5: a package that extends one named app).
    Extension,
}

impl Kind {
    /// `app`, `plugin` or `extension` (also `wol`, `wolplug`).
    pub fn parse(s: &str) -> Option<Kind> {
        match s {
            "app" | "wol" => Some(Kind::App),
            "plugin" | "wolplug" => Some(Kind::Plugin),
            "extension" => Some(Kind::Extension),
            _ => None,
        }
    }

    /// The name used in listings.
    pub fn name(self) -> &'static str {
        match self {
            Kind::App => "app",
            Kind::Plugin => "plugin",
            Kind::Extension => "extension",
        }
    }

    /// The file's name in a sentence.
    pub fn noun(self) -> &'static str {
        match self {
            Kind::App => "app",
            Kind::Plugin => "plugin",
            Kind::Extension => "extension",
        }
    }

    /// What a signature on this kind of file is for.
    pub fn purpose(self) -> woltrust::Purpose {
        match self {
            Kind::App => woltrust::Purpose::Package,
            Kind::Plugin => woltrust::Purpose::Plugin,
            Kind::Extension => woltrust::Purpose::Extension,
        }
    }
}

/// How bad a finding is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Level {
    Note,
    Flag,
    Block,
    Unchecked,
}

/// A growing list of findings.
#[derive(Debug, Default)]
pub struct Rules {
    findings: Vec<(Level, Finding)>,
    blocked: bool,
    unchecked: bool,
    more: usize,
    /// True when a rule about the file's shape or hashes broke (the signature then cannot be trusted).
    pub damaged: bool,
    /// The id and version the manifest gave, once it was read.
    pub file: Option<FileId>,
    /// The listing facts, once the manifest and the pictures were read.
    pub facts: Option<Facts>,
}

fn cut(s: String) -> String {
    if s.len() <= MAX_EVIDENCE {
        return s;
    }
    let mut end = MAX_EVIDENCE;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &s[..end])
}

impl Rules {
    fn add(&mut self, level: Level, rule: &str, sentence: &str, evidence: impl Into<String>) {
        match level {
            Level::Block => self.blocked = true,
            Level::Unchecked => self.unchecked = true,
            Level::Flag | Level::Note => {}
        }
        if self.findings.len() >= MAX_FINDINGS - 1 {
            if level != Level::Note {
                self.more += 1;
            }
            return;
        }
        self.findings.push((
            level,
            Finding {
                rule: rule.to_owned(),
                sentence: sentence.to_owned(),
                evidence: cut(evidence.into()),
            },
        ));
    }

    /// Listed with this sentence, leaving the verdict alone (how the listing looks, rule `listing/...`).
    pub fn note(&mut self, rule: &str, sentence: &str, evidence: impl Into<String>) {
        self.add(Level::Note, rule, sentence, evidence);
    }

    /// Listed, with this sentence.
    pub fn flag(&mut self, rule: &str, sentence: &str, evidence: impl Into<String>) {
        self.add(Level::Flag, rule, sentence, evidence);
    }

    /// Not listed.
    pub fn block(&mut self, rule: &str, sentence: &str, evidence: impl Into<String>) {
        self.add(Level::Block, rule, sentence, evidence);
    }

    /// Not listed because the file is damaged: the signature cannot be trusted either.
    pub fn broken(&mut self, rule: &str, sentence: &str, evidence: impl Into<String>) {
        self.damaged = true;
        self.add(Level::Block, rule, sentence, evidence);
    }

    /// Could not be checked to the end.
    pub fn unchecked(&mut self, rule: &str, sentence: &str, evidence: impl Into<String>) {
        self.add(Level::Unchecked, rule, sentence, evidence);
    }

    /// Removes the findings of a rule that does not apply after all (a flag only; blocks stay).
    pub fn forget(&mut self, rule: &str) {
        self.findings.retain(|(_, f)| f.rule != rule);
    }

    /// Makes an existing finding of this rule block the file.
    pub fn escalate(&mut self, rule: &str) {
        if self.findings.iter().any(|(_, f)| f.rule == rule) {
            self.blocked = true;
        }
    }

    /// True when a finding blocks the file.
    pub fn is_blocked(&self) -> bool {
        self.blocked
    }

    /// The verdict so far.
    pub fn verdict(&self) -> Verdict {
        if self.blocked {
            Verdict::Block
        } else if self.unchecked {
            Verdict::NotChecked
        } else if self.findings.iter().all(|(l, _)| *l == Level::Note) && self.more == 0 {
            Verdict::Pass
        } else {
            Verdict::Flag
        }
    }

    /// The findings, with the count of those left out at the end.
    pub fn into_findings(self) -> (Verdict, Vec<Finding>) {
        let v = self.verdict();
        let mut out: Vec<Finding> = self.findings.into_iter().map(|(_, f)| f).collect();
        if self.more > 0 {
            out.push(Finding {
                rule: "rules/more".to_owned(),
                sentence: "There are more findings than this report holds.".to_owned(),
                evidence: format!("{} more", self.more),
            });
        }
        (v, out)
    }

    /// The I7 report. `trust` is what the signature is worth (community until it is checked).
    pub fn report(mut self, trust: Trust) -> Report {
        let file = self.file.take();
        let facts = self.facts.take();
        let (verdict, findings) = self.into_findings();
        Report {
            verdict,
            findings,
            trust,
            cert: None,
            origin: None,
            file,
            facts,
        }
    }
}

/// A report that only says the input could not be read as asked.
pub fn input_problem(rule: &str, sentence: &str, evidence: &str) -> Report {
    let mut r = Rules::default();
    r.unchecked(rule, sentence, evidence);
    r.report(Trust::Community)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verdicts_follow_the_worst_finding() {
        let mut r = Rules::default();
        assert_eq!(r.verdict(), Verdict::Pass);
        r.flag("a/b", "s", "");
        assert_eq!(r.verdict(), Verdict::Flag);
        r.unchecked("a/c", "s", "");
        assert_eq!(r.verdict(), Verdict::NotChecked);
        r.block("a/d", "s", "");
        assert_eq!(r.verdict(), Verdict::Block);
    }

    #[test]
    fn notes_are_listed_and_leave_the_verdict_alone() {
        let mut r = Rules::default();
        r.note("listing/icon-missing", "s", "");
        assert_eq!(r.verdict(), Verdict::Pass);
        let rep = r.report(Trust::Community);
        assert_eq!(rep.findings.len(), 1);
        assert_eq!(rep.verdict, Verdict::Pass);
    }

    #[test]
    fn findings_and_evidence_are_bounded() {
        let mut r = Rules::default();
        for i in 0..500 {
            r.flag("x/y", "s", "é".repeat(300 + i));
        }
        let rep = r.report(Trust::Community);
        assert_eq!(rep.findings.len(), MAX_FINDINGS);
        assert_eq!(rep.findings[MAX_FINDINGS - 1].rule, "rules/more");
        assert!(rep.findings[0].evidence.len() <= MAX_EVIDENCE + 3);
    }
}
