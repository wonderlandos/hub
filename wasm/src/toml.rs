// SPDX-License-Identifier: GPL-2.0-or-later
//! The small, fixed part of TOML that `plugin.toml` uses (strings, integers, booleans, arrays,
//! `[[table]]`, comments), read without a dependency, with every loop bounded. Anything else is an
//! error with a sentence and a line number.

/// Longest text read.
pub const MAX_TEXT: usize = 256 * 1024;
/// Deepest array nesting.
pub const MAX_DEPTH: usize = 8;
/// Most keys in a document.
pub const MAX_KEYS: usize = 5000;

/// A value.
#[derive(Clone, Debug, PartialEq)]
pub enum Val {
    /// A string.
    Str(String),
    /// An integer.
    Int(i64),
    /// true or false.
    Bool(bool),
    /// An array.
    Arr(Vec<Val>),
}

impl Val {
    /// The string, if it is one.
    pub fn str(&self) -> Option<&str> {
        match self {
            Val::Str(s) => Some(s),
            _ => None,
        }
    }

    /// The strings of an array of strings.
    pub fn strings(&self) -> Option<Vec<&str>> {
        match self {
            Val::Arr(a) => a.iter().map(Val::str).collect(),
            _ => None,
        }
    }
}

/// `key = value` with the line it was on.
pub type Pair = (String, Val, usize);

/// A `[[name]]` section.
#[derive(Debug)]
pub struct Section {
    /// Table name.
    pub name: String,
    /// Line of the header.
    pub line: usize,
    /// Its keys.
    pub pairs: Vec<Pair>,
}

/// A parsed document.
#[derive(Debug, Default)]
pub struct Doc {
    /// Keys before the first section.
    pub header: Vec<Pair>,
    /// `[[sections]]` in file order.
    pub sections: Vec<Section>,
}

impl Doc {
    /// The value of a header key.
    pub fn get(&self, key: &str) -> Option<&Val> {
        self.header.iter().find(|p| p.0 == key).map(|p| &p.1)
    }
}

/// A parse error: the line and a sentence.
#[derive(Debug, PartialEq, Eq)]
pub struct Error {
    /// 1-based line.
    pub line: usize,
    /// What to fix.
    pub sentence: String,
}

struct P<'a> {
    s: &'a str,
    at: usize,
    line: usize,
}

fn err<T>(line: usize, s: &str) -> Result<T, Error> {
    Err(Error {
        line,
        sentence: s.to_owned(),
    })
}

impl P<'_> {
    fn peek(&self) -> Option<char> {
        self.s[self.at..].chars().next()
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek()?;
        self.at += c.len_utf8();
        if c == '\n' {
            self.line += 1;
        }
        Some(c)
    }

    fn blanks(&mut self) {
        while matches!(self.peek(), Some(' ' | '\t')) {
            self.bump();
        }
    }

    /// Spaces, newlines and comments (inside arrays).
    fn space(&mut self) {
        loop {
            match self.peek() {
                Some(' ' | '\t' | '\n' | '\r') => {
                    self.bump();
                }
                Some('#') => self.skip_line(),
                _ => return,
            }
        }
    }

    fn skip_line(&mut self) {
        while let Some(c) = self.peek() {
            if c == '\n' {
                return;
            }
            self.bump();
        }
    }

    fn end_of_line(&mut self) -> Result<(), Error> {
        self.blanks();
        match self.peek() {
            None | Some('\n' | '\r') => Ok(()),
            Some('#') => {
                self.skip_line();
                Ok(())
            }
            Some(_) => err(
                self.line,
                "Only one entry per line, then a comment or the end.",
            ),
        }
    }

    fn key(&mut self) -> Result<String, Error> {
        let start = self.at;
        while matches!(self.peek(), Some(c) if c.is_ascii_alphanumeric() || c == '_' || c == '-') {
            self.bump();
        }
        if self.at == start {
            return err(self.line, "Expected a name before the equals sign.");
        }
        Ok(self.s[start..self.at].to_owned())
    }

    fn string(&mut self) -> Result<String, Error> {
        let line = self.line;
        let q = self.bump().unwrap_or('"');
        if self.s[self.at..].starts_with(q) && self.s[self.at + 1..].starts_with(q) {
            return err(line, "Multi-line strings are not used in plugin.toml.");
        }
        let mut out = String::new();
        loop {
            match self.bump() {
                None | Some('\n') => return err(line, "A string is not closed on its line."),
                Some(c) if c == q => return Ok(out),
                Some('\\') if q == '"' => match self.bump() {
                    Some('n') => out.push('\n'),
                    Some('t') => out.push('\t'),
                    Some('r') => out.push('\r'),
                    Some('"') => out.push('"'),
                    Some('\\') => out.push('\\'),
                    Some('u') => {
                        let hex: String = (0..4).filter_map(|_| self.bump()).collect();
                        match u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
                            Some(c) => out.push(c),
                            None => return err(line, "A \\u escape needs four hex digits."),
                        }
                    }
                    _ => return err(line, "An unknown escape in a string."),
                },
                Some(c) => out.push(c),
            }
        }
    }

    fn value(&mut self, depth: usize) -> Result<Val, Error> {
        match self.peek() {
            Some('"' | '\'') => self.string().map(Val::Str),
            Some('[') => {
                if depth >= MAX_DEPTH {
                    return err(self.line, "Arrays nest too deep.");
                }
                self.bump();
                let mut items = Vec::new();
                loop {
                    self.space();
                    if self.peek() == Some(']') {
                        self.bump();
                        return Ok(Val::Arr(items));
                    }
                    if items.len() >= 1000 {
                        return err(self.line, "An array is too long.");
                    }
                    items.push(self.value(depth + 1)?);
                    self.space();
                    match self.peek() {
                        Some(',') => {
                            self.bump();
                        }
                        Some(']') => {}
                        _ => return err(self.line, "Expected a comma or a closing bracket."),
                    }
                }
            }
            Some(c) if c.is_ascii_digit() || c == '-' || c == '+' => {
                let start = self.at;
                self.bump();
                while matches!(self.peek(), Some(c) if c.is_ascii_alphanumeric() || c == '_' || c == '.')
                {
                    self.bump();
                }
                let t = self.s[start..self.at].replace('_', "");
                match t.parse::<i64>() {
                    Ok(n) => Ok(Val::Int(n)),
                    Err(_) => err(self.line, "Only whole numbers are used in plugin.toml."),
                }
            }
            Some('t' | 'f') => {
                let start = self.at;
                while matches!(self.peek(), Some(c) if c.is_ascii_alphabetic()) {
                    self.bump();
                }
                match &self.s[start..self.at] {
                    "true" => Ok(Val::Bool(true)),
                    "false" => Ok(Val::Bool(false)),
                    _ => err(
                        self.line,
                        "A value is a string, a number, true, false or a list.",
                    ),
                }
            }
            Some('{') => err(self.line, "Inline tables are not used in plugin.toml."),
            _ => err(
                self.line,
                "A value is a string, a number, true, false or a list.",
            ),
        }
    }
}

