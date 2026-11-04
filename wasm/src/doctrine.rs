// SPDX-License-Identifier: GPL-2.0-or-later
//! The Wonderland Doctrine as a rule on names. WolOS's own words never name the upstream
//! projects it builds on (docs/DOCTRINE.md section 6 and docs/THIRD-PARTY.md of the OS), and the
//! hub lists what a person writes next to a file: the display name and the summary. This reads
//! them with the same tables as the OS's own doctrine test and the hub site's check, as a
//! whole-word match, and flags (never blocks) a listing whose name or summary names one of them,
//! so the author can say it in plain words. Identifiers, file names and ids are code and are not read.

/// Prose names that need neutral wording, matched case-sensitively as whole words.
const PROSE: [(&str, &str); 2] = [
    ("Hyprland", "the compositor or the desktop"),
    ("AUR", "the community package collection"),
];

/// Credited projects and holders, lowercased, matched as whole words in the display name.
const CREDITED: [&str; 9] = [
    "aether",
    "anton hvornum",
    "neil jagdish patel",
    "omacom",
    "omapager",
    "omarchy",
    "omarchy-iso",
    "omarchy-zsh",
    "ryan hughes",
];

/// Words WolOS never uses for itself in its own words; a listing that calls itself official is an
/// impersonation of the project.
const OFFICIAL: [&str; 2] = ["official wolos", "wolos official"];

fn word_hits(t: &str, pat: &str) -> bool {
    t.match_indices(pat).any(|(i, _)| {
        let edge = |c: Option<char>| !c.is_some_and(|c| c.is_alphanumeric() || c == '_');
        edge(t[..i].chars().next_back()) && edge(t[i + pat.len()..].chars().next())
    })
}

/// Text without its `code spans`, which are identifiers and stay as they are.
fn prose(s: &str) -> String {
    let mut out = String::new();
    let mut code = false;
    for c in s.chars() {
        if c == '`' {
            code = !code;
        } else if !code {
            out.push(c);
        }
    }
    out
}

/// What a name or summary breaks: (rule, sentence, evidence). `field` is `name` or `summary`.
pub fn check(field: &str, text: &str) -> Vec<(&'static str, String, String)> {
    let mut out = Vec::new();
    let p = prose(text);
    let lower = p.to_lowercase();
    for (name, say) in PROSE {
        if word_hits(&p, name) {
            out.push((
                "doctrine/name",
                format!(
                    "The {field} names a project WolOS builds on. WolOS says {say} instead; please describe it in plain words."
                ),
                name.to_owned(),
            ));
        }
    }
    if field == "name" {
        for name in CREDITED {
            if word_hits(&lower, name) {
                out.push((
                    "doctrine/name",
                    "The name uses the name of a project or person that WolOS credits in one place only. Please choose a name of your own.".to_owned(),
                    name.to_owned(),
                ));
            }
        }
    }
    for o in OFFICIAL {
        if lower.contains(o) {
            out.push((
                "doctrine/impersonation",
                format!("The {field} says it is official WolOS. Only files signed by WolOS are."),
                o.to_owned(),
            ));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whole_words_only_and_code_spans_are_left_alone() {
        assert_eq!(check("name", "Hyprland tweaks").len(), 1);
        assert!(check("summary", "Works with `Hyprland --verify-config`").is_empty());
        assert!(check("summary", "hyprlandish things").is_empty());
        assert!(check("summary", "AURA lights").is_empty());
        assert_eq!(check("summary", "Install from the AUR.").len(), 1);
        assert_eq!(check("name", "Omarchy Theme").len(), 1);
        assert!(check("summary", "an omarchy theme").is_empty());
        assert_eq!(
            check("name", "Official WolOS Clock")[0].0,
            "doctrine/impersonation"
        );
        assert!(check("name", "Weather").is_empty());
    }
}
