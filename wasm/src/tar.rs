// SPDX-License-Identifier: GPL-2.0-or-later
//! A bounded reader for the plain ustar archives of `.wol` (ADR 0011) and `.wolplug` (ADR 0031):
//! regular files only, no name prefix, a good checksum, every member inside the bytes. The rules
//! are those of the system's own reader, so a file this reads is a file the system reads.
use std::ops::Range;

const BLOCK: usize = 512;
/// Most members read from one archive.
pub const MAX_MEMBERS: usize = 4096;

/// One member: its name and where its bytes are.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Member {
    /// Name as stored.
    pub name: String,
    /// Where the bytes are in the archive.
    pub at: Range<usize>,
}

fn octal(b: &[u8]) -> Option<usize> {
    let s = std::str::from_utf8(b).ok()?;
    let s = s.trim_matches(|c| c == '\0' || c == ' ');
    if s.is_empty() || !s.bytes().all(|c| (b'0'..=b'7').contains(&c)) {
        return None;
    }
    usize::from_str_radix(s, 8).ok()
}

fn field(b: &[u8]) -> &[u8] {
    &b[..b.iter().position(|c| *c == 0).unwrap_or(b.len())]
}

/// The members of `tar`, in order.
pub fn members(tar: &[u8]) -> Result<Vec<Member>, &'static str> {
    let mut out = Vec::new();
    let mut pos = 0usize;
    loop {
        let Some(h) = tar.get(pos..pos + BLOCK) else {
            return Err("truncated archive");
        };
        if h.iter().all(|b| *b == 0) {
            return Ok(out);
        }
        if out.len() >= MAX_MEMBERS {
            return Err("too many members");
        }
        let sum: usize = h
            .iter()
            .enumerate()
            .map(|(i, b)| {
                if (148..156).contains(&i) {
                    32
                } else {
                    usize::from(*b)
                }
            })
            .sum();
        if octal(&h[148..156]) != Some(sum) {
            return Err("bad header checksum");
        }
        if &h[257..262] != b"ustar" {
            return Err("not a ustar archive");
        }
        if !matches!(h[156], b'0' | 0) || !field(&h[345..500]).is_empty() {
            return Err("only plain files are allowed");
        }
        let name = std::str::from_utf8(field(&h[..100]))
            .map_err(|_| "member name not UTF-8")?
            .to_owned();
        let size = octal(&h[124..136]).ok_or("bad member size")?;
        let start = pos + BLOCK;
        let end = start.checked_add(size).ok_or("truncated archive")?;
        if end > tar.len() {
            return Err("truncated archive");
        }
        out.push(Member {
            name,
            at: start..end,
        });
        pos = start + size.div_ceil(BLOCK) * BLOCK;
    }
}

/// ustar bytes of plain files (mode 0644, root, mtime 0), for tests and fixtures.
pub fn build(members: &[(&str, &[u8])]) -> Vec<u8> {
    let mut out = Vec::new();
    for (name, data) in members {
        let mut h = [0u8; BLOCK];
        let n = name.len().min(100);
        h[..n].copy_from_slice(&name.as_bytes()[..n]);
        for (at, v) in [(100, "0000644"), (108, "0000000"), (116, "0000000")] {
            h[at..at + 7].copy_from_slice(v.as_bytes());
        }
        h[124..135].copy_from_slice(format!("{:011o}", data.len()).as_bytes());
        h[136..147].copy_from_slice(b"00000000000");
        h[156] = b'0';
        h[257..263].copy_from_slice(b"ustar\0");
        h[263..265].copy_from_slice(b"00");
        h[148..156].copy_from_slice(b"        ");
        let sum: u32 = h.iter().map(|b| u32::from(*b)).sum();
        h[148..156].copy_from_slice(format!("{sum:06o}\0 ").as_bytes());
        out.extend_from_slice(&h);
        out.extend_from_slice(data);
        out.resize(out.len().div_ceil(BLOCK) * BLOCK, 0);
    }
    out.resize(out.len() + 2 * BLOCK, 0);
    out
}
