#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
# Draws the five wireframes of PUBLISH-FLOW.md as SVG with the hub's own tokens (light). Run: python3 wireframes.py
# PNGs are made from the SVGs with a headless browser (see the hand-back); no dependency here.
import html, os

T = dict(bg="#F1F1FA", surface="#FFFFFF", surface2="#EBEBF3", border="#DAD9E2", text="#151520", text2="#565563",
         accent="#7452F5", accent_text="#6D48EB", green="#1C9A6E", yellow="#E0A21F", red="#CF3A68", blue="#1D64B0")
FONT = "Inter, 'Segoe UI', system-ui, -apple-system, Roboto, 'Helvetica Neue', Arial, sans-serif"
MONO = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace"
W = 1200

class S:
    def __init__(self, h, title):
        self.h, self.o = h, []
        self.title = title
    def raw(self, s): self.o.append(s)
    def rect(self, x, y, w, h, fill=None, stroke=None, r=12, sw=1, shadow=False, dash=None):
        f = f' filter="url(#sh)"' if shadow else ""
        d = f' stroke-dasharray="{dash}"' if dash else ""
        self.raw(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill or "none"}" stroke="{stroke or "none"}" stroke-width="{sw}"{d}{f}/>')
    def text(self, x, y, s, size=15, weight=400, fill=None, anchor="start", mono=False, ls=None):
        fam = MONO if mono else FONT
        l = f' letter-spacing="{ls}"' if ls else ""
        self.raw(f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" font-weight="{weight}" fill="{fill or T["text"]}" text-anchor="{anchor}"{l}>{html.escape(s)}</text>')
    def lines(self, x, y, ls, size=15, lh=22, fill=None, weight=400):
        for i, l in enumerate(ls): self.text(x, y + i * lh, l, size, weight, fill)
    def line(self, x1, y1, x2, y2, c=None, sw=1):
        self.raw(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{c or T["border"]}" stroke-width="{sw}"/>')
    def circle(self, cx, cy, r, fill, stroke=None, sw=2):
        self.raw(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke="{stroke or "none"}" stroke-width="{sw}"/>')
    def card(self, x, y, w, h, r=12, fill=None): self.rect(x, y, w, h, fill or T["surface"], T["border"], r, shadow=True)
    def btn(self, x, y, w, label, solid=True, h=40):
        self.rect(x, y, w, h, T["accent"] if solid else T["surface"], None if solid else T["border"], h // 2, shadow=solid)
        self.text(x + w / 2, y + h / 2 + 5, label, 15, 600, "#fff" if solid else T["text"], "middle")
    def badge(self, x, y, label, color):
        w = 24 + len(label) * 7.4
        self.rect(x, y, w, 24, T["surface2"], T["border"], 12)
        self.circle(x + 13, y + 12, 4.5, color)
        self.text(x + 24, y + 17, label, 13, 600)
        return w
    def input(self, x, y, w, label, val, h=40):
        self.text(x, y, label, 13, 600)
        self.rect(x, y + 8, w, h, T["bg"], T["border"], 10)
        self.text(x + 14, y + 8 + h / 2 + 5, val, 15, 400, T["text2"])
    def code(self, x, y, w, ls):
        h = 56 + len(ls) * 22
        self.rect(x, y, w, h, "#17151F", None, 14)
        for i, c in enumerate("#5A5470 #5A5470 #5A5470".split()): self.circle(x + 18 + i * 14, y + 16, 4, c)
        for i, l in enumerate(ls): self.text(x + 18, y + 48 + i * 22, l, 13, 400, "#E8E6F2", mono=True)
        self.rect(x + w - 74, y + 8, 62, 24, None, "#4A4560", 12)
        self.text(x + w - 43, y + 25, "Copy", 12, 600, "#E8E6F2", "middle")
        return h
    def header(self, active=None, signed=True, admin=False):
        self.line(0, 64, W, 64, T["border"])
        self.raw(f'<rect x="40" y="20" width="24" height="24" rx="7" fill="{T["accent"]}"/>')
        self.text(74, 38, "WolOS Hub" if not admin else "WolOS Hub admin", 16, 650)
        x = 220
        if not admin:
            for n in ["Apps", "Plugins", "Extensions", "Publish"]:
                w = 20 + len(n) * 8
                if n == active: self.rect(x - 8, 16, w + 8, 32, T["surface2"], None, 16)
                self.text(x, 37, n, 15, 400 if n != active else 600, T["text"] if n == active else T["text2"])
                x += w + 14
            self.rect(700, 12, 260, 40, T["surface"], T["border"], 20)
            self.text(722, 37, "Search the hub", 15, 400, T["text2"])
        if signed:
            self.circle(1000, 32, 14, T["surface2"], T["border"])
            self.text(1024, 37, "alice", 15, 500)
            self.text(1160, 37, "Sign out", 13, 400, T["text2"], "end")
    def footer(self, y):
        self.line(40, y, W - 40, y)
        self.text(40, y + 28, "WolOS Hub is part of the WolOS project.", 12, 400, T["text2"])
    def note(self, x, y, s, w=300):
        self.raw(f'<g><rect x="{x}" y="{y}" width="{w}" height="{22 * (s.count(chr(10)) + 1) + 18}" rx="6" fill="#FFF4C7" stroke="#E0A21F" stroke-width="1"/></g>')
        self.lines(x + 12, y + 24, s.split("\n"), 12, 20, "#5A4300")
    def save(self, name):
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{self.h}" viewBox="0 0 {W} {self.h}">'
               f'<defs><filter id="sh" x="-5%" y="-5%" width="110%" height="120%"><feDropShadow dx="1" dy="2" stdDeviation="2" flood-color="#151520" flood-opacity="0.12"/></filter></defs>'
               f'<rect width="{W}" height="{self.h}" fill="{T["bg"]}"/>' + "".join(self.o) +
               f'<text x="{W - 20}" y="{self.h - 12}" font-family="{FONT}" font-size="11" fill="{T["text2"]}" text-anchor="end">{html.escape(self.title)}</text></svg>')
        open(os.path.join(os.path.dirname(os.path.abspath(__file__)), name), "w").write(svg)

STAGES = ["Received", "Checked", "Signed", "Published"]
def track(s, x, y, w, states, times):
    """states: done/current/waiting/failed/skipped"""
    gap = (w - 80) / 3
    col = dict(done=T["green"], current=T["accent"], waiting=T["border"], failed=T["red"], skipped=T["border"])
    for i in range(3):
        c = T["green"] if states[i] == "done" and states[i + 1] in ("done", "current", "failed") else T["border"]
        s.line(x + 40 + i * gap + 18, y + 18, x + 40 + (i + 1) * gap - 18, y + 18, c, 3)
    for i, (st, name) in enumerate(zip(states, STAGES)):
        cx = x + 40 + i * gap
        if st == "done":
            s.circle(cx, y + 18, 16, T["green"]); s.raw(f'<path d="M{cx-6} {y+18} l4.5 5 l8 -10" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>')
        elif st == "current":
            s.circle(cx, y + 18, 16, T["surface"], T["accent"], 3); s.circle(cx, y + 18, 6, T["accent"])
        elif st == "failed":
            s.circle(cx, y + 18, 16, T["red"]); s.raw(f'<path d="M{cx-6} {y+12} l12 12 m0 -12 l-12 12" stroke="#fff" stroke-width="3" stroke-linecap="round"/>')
        else:
            s.circle(cx, y + 18, 16, T["surface"], T["border"], 2)
        s.text(cx, y + 54, name, 15, 650 if st in ("current", "failed") else 500, T["text"] if st != "waiting" else T["text2"], "middle")
        s.text(cx, y + 74, times[i], 12, 400, T["text2"], "middle")

# ---------------------------------------------------------------- 1. publish wizard
def publish():
    s = S(1540, "Wireframe 1: Publish. Step 4 of 5 is the one that needs the person; finished steps fold into one line.")
    s.header("Publish")
    s.text(40, 118, "Publish your app", 36, 650, ls="-0.7")
    s.text(40, 150, "Apps, plugins and extensions publish the same way. Your files stay on GitHub; the hub checks every version and lists it.", 17, 400, T["text2"])
    # rail
    rx, ry = 40, 200
    steps = [("Sign in", "Signed in as alice", "done"), ("Agreements", "Accepted, version 1", "done"), ("Install on GitHub", "Installed on 3 repositories", "done"),
             ("Connect a repository", "Pick one, choose what it is", "current"), ("Push a tag", "The hub does the rest", "waiting")]
    for i, (n, sub, st) in enumerate(steps):
        y = ry + i * 92
        if i < 4: s.line(rx + 16, y + 34, rx + 16, y + 92 - 2, T["green"] if st == "done" else T["border"], 3)
        if st == "done":
            s.circle(rx + 16, y + 16, 16, T["green"]); s.raw(f'<path d="M{rx+10} {y+16} l4.5 5 l8 -10" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>')
        elif st == "current":
            s.circle(rx + 16, y + 16, 16, T["accent"]); s.text(rx + 16, y + 22, str(i + 1), 15, 700, "#fff", "middle")
        else:
            s.circle(rx + 16, y + 16, 16, T["surface"], T["border"], 2); s.text(rx + 16, y + 22, str(i + 1), 15, 600, T["text2"], "middle")
        s.text(rx + 46, y + 14, n, 16, 650 if st != "waiting" else 500, T["text"] if st != "waiting" else T["text2"])
        s.text(rx + 46, y + 36, sub, 13, 400, T["text2"])
    # main card: connect
    mx, my, mw = 340, 190, 820
    s.card(mx, my, mw, 780)
    s.text(mx + 28, my + 44, "Connect a repository", 24, 650)
    s.text(mx + 28, my + 72, "Pick the repository you publish from. The hub only reads its releases.", 15, 400, T["text2"])
    repos = [("alice/notes", "Public", "sel", "Notes for WolOS"), ("alice/clock", "Public", "", "A small desktop clock"), ("alice/dotfiles", "Private", "dis", "Private. Make it public on GitHub to publish it."),
             ("acme/tool", "Public", "", "Owned by acme, which you have not linked yet")]
    for i, (n, vis, st, sub) in enumerate(repos):
        y = my + 100 + i * 66
        s.rect(mx + 28, y, mw - 56, 56, T["bg"] if st != "sel" else "#EFEAFF", T["accent"] if st == "sel" else T["border"], 12, 2 if st == "sel" else 1)
        s.circle(mx + 54, y + 28, 9, T["surface"], T["accent"] if st == "sel" else T["border"], 2)
        if st == "sel": s.circle(mx + 54, y + 28, 4.5, T["accent"])
        s.text(mx + 76, y + 25, n, 16, 650, T["text2"] if st == "dis" else T["text"])
        s.text(mx + 76, y + 44, sub, 13, 400, T["red"] if st == "dis" else T["text2"])
        if i == 3: s.btn(mx + mw - 28 - 28 - 130, y + 8, 130, "Link acme", False, 40)
        else: s.badge(mx + mw - 28 - 28 - 70, y + 16, vis, T["green"] if vis == "Public" else T["yellow"])
    s.text(mx + 28, my + 400, "What is it?", 14, 650)
    for i, (n, on) in enumerate([("App", True), ("Plugin", False), ("Extension", False)]):
        x = mx + 28 + i * 130
        s.rect(x, my + 414, 118, 40, "#EFEAFF" if on else T["surface"], T["accent"] if on else T["border"], 20, 2 if on else 1)
        s.text(x + 59, my + 440, n, 15, 600, T["accent_text"] if on else T["text"], "middle")
    s.rect(mx + 28, my + 480, mw - 56, 76, T["bg"], T["border"], 12)
    s.text(mx + 46, my + 508, "It will be listed as  alice.notes", 15, 600)
    s.text(mx + 46, my + 534, "Releases need a file named  alice.notes-*.wol   (one star stands for the version)", 14, 400, T["text2"])
    s.text(mx + 28, my + 592, "Details  ▸  id, name, one sentence, licence, file name", 14, 600, T["accent_text"])
    s.btn(mx + 28, my + 622, 220, "Connect alice/notes", True, 48)
    s.text(mx + 270, my + 652, "Takes one second. You can change the details later.", 13, 400, T["text2"])
    s.line(mx + 28, my + 700, mx + mw - 28, my + 700)
    s.text(mx + 28, my + 736, "Next: push a tag. The hub shows the three lines with your real names.", 14, 400, T["text2"])
    # pre-connect preview of step 5
    s.text(mx, my + 830, "After Connect, the card turns into this:", 14, 650, T["text2"])
    s.card(mx, my + 846, mw, 260)
    s.badge(mx + 28, my + 868, "Connected", T["green"])
    s.text(mx + 150, my + 886, "alice/notes is now listed as alice.notes", 15, 600)
    s.code(mx + 28, my + 912, mw - 56, ["git tag v1.0.0 && git push origin v1.0.0", "gh release create v1.0.0 alice.notes-1.0.0.wol", "# or:  wol publish"])
    s.btn(mx + 28, my + 1042, 200, "Open the dashboard", False)
    s.text(mx + 248, my + 1068, "v0.9.0 is already on GitHub with the right file. Publish it again to send it to the hub.", 13, 400, T["text2"])
    s.note(40, 780, "Skeleton first: rail and\ncard outline draw at once;\nstate fills in from one call.\nFinished steps fold to a line.", 250)
    s.footer(1500)
    s.h = 1540
    s.save("1-publish.svg")

# ---------------------------------------------------------------- 2/3. status
def status(ok):
    s = S(1040 if ok else 1150, "Wireframe 2: a version that is published." if ok else "Wireframe 3: a version that was not listed, with what to fix.")
    s.header("Publish")
    s.raw(f'<text x="40" y="104" font-family="{FONT}" font-size="14" fill="{T["text2"]}">Hub  /  Dashboard  /  alice.notes</text>')
    s.text(40, 150, "Notes 1.0.0" if ok else "Notes 1.1.0", 34, 650, ls="-0.6")
    s.text(40, 178, "alice.notes  ·  tag " + ("v1.0.0" if ok else "v1.1.0") + "  ·  alice/notes on GitHub", 15, 400, T["text2"])
    s.card(40, 206, 1120, 150)
    if ok: track(s, 70, 232, 1060, ["done", "done", "done", "done"], ["4 Nov, 10:02", "4 Nov, 10:14", "4 Nov, 11:20", "4 Nov, 11:20"])
    else: track(s, 70, 232, 1060, ["done", "failed", "skipped", "skipped"], ["4 Nov, 12:02", "4 Nov, 12:15", "", ""])
    y = 380
    if ok:
        s.card(40, y, 1120, 120)
        s.badge(68, y + 22, "Published", T["green"])
        s.text(68, y + 70, "Notes 1.0.0 is listed on the hub and offered to install.", 20, 650)
        s.btn(930, y + 40, 200, "Open the listing", True)
        s.card(40, y + 140, 1120, 190)
        s.text(68, y + 176, "Signature", 18, 650)
        s.lines(68, y + 206, ["Signed by WolOS Hub on 4 November 2026 (statement 3f2a91bc).",
                              "Your own signature: none. This version shows as Community: nobody vouches for who made it."], 15, 24, T["text"])
        s.text(68, y + 262, "Sign your releases to show your name on them  →", 15, 600, T["accent_text"])
        s.text(68, y + 300, "Origin certificate: issued by the hub by itself once you accept the agreements.", 13, 400, T["text2"])
        y2 = y + 350
        s.card(40, y2, 1120, 170)
        s.text(68, y2 + 36, "The file", 18, 650)
        s.text(68, y2 + 68, "alice.notes-1.0.0.wol   ·   2.4 MB   ·   on GitHub ↗", 15, 400)
        s.rect(68, y2 + 88, 960, 36, T["surface2"], None, 8)
        s.text(82, y2 + 111, "9f2c4be07a1d5c83e0b6f19a47d2c8e5b13a6f0d92e47c85a1b0d3f6e8c9a2b4", 13, 400, mono=True)
        s.rect(1050, y2 + 92, 80, 28, None, T["border"], 14); s.text(1090, y2 + 111, "Copy", 13, 600, anchor="middle")
        s.text(68, y2 + 150, "Updates by itself every 5 seconds while a stage is under way; stops here.", 13, 400, T["text2"])
        s.footer(980)
    else:
        s.card(40, y, 1120, 150)
        s.badge(68, y + 22, "Not listed", T["red"])
        s.text(68, y + 70, "The check found something that stops this version from being listed.", 20, 650)
        s.text(68, y + 100, "Fix the points below, then publish a new version with a new tag. A version that was checked is never replaced.", 15, 400, T["text2"])
        s.btn(930, y + 40, 200, "Check again", False)
        s.card(40, y + 170, 1120, 240)
        s.text(68, y + 206, "What the check found", 18, 650)
        for i, (a, b) in enumerate([("The package asks to read all your files.", "Ask only for the files a person chooses, or say why in the description."),
                                    ("The package has no icon.", "Add icon.png (at least 256 × 256) to the package and publish a new version.")]):
            yy = y + 236 + i * 76
            s.circle(78, yy + 8, 6, T["red"])
            s.text(96, yy + 13, a, 16, 600)
            s.text(96, yy + 38, "To fix: " + b, 14, 400, T["text2"])
        s.card(40, y + 430, 1120, 190)
        s.text(68, y + 466, "Publish the fix", 18, 650)
        s.code(68, y + 486, 1064, ["git tag v1.1.1 && git push origin v1.1.1", "gh release create v1.1.1 alice.notes-1.1.1.wol"])
        s.note(40, y + 640, "Intake failures use the same page: a tag with no file shows\nstage 1 in red, the exact sentence, and Check again.", 520)
        s.footer(1100)
    s.save("2-status-published.svg" if ok else "3-status-failed.svg")

# ---------------------------------------------------------------- 4. dashboard
def dashboard():
    s = S(1540, "Wireframe 4: the dashboard of one account; the account switch keeps working without a page load.")
    s.header("Publish")
    s.text(40, 118, "Your dashboard", 36, 650, ls="-0.7")
    for i, (n, on) in enumerate([("alice", True), ("acme", False)]):
        x = 40 + i * 100
        s.rect(x, 140, 90 if i == 0 else 84, 34, T["surface2"] if on else None, T["border"], 17)
        s.text(x + (45 if i == 0 else 42), 162, n, 14, 600 if on else 400, T["text"] if on else T["text2"], "middle")
    # rail
    for i, (n, on) in enumerate([("Needs your attention", True), ("Listings", False), ("Certificates", False), ("Agreements", False), ("Reports", False), ("Members", False)]):
        s.text(40, 230 + i * 34, n, 15, 650 if on else 400, T["text"] if on else T["text2"])
    s.line(28, 214, 28, 214 + 6 * 34 - 14, T["accent"], 3)
    mx, mw = 260, 900
    s.card(mx, 200, mw, 118, fill="#FFF8E6")
    s.rect(mx, 200, 4, 118, T["yellow"], None, 2)
    s.text(mx + 28, 236, "Needs your attention", 18, 650)
    s.circle(mx + 34, 264, 5, T["red"]); s.text(mx + 50, 269, "alice.notes 1.1.0 was not listed.", 15, 600); s.text(mx + 330, 269, "See why  →", 15, 600, T["accent_text"])
    s.circle(mx + 34, 292, 5, T["yellow"]); s.text(mx + 50, 297, "Tag v1.2.0 on alice/clock is waiting for its release.", 15, 600); s.text(mx + 440, 297, "What to do  →", 15, 600, T["accent_text"])
    # listings
    s.text(mx, 362, "Listings", 24, 650)
    for k, (name, kind, repo, v, st, fin) in enumerate([("Notes", "App", "alice/notes", "1.2.0", ["done", "done", "current", "waiting"], False), ("Clock", "Plugin", "alice/clock", "0.9.1", ["done", "done", "done", "done"], True)]):
        y = 382 + k * 320
        s.card(mx, y, mw, 300)
        s.rect(mx + 24, y + 24, 56, 56, "#3B4775", None, 14); s.text(mx + 52, y + 62, name[0], 26, 700, "#FFF6EA", "middle")
        s.text(mx + 96, y + 46, name, 20, 650); s.text(mx + 96, y + 70, f"{kind}  ·  {repo}  ·  alice." + name.lower(), 14, 400, T["text2"])
        s.badge(mx + mw - 120, y + 30, "Connected", T["green"])
        s.text(mx + 24, y + 112, "Latest: " + v, 15, 650)
        gap = 150
        for i in range(4):
            cx = mx + 140 + 60 + i * gap
            if i < 3: s.line(cx + 12, y + 108, cx + gap - 12, y + 108, T["green"] if st[i] == "done" and st[i + 1] != "waiting" else T["border"], 3)
        for i, nm in enumerate(STAGES):
            cx = mx + 200 + i * gap
            c = {"done": T["green"], "current": T["accent"], "waiting": T["border"]}[st[i]]
            s.circle(cx, y + 108, 10, c if st[i] != "waiting" else T["surface"], c if st[i] == "waiting" else None, 2)
            s.text(cx, y + 136, nm, 12, 600 if st[i] == "current" else 400, T["text"] if st[i] != "waiting" else T["text2"], "middle")
        for j, (vv, bd, col, when) in enumerate([("1.2.0" if k == 0 else "0.9.1", "Checked" if k == 0 else "Published", T["accent"] if k == 0 else T["green"], "today"), ("1.1.0" if k == 0 else "0.9.0", "Not listed" if k == 0 else "Published", T["red"] if k == 0 else T["green"], "4 Nov"), ("1.0.0" if k == 0 else "0.8.0", "Published", T["green"], "4 Nov")]):
            yy = y + 160 + j * 40
            s.line(mx + 24, yy, mx + mw - 24, yy)
            s.text(mx + 24, yy + 26, vv, 15, 650); s.badge(mx + 130, yy + 7, bd, col); s.text(mx + 300, yy + 26, when, 14, 400, T["text2"])
            s.text(mx + mw - 24, yy + 26, "Status  →", 14, 600, T["accent_text"], "end")
    s.rect(mx, 1030, mw, 64, None, T["border"], 12, 1, dash="6 5")
    s.text(mx + mw / 2, 1068, "+  Connect another repository", 16, 650, T["accent_text"], "middle")
    # certs
    cy = 1150
    s.text(mx, cy, "Certificates", 24, 650)
    s.card(mx, cy + 20, 436, 110); s.card(mx + 464, cy + 20, 436, 110)
    s.text(mx + 24, cy + 56, "Origin certificate", 17, 650); s.badge(mx + 24, cy + 70, "Issued 4 Nov", T["green"]); s.text(mx + 24, cy + 118, "Serial 3f2a91bc…", 12, 400, T["text2"], mono=True)
    s.text(mx + 488, cy + 56, "Trusted developer certificate", 17, 650); s.text(mx + 488, cy + 94, "Apply once your origin certificate is issued.", 14, 400, T["text2"])
    s.text(mx, cy + 180, "Agreements   ·   Reports   ·   Members and roles   (as today, in the same page)", 15, 400, T["text2"])
    s.note(mx + 520, 1310, "One call fills the whole page\n(/api/my/overview, one ETag).\nSwitching account re-filters it.", 300)
    s.footer(1500)
    s.save("4-dashboard.svg")

# ---------------------------------------------------------------- 5. admin
def admin():
    s = S(1230, "Wireframe 5: the admin queue; one list, buttons on the row, a reason field only where a reason is needed.")
    s.header(signed=False, admin=True)
    for i, (n, on) in enumerate([("Queue", True), ("Look up", False), ("Roles", False), ("Audit trail", False)]):
        x = 300 + i * 96
        if on: s.rect(x - 10, 16, 88, 32, T["surface2"], None, 16)
        s.text(x, 37, n, 15, 600 if on else 400, T["text"] if on else T["text2"])
    s.text(1160, 37, "Carol, owner", 14, 400, T["text2"], "end")
    def section(y, title, n): s.text(40, y, f"{title} ({n})", 22, 650)
    def row(y, who, lines, btns, h=104, reason=False):
        s.card(40, y, 1120, h)
        s.text(64, y + 32, who, 17, 650)
        for i, l in enumerate(lines): s.text(64, y + 58 + i * 20, l, 14, 400, T["text2"])
        x = 1136
        for i, (b, solid) in enumerate(reversed(btns)):
            w = 30 + len(b) * 8.2
            x -= w; s.btn(x, y + 28, w, b, solid, 40); x -= 12
        if reason:
            s.rect(64, y + 96, 760, 40, T["bg"], T["accent"], 10, 2); s.text(80, y + 121, "Why? Shown to the person who asked.", 14, 400, T["text2"])
            s.btn(836, y + 96, 120, "Refuse", True, 40); s.btn(968, y + 96, 100, "Cancel", False, 40)
    section(108, "Certificate requests", 2)
    row(124, "Dave Roe (dave)", ["Origin certificate, person. Asked on 4 November 2026.", "Names dave., key 8c41e2…"], [("Approve", True), ("Refuse", False)], 156, reason=True)
    row(296, "Acme Ltd (acme)", ["Trusted developer certificate, organisation. Asked on 3 November 2026."], [("Approve", True), ("Refuse", False)], 90)
    section(430, "Revocations", 1)
    row(446, "revoke 3f2a91bc", ["abuse: counterfeit packages. Asked on 4 November 2026. Approved by carol."], [("Approve as second admin", True)], 90)
    section(578, "Versions to look at", 2)
    row(594, "Notes 1.1.0 (alice.notes)", ["Blocked by the check on 4 November: the package asks to read all your files.", "alice · community"], [("Withdraw version", False), ("Flag version", False)], 104)
    row(714, "Clock 0.9.1 (alice.clock)", ["The check could not read the file on 3 November."], [("Withdraw version", False), ("Flag version", False)], 90)
    section(846, "Reports", 1)
    row(862, "Clock 0.9.0 (alice.clock)", ["alice.clock, malware, 4 November.", "\"It opens a window and uploads my documents.\""], [("Take down", False), ("Resolve", True)], 108)
    s.note(40, 1010, "One click: Approve, Resolve. A reason field opens on the row (no\ndialog) for Refuse, Take down, Flag, Withdraw and the second\napproval of a revocation. Revoke and Downgrade stay in Look up.", 560)
    s.note(640, 1010, "Everything lands in the audit trail with the reason.\nNobody decides about their own certificate.\nThe panel answers 404 to anyone without a role.", 520)
    s.footer(1180)
    s.save("5-admin-queue.svg")

if __name__ == "__main__":
    publish(); status(True); status(False); dashboard(); admin()
