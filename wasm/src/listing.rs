// SPDX-License-Identifier: GPL-2.0-or-later
//! The listing facts of a file (lead 02:33Z: the hub's listing comes from the package itself, with
//! no upload step): name, summary, description, icon, screenshots, categories, homepage and
//! licence, read from the manifest and from the pictures inside. Pictures are PNG or WebP only, read
//! from their headers (no pixel is decoded here), still (no APNG, no animated WebP), and within the
//! sizes below. SVG is never taken as the listing icon: this crate has no sanitiser. A problem with a
//! listing field is a note (`listing/...`): it is listed in the findings and leaves the verdict alone,
//! because it says how the listing looks, not what the file does; the faulty picture or field is
//! left out of `facts`, so the pipeline never puts it on the CDN.
use crate::files::sha256_hex;
use crate::rules::Rules;
use serde::{Deserialize, Serialize};

/// Most screenshots in a listing.
pub const MAX_SCREENSHOTS: usize = 8;
/// Largest icon file.
pub const MAX_ICON_BYTES: usize = 1 << 20;
/// Largest screenshot file.
pub const MAX_SHOT_BYTES: usize = 2 << 20;
/// Smallest and largest icon side (icons are square).
pub const ICON_SIDE: (u32, u32) = (128, 1024);
/// Smallest and largest screenshot side.
pub const SHOT_SIDE: (u32, u32) = (320, 3840);
/// Longest description, in characters.
pub const MAX_DESCRIPTION: usize = 4000;
/// Longest homepage address.
pub const MAX_HOMEPAGE: usize = 200;
/// Longest licence name.
pub const MAX_LICENCE: usize = 64;
/// Most PNG or WebP chunks walked when looking for animation.
const MAX_CHUNKS: usize = 4096;

/// A picture format the hub shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mime {
    /// `image/png`.
    Png,
    /// `image/webp`.
    Webp,
}

impl Mime {
    /// The media type.
    pub fn as_str(self) -> &'static str {
        match self {
            Mime::Png => "image/png",
            Mime::Webp => "image/webp",
        }
    }

    /// The file name ending that goes with it.
    pub fn ext(self) -> &'static str {
        match self {
            Mime::Png => "png",
            Mime::Webp => "webp",
        }
    }

    fn of_name(name: &str) -> Option<Mime> {
        let n = name.to_ascii_lowercase();
        if n.ends_with(".png") {
            Some(Mime::Png)
        } else if n.ends_with(".webp") {
            Some(Mime::Webp)
        } else {
            None
        }
    }
}

/// A picture of the listing, as the report shows it.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Image {
    /// Where it is in the file: the member name of a `.wol`, the path in the folder of a plugin.
    pub path: String,
    /// `image/png` or `image/webp`.
    pub mime: String,
    /// Width in pixels, from the header.
    pub w: u32,
    /// Height in pixels, from the header.
    pub h: u32,
    /// Size of the file in bytes.
    pub size: u64,
    /// SHA-256 of the file, lowercase hex (the CDN name is `<sha256>.<png|webp>`).
    pub sha256: String,
}

/// The listing facts: interface I7 `facts`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Facts {
    /// Display name.
    pub name: String,
    /// One line under the name.
    pub summary: String,
    /// Longer text, when given.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The icon, when there is a usable one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<Image>,
    /// The usable screenshots, in the file's order.
    pub screenshots: Vec<Image>,
    /// Store categories.
    pub categories: Vec<String>,
    /// https address of the project, when given.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    /// SPDX licence name, when given.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub licence: Option<String>,
}

/// What a manifest says for the listing, before the pictures are read.
#[derive(Debug, Default)]
pub struct Text {
    /// Display name.
    pub name: String,
    /// Summary.
    pub summary: String,
    /// Description, as written (checked here).
    pub description: Option<String>,
    /// Categories (already checked against the closed list).
    pub categories: Vec<String>,
    /// Homepage, as written (checked here).
    pub homepage: Option<String>,
    /// Licence, as written (checked here).
    pub licence: Option<String>,
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
    let x = b.get(at..at + 4)?;
    Some(u32::from_be_bytes([x[0], x[1], x[2], x[3]]))
}

fn le32(b: &[u8], at: usize) -> Option<u32> {
    let x = b.get(at..at + 4)?;
    Some(u32::from_le_bytes([x[0], x[1], x[2], x[3]]))
}

fn le24(b: &[u8], at: usize) -> Option<u32> {
    let x = b.get(at..at + 3)?;
    Some(u32::from(x[0]) | u32::from(x[1]) << 8 | u32::from(x[2]) << 16)
}