/// Parses `text`.
pub fn parse(text: &str) -> Result<Doc, Error> {
    if text.len() > MAX_TEXT {
        return err(1, "The file is too large.");
    }
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut p = P {
        s: text,
        at: 0,
        line: 1,
    };
    let mut doc = Doc::default();
    let mut keys = 0usize;
    loop {
        p.space();
        let Some(c) = p.peek() else {
            return Ok(doc);
        };
        if c == '[' {
            let line = p.line;
            p.bump();
            if p.peek() != Some('[') {
                return err(
                    line,
                    "Use [[name]] for a section; plain [name] tables are not used.",
                );
            }
            p.bump();
            let name = p.key()?;
            if !(p.s[p.at..].starts_with("]]")) {
                return err(line, "A section header ends with ]].");
            }
            p.bump();
            p.bump();
            p.end_of_line()?;
            doc.sections.push(Section {
                name,
                line,
                pairs: Vec::new(),
            });
            continue;
        }
        let line = p.line;
        let key = p.key()?;
        p.blanks();
        if p.peek() != Some('=') {
            return err(line, "Expected an equals sign after the name.");
        }
        p.bump();
        p.blanks();
        let v = p.value(0)?;
        p.end_of_line()?;
        keys += 1;
        if keys > MAX_KEYS {
            return err(line, "Too many entries.");
        }
        let list = match doc.sections.last_mut() {
            Some(s) => &mut s.pairs,
            None => &mut doc.header,
        };
        if list.iter().any(|(k, _, _)| *k == key) {
            return err(line, &format!("\"{key}\" is given twice."));
        }
        list.push((key, v, line));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_header_sections_and_lists() {
        let d = parse("# c\nschema = 1\nid = 'a.b' # x\nperm = [\n \"x\",\n \"y\", # z\n]\n\n[[menubar]]\nid = \"m\"\non = true\n").unwrap();
        assert_eq!(d.get("schema"), Some(&Val::Int(1)));
        assert_eq!(d.get("id").and_then(Val::str), Some("a.b"));
        assert_eq!(d.get("perm").and_then(Val::strings), Some(vec!["x", "y"]));
        assert_eq!(d.sections.len(), 1);
        assert_eq!(d.sections[0].pairs[1].1, Val::Bool(true));
        assert_eq!(d.sections[0].pairs[0].2, 10);
    }

    #[test]
    fn refuses_what_it_does_not_read_with_a_line() {
        for (t, line) in [
            ("a = {b = 1}", 1),
            ("\na = \"\"\"x\"\"\"", 2),
            ("[t]\n", 1),
            ("a = 1.5", 1),
            ("a = 1\na = 2", 2),
            ("a = \"open", 1),
            ("a 1", 1),
            ("a = [[[[[[[[[[1]]]]]]]]]]", 1),
        ] {
            assert_eq!(parse(t).unwrap_err().line, line, "{t}");
        }
    }

    #[test]
    fn is_bounded() {
        assert!(parse(&"#".repeat(MAX_TEXT + 1)).is_err());
        assert!(parse(&"a = 1\n".repeat(10)).is_err());
        let deep = format!("a = {}{}", "[".repeat(100), "]".repeat(100));
        assert!(parse(&deep).is_err());
        let _ = parse("a = \u{e9}");
    }
}