fn looks_like_svg(b: &[u8]) -> bool {
    let head = &b[..b.len().min(512)];
    let t = String::from_utf8_lossy(head)
        .trim_start()
        .to_ascii_lowercase();
    t.starts_with("<?xml") || t.starts_with("<svg") || t.starts_with("<!doctype svg")
}

/// The format and size of a picture, from its header: PNG (IHDR, no `acTL`) or WebP (`VP8 `,
/// `VP8L` or `VP8X` without the animation flag or `ANIM`/`ANMF` chunks). The error is the reason.
pub fn probe(b: &[u8]) -> Result<(Mime, u32, u32), &'static str> {
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        return png(b);
    }
    if b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP" {
        return webp(b);
    }
    if looks_like_svg(b) {
        return Err("it is an SVG drawing; use a PNG or WebP picture");
    }
    Err("it is not a PNG or WebP picture")
}

fn png(b: &[u8]) -> Result<(Mime, u32, u32), &'static str> {
    const DAMAGED: &str = "the PNG picture is damaged";
    if be32(b, 8) != Some(13) || b.get(12..16) != Some(b"IHDR") {
        return Err(DAMAGED);
    }
    let (w, h) = (be32(b, 16).ok_or(DAMAGED)?, be32(b, 20).ok_or(DAMAGED)?);
    if w == 0 || h == 0 || w > 1 << 24 || h > 1 << 24 {
        return Err(DAMAGED);
    }
    let mut at = 8usize;
    for _ in 0..MAX_CHUNKS {
        let len = be32(b, at).ok_or(DAMAGED)? as usize;
        let kind = b.get(at + 4..at + 8).ok_or(DAMAGED)?;
        let next = at
            .checked_add(12)
            .and_then(|x| x.checked_add(len))
            .ok_or(DAMAGED)?;
        if next > b.len() {
            return Err(DAMAGED);
        }
        match kind {
            b"acTL" | b"fcTL" | b"fdAT" => return Err("the picture is animated"),
            b"IDAT" => return Ok((Mime::Png, w, h)),
            b"IEND" => return Err(DAMAGED),
            _ => at = next,
        }
    }
    Err(DAMAGED)
}

fn webp(b: &[u8]) -> Result<(Mime, u32, u32), &'static str> {
    const DAMAGED: &str = "the WebP picture is damaged";
    let riff = le32(b, 4).ok_or(DAMAGED)? as usize;
    let end = riff.checked_add(8).ok_or(DAMAGED)?;
    if end > b.len() || end < 20 {
        return Err(DAMAGED);
    }
    let b = &b[..end];
    let first = b.get(12..16).ok_or(DAMAGED)?;
    let d = b.get(20..).ok_or(DAMAGED)?;
    let (w, h) = match first {
        b"VP8 " => {
            // Frame tag (3 bytes, bit 0 clear on a key frame), start code, then 14-bit sizes.
            if d.len() < 10 || d[0] & 1 != 0 || d[3..6] != [0x9d, 0x01, 0x2a] {
                return Err(DAMAGED);
            }
            let w = u32::from(u16::from_le_bytes([d[6], d[7]]) & 0x3fff);
            let h = u32::from(u16::from_le_bytes([d[8], d[9]]) & 0x3fff);
            (w, h)
        }
        b"VP8L" => {
            if d.first() != Some(&0x2f) {
                return Err(DAMAGED);
            }
            let bits = le32(d, 1).ok_or(DAMAGED)?;
            ((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
        }
        b"VP8X" => {
            let flags = *d.first().ok_or(DAMAGED)?;
            if flags & 0x02 != 0 {
                return Err("the picture is animated");
            }
            (
                le24(d, 4).ok_or(DAMAGED)? + 1,
                le24(d, 7).ok_or(DAMAGED)? + 1,
            )
        }
        _ => return Err(DAMAGED),
    };
    if w == 0 || h == 0 {
        return Err(DAMAGED);
    }
    let mut at = 12usize;
    for _ in 0..MAX_CHUNKS {
        if at == b.len() {
            return Ok((Mime::Webp, w, h));
        }
        let kind = b.get(at..at + 4).ok_or(DAMAGED)?;
        let len = le32(b, at + 4).ok_or(DAMAGED)? as usize;
        if kind == b"ANIM" || kind == b"ANMF" {
            return Err("the picture is animated");
        }
        at = at
            .checked_add(8)
            .and_then(|x| x.checked_add(len + (len & 1)))
            .filter(|x| *x <= b.len())
            .ok_or(DAMAGED)?;
    }
    Err(DAMAGED)
}

/// What a picture is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    /// The listing icon.
    Icon,
    /// A screenshot.
    Screenshot,
}

/// Checks one picture for `role`: the error is the reason, for the person.
pub fn image(path: &str, b: &[u8], role: Role) -> Result<Image, String> {
    let (max_bytes, (lo, hi)) = match role {
        Role::Icon => (MAX_ICON_BYTES, ICON_SIDE),
        Role::Screenshot => (MAX_SHOT_BYTES, SHOT_SIDE),
    };
    if b.len() > max_bytes {
        return Err(format!(
            "it is {} bytes, more than {} MB",
            b.len(),
            max_bytes >> 20
        ));
    }
    let (mime, w, h) = probe(b).map_err(str::to_owned)?;
    if Mime::of_name(path) != Some(mime) {
        return Err(format!(
            "it is a {} picture but its name does not end in .{}",
            mime.ext().to_uppercase(),
            mime.ext()
        ));
    }
    if role == Role::Icon && w != h {
        return Err(format!("it is {w}x{h} pixels; an icon is square"));
    }
    if w < lo || h < lo || w > hi || h > hi {
        return Err(format!(
            "it is {w}x{h} pixels; each side must be {lo} to {hi}"
        ));
    }
    Ok(Image {
        path: path.to_owned(),
        mime: mime.as_str().to_owned(),
        w,
        h,
        size: b.len() as u64,
        sha256: sha256_hex(b),
    })
}

fn ok_text(s: &str, max: usize, lines: bool) -> bool {
    s.chars().count() <= max && !s.chars().any(|c| c.is_control() && !(lines && c == '\n'))
}

/// An https address of up to 200 characters with a host and nothing a browser would read twice.
pub fn is_homepage(s: &str) -> bool {
    s.len() <= MAX_HOMEPAGE
        && s.strip_prefix("https://").is_some_and(|rest| {
            let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
            !host.is_empty()
                && !host.contains('@')
                && host
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b".-:".contains(&c))
        })
        && s.bytes().all(|c| c.is_ascii_graphic())
}

/// A file name ending (`.png` or `.webp`) a listing picture may have.
pub fn is_picture_name(s: &str) -> bool {
    Mime::of_name(s).is_some()
}

/// Builds the facts from the manifest's text and the pictures found (`icon`: path and bytes when the
/// file has one; `shots`: the screenshots named, with their bytes when present), adding a note for
/// every problem. `noun` names the file in sentences.
pub fn facts(
    text: Text,
    icon: Option<(&str, Option<&[u8]>)>,
    shots: &[(&str, Option<&[u8]>)],
    noun: &str,
    r: &mut Rules,
) -> Facts {
    let mut f = Facts {
        name: text.name,
        summary: text.summary,
        categories: text.categories,
        ..Facts::default()
    };
    if let Some(d) = text.description.filter(|d| !d.trim().is_empty()) {
        if ok_text(&d, MAX_DESCRIPTION, true) {
            for (rule, sentence, evidence) in crate::doctrine::check("description", &d) {
                r.flag(rule, &sentence, evidence);
            }
            f.description = Some(d);
        } else {
            r.note(
                "listing/description",
                "The description is text of up to 4000 characters, so it was left out of the listing.",
                format!("{} characters", d.chars().count()),
            );
        }
    }
    if let Some(h) = text.homepage {
        if is_homepage(&h) {
            f.homepage = Some(h);
        } else {
            r.note(
                "listing/homepage",
                "The homepage is an https address of up to 200 characters, so it was left out of the listing.",
                h,
            );
        }
    }
    if let Some(l) = text.licence.filter(|l| !l.trim().is_empty()) {
        if ok_text(&l, MAX_LICENCE, false) {
            f.licence = Some(l);
        } else {
            r.note(
                "listing/licence",
                "The licence is a short SPDX name, so it was left out of the listing.",
                l,
            );
        }
    }
    match icon {
        None => r.note(
            "listing/icon-missing",
            &format!("The {noun} has no icon, so the hub shows a plain one. Add a square PNG or WebP picture of 256 or 512 pixels."),
            "",
        ),
        Some((path, None)) => r.note(
            "listing/icon",
            &format!("The icon named in the manifest is not in the {noun}, so the hub shows a plain one."),
            path,
        ),
        Some((path, Some(b))) => match image(path, b, Role::Icon) {
            Ok(i) => f.icon = Some(i),
            Err(why) => r.note(
                "listing/icon",
                &format!("The icon cannot be shown: {why}. The hub shows a plain one."),
                path,
            ),
        },
    }
    for (i, (path, bytes)) in shots.iter().enumerate() {
        if i >= MAX_SCREENSHOTS {
            r.note(
                "listing/screenshots",
                "A listing shows at most 8 screenshots; the others were left out.",
                format!("{} screenshots", shots.len()),
            );
            break;
        }
        if f.screenshots.iter().any(|s| s.path == *path) {
            r.note("listing/screenshot", "A screenshot is named twice.", *path);
            continue;
        }
        let Some(b) = bytes else {
            r.note(
                "listing/screenshot",
                &format!("A screenshot named in the manifest is not in the {noun}."),
                *path,
            );
            continue;
        };
        match image(path, b, Role::Screenshot) {
            Ok(img) => f.screenshots.push(img),
            Err(why) => r.note(
                "listing/screenshot",
                &format!("A screenshot cannot be shown: {why}. It was left out of the listing."),
                *path,
            ),
        }
    }
    f
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_head(w: u32, h: u32, extra: &[(&[u8; 4], &[u8])]) -> Vec<u8> {
        let mut b = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut chunk = |kind: &[u8; 4], data: &[u8]| {
            b.extend((data.len() as u32).to_be_bytes());
            b.extend(kind);
            b.extend(data);
            b.extend([0, 0, 0, 0]);
        };
        let mut ihdr = w.to_be_bytes().to_vec();
        ihdr.extend(h.to_be_bytes());
        ihdr.extend([8, 0, 0, 0, 0]);
        chunk(b"IHDR", &ihdr);
        for (k, d) in extra {
            chunk(k, d);
        }
        chunk(b"IDAT", b"x");
        chunk(b"IEND", b"");
        b
    }

    fn webp_vp8x(w: u32, h: u32, flags: u8) -> Vec<u8> {
        let mut d = vec![flags, 0, 0, 0];
        d.extend(&(w - 1).to_le_bytes()[..3]);
        d.extend(&(h - 1).to_le_bytes()[..3]);
        let mut body = b"WEBPVP8X".to_vec();
        body.extend(10u32.to_le_bytes());
        body.extend(d);
        let mut out = b"RIFF".to_vec();
        out.extend((body.len() as u32).to_le_bytes());
        out.extend(body);
        out
    }

    #[test]
    fn png_and_webp_sizes_come_from_the_header() {
        assert_eq!(probe(&png_head(256, 256, &[])), Ok((Mime::Png, 256, 256)));
        assert_eq!(probe(&webp_vp8x(800, 600, 0)), Ok((Mime::Webp, 800, 600)));
        let mut lossless = b"RIFF\x16\x00\x00\x00WEBPVP8L\x09\x00\x00\x00\x2f".to_vec();
        lossless.extend((255u32 | (127 << 14)).to_le_bytes());
        lossless.extend([0, 0, 0, 0, 0]);
        assert_eq!(probe(&lossless), Ok((Mime::Webp, 256, 128)));
    }

    #[test]
    fn animation_svg_and_damage_are_refused() {
        assert_eq!(
            probe(&png_head(256, 256, &[(b"acTL", &[0; 8])])),
            Err("the picture is animated")
        );
        assert_eq!(
            probe(&webp_vp8x(64, 64, 0x02)),
            Err("the picture is animated")
        );
        assert!(
            probe(b"  <svg xmlns='http://www.w3.org/2000/svg'/>")
                .unwrap_err()
                .contains("SVG")
        );
        assert!(probe(b"\x89PNG\r\n\x1a\nxxxx").is_err());
        let mut cut = png_head(256, 256, &[]);
        cut.truncate(40);
        assert!(probe(&cut).is_err());
        assert!(probe(b"RIFF\xff\xff\xff\xffWEBPVP8X").is_err());
        assert!(probe(b"\x7fELF").is_err());
    }

    #[test]
    fn roles_have_their_sizes_and_the_name_matches_the_format() {
        let sq = png_head(512, 512, &[]);
        assert!(image("icon.png", &sq, Role::Icon).is_ok());
        assert!(
            image("icon.webp", &sq, Role::Icon)
                .unwrap_err()
                .contains(".png")
        );
        assert!(
            image("icon.png", &png_head(512, 256, &[]), Role::Icon)
                .unwrap_err()
                .contains("square")
        );
        assert!(image("icon.png", &png_head(64, 64, &[]), Role::Icon).is_err());
        assert!(image("icon.png", &png_head(2048, 2048, &[]), Role::Icon).is_err());
        assert!(image("s.webp", &webp_vp8x(1280, 800, 0), Role::Screenshot).is_ok());
        assert!(image("s.webp", &webp_vp8x(5000, 800, 0), Role::Screenshot).is_err());
        let mut big = png_head(512, 512, &[]);
        big.resize(MAX_ICON_BYTES + 1, 0);
        assert!(
            image("icon.png", &big, Role::Icon)
                .unwrap_err()
                .contains("bytes")
        );
    }

    #[test]
    fn homepages_are_plain_https() {
        assert!(is_homepage("https://example.org/notes"));
        assert!(!is_homepage("http://example.org"));
        assert!(!is_homepage("https://"));
        assert!(!is_homepage("https://user@evil.example/"));
        assert!(!is_homepage("https://a.org/ space"));
        assert!(!is_homepage("javascript:alert(1)"));
    }
}
