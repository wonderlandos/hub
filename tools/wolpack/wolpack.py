#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""wolpack: build the file a WolOS Hub release attaches, from a repository's own files.

    wolpack.py wol --info hub/Info.json --payload rsh-0.9.1-1-x86_64.pkg.tar.zst --version 0.9.1-1 \
                   [--icon hub/icon.png] [--screenshot hub/screenshots/1.png ...] --out dist/
    wolpack.py wolplug --dir plugins/stats --version 1.0 --out dist/
    wolpack.py version-of v0.9.1-1          # prints 0.9.1-1 (the hub's rule: a leading v before a digit goes)
    wolpack.py verdict --report r.json --id wonderlandos.rsh --version 0.9.1-1   # exit 1 unless hubcheck said pass

Everything the hub lists (name, summary, description, icon, screenshots, licence, homepage) is read from the file this
writes; nothing is uploaded by hand. The formats are the system's own:

* `.wol` (docs/modules/packages.md, ADR 0011/0021): ustar, regular files, mode 0644, uid/gid 0, mtime 0, in the order
  Info.json, icon.png, screenshots/<name>.png|webp (hub reader only, see --screenshot), payload.pkg, SHA256. SHA256 has
  one `SHA256 (<member>) = <hex>` line per other member, sorted. Info.json `version` must be the payload's pacman
  `pkgver-pkgrel` (wol-admind compares them) and the release tag's version (the hub check compares them).
* `.wolplug` (ADR 0031, wol_core::plugins::pack): ustar of `<id>/<file>` for every file of the folder (sorted), then
  SHA256 over those, compressed with zstd -19.

No signature is added: a file without one is listed as Community. Signing (CHAIN, SHA256.wsig) is `woltrust`'s job.
Python 3 standard library only, plus the `zstd` command for .wolplug. The output is byte-for-byte reproducible.
"""
import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import threading

# A web app of others installs to /opt/wolos/webapps/<slug>/ (ADR 0048); the kit is the image's, one copy, and the
# runtime's policy lets such an app reach exactly its own folder and that kit (webengine::bridge::manifest::kit_for).
WEBAPPS = "opt/wolos/webapps/"
SYSTEM_KIT = "/usr/share/wolos/webapps/kit/"
PAGE_SUFFIX = (".html", ".htm", ".js", ".css")
MAX_PAGE = 4 << 20
VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._,+~-]{0,63}$")
SHOT = re.compile(r"^[a-z0-9_-]{1,32}\.(png|webp)$")
MAX_SHOTS = 8


def die(msg, code=2):
    sys.stderr.write(f"wolpack: {msg}\n")
    sys.exit(code)


def version_of(tag):
    return re.sub(r"^v(?=\d)", "", tag)


def sha(b):
    return hashlib.sha256(b).hexdigest()


def manifest(members):
    return "".join(sorted(f"SHA256 ({n}) = {sha(b)}\n" for n, b in members)).encode()


def ustar(members):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w", format=tarfile.USTAR_FORMAT) as t:
        for name, data in members:
            if len(name) > 99:
                die(f"{name}: a member name is longer than 99 characters")
            ti = tarfile.TarInfo(name)
            ti.size, ti.mode, ti.mtime, ti.uid, ti.gid, ti.uname, ti.gname = len(data), 0o644, 0, 0, 0, "", ""
            ti.type = tarfile.REGTYPE
            t.addfile(ti, io.BytesIO(data))
    return out.getvalue()


def read(p):
    with open(p, "rb") as f:
        return f.read()


def is_still_picture(name, b):
    if name.endswith(".png"):
        return b.startswith(b"\x89PNG\r\n\x1a\n") and b"acTL" not in b[:4096]
    return b[:4] == b"RIFF" and b[8:12] == b"WEBP" and b"ANIM" not in b[:64]


def write(path, data):
    tmp = f"{path}.tmp{os.getpid()}"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def check_kit(payload, name):
    """A payload with a web app under /opt/wolos/webapps ships no kit and its pages name the kit by its absolute path.

    "../kit/" from /opt/wolos/webapps/<slug>/ is /opt/wolos/webapps/kit/: a folder no package installs and the policy
    does not allow. The kit is /usr/share/wolos/webapps/kit/ (the host and the policy agree, ADR 0048)."""
    p = subprocess.Popen(["zstd", "-dc"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    feeder = threading.Thread(target=lambda: (p.stdin.write(payload), p.stdin.close()), daemon=True)
    feeder.start()
    bad = []
    try:
        with tarfile.open(fileobj=p.stdout, mode="r|") as t:
            for m in t:
                n = m.name[2:] if m.name.startswith("./") else m.name
                if not n.startswith(WEBAPPS):
                    continue
                if n.startswith(WEBAPPS + "kit/") or n == WEBAPPS + "kit":
                    bad.append(f"{n}: a package never ships the kit; it comes with the image ({SYSTEM_KIT})")
                elif m.isfile() and n.endswith(PAGE_SUFFIX) and m.size <= MAX_PAGE:
                    text = t.extractfile(m).read().decode("utf-8", "replace")
                    if "../kit/" in text or "/opt/wolos/webapps/kit/" in text:
                        bad.append(f"{n}: names the kit as ../kit/; under /opt it is {SYSTEM_KIT}")
    except tarfile.TarError as e:
        die(f"{name}: the payload is not a readable pacman package ({e})")
    finally:
        p.stdout.close()
        p.wait()
    if p.returncode:
        die(f"{name}: the payload is not a zstd-compressed package")
    if bad:
        die("; ".join(bad[:5]))


def wol(a):
    info = json.loads(read(a.info))
    if a.id:
        info["id"] = a.id
    info["version"] = a.version
    if not VERSION.match(a.version):
        die(f"{a.version}: not a version")
    for k in ("id", "name", "summary", "package", "targets"):
        if not info.get(k):
            die(f"{a.info}: {k} is missing")
    members = [("Info.json", None)]
    if a.icon:
        icon = read(a.icon)
        if not a.icon.endswith(".png") or not is_still_picture(".png", icon):
            die(f"{a.icon}: the icon of a .wol is a still PNG (member icon.png)")
        members.append(("icon.png", icon))
    shots = []
    for s in a.screenshot or []:
        base = os.path.basename(s)
        if not SHOT.match(base):
            die(f"{s}: a screenshot is named with a-z 0-9 _ - and ends in .png or .webp")
        b = read(s)
        if not is_still_picture(base, b):
            die(f"{s}: not a still {base.rsplit('.', 1)[1].upper()} picture")
        shots.append((f"screenshots/{base}", b))
    if len(shots) > MAX_SHOTS:
        die(f"at most {MAX_SHOTS} screenshots")
    if shots:
        info["screenshots"] = [n for n, _ in shots]
    else:
        info.pop("screenshots", None)
    members += shots
    payload = read(a.payload)
    if not payload.startswith(b"\x28\xb5\x2f\xfd"):
        die(f"{a.payload}: the payload is a pacman package (.pkg.tar.zst)")
    check_kit(payload, a.payload)
    members.append(("payload.pkg", payload))
    text = (json.dumps(info, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
    if a.write_info:
        write(a.write_info, text)
    members[0] = ("Info.json", text)
    members.append(("SHA256", manifest(members)))
    name = f"{info['id']}-{a.version}.wol"
    os.makedirs(a.out, exist_ok=True)
    write(os.path.join(a.out, name), ustar(members))
    print(os.path.join(a.out, name))


def toml_value(text, key):
    m = re.search(rf'^{key}\s*=\s*"([^"]*)"', text, re.M)
    return m.group(1) if m else None


def wolplug(a):
    toml = read(os.path.join(a.dir, "plugin.toml")).decode()
    pid, ver = toml_value(toml, "id"), toml_value(toml, "version")
    if a.version and ver != a.version:
        die(f"plugin.toml says version {ver}, the tag says {a.version}: change plugin.toml first")
    if a.id and pid != a.id:
        die(f"plugin.toml says id {pid}, the listing is {a.id}")
    files = []
    for root, dirs, names in os.walk(a.dir):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for n in sorted(names):
            if n.startswith("."):
                continue
            p = os.path.join(root, n)
            if os.path.islink(p) or not os.path.isfile(p):
                die(f"{p}: only regular files go into a plugin")
            files.append((f"{pid}/{os.path.relpath(p, a.dir)}", read(p)))
    files.sort()
    tar = ustar(files + [("SHA256", manifest(files))])
    z = subprocess.run(["zstd", "-q", "-19", "-c"], input=tar, capture_output=True, check=True).stdout
    name = f"{pid}-{ver}.wolplug"
    os.makedirs(a.out, exist_ok=True)
    write(os.path.join(a.out, name), z)
    print(os.path.join(a.out, name))


def verdict(a):
    """What the release step needs from hubcheck's report: pass, and the listing's id and the tag's version inside."""
    r = json.loads(read(a.report))
    f = r.get("file") or {}
    for x in r.get("findings", []):
        print(f"::notice::{x.get('rule')}: {x.get('sentence')} {x.get('evidence', '')}".rstrip())
    bad = []
    if r.get("verdict") != "pass":
        bad.append(f"verdict {r.get('verdict')}")
    if f.get("id") != a.id:
        bad.append(f"id {f.get('id')} is not {a.id}")
    if f.get("version") != a.version:
        bad.append(f"version {f.get('version')} is not {a.version}")
    if bad:
        print("::error::not released: " + "; ".join(bad))
        sys.exit(1)


def main():
    p = argparse.ArgumentParser(prog="wolpack")
    sub = p.add_subparsers(dest="cmd", required=True)
    w = sub.add_parser("wol")
    w.add_argument("--info", required=True)
    w.add_argument("--payload", required=True)
    w.add_argument("--version", required=True)
    w.add_argument("--id")
    w.add_argument("--icon")
    w.add_argument("--screenshot", action="append")
    w.add_argument("--write-info", help="also write the final Info.json here (the payload must carry the same bytes)")
    w.add_argument("--out", default="dist")
    g = sub.add_parser("wolplug")
    g.add_argument("--dir", required=True)
    g.add_argument("--version")
    g.add_argument("--id")
    g.add_argument("--out", default="dist")
    v = sub.add_parser("version-of")
    v.add_argument("tag")
    i = sub.add_parser("info")
    i.add_argument("--info", required=True)
    i.add_argument("--version", required=True)
    i.add_argument("--id")
    i.add_argument("--screenshot", action="append")
    i.add_argument("--out", required=True)
    c = sub.add_parser("verdict")
    c.add_argument("--report", required=True)
    c.add_argument("--id", required=True)
    c.add_argument("--version", required=True)
    a = p.parse_args()
    if a.cmd == "verdict":
        return verdict(a)
    if a.cmd == "wol":
        wol(a)
    elif a.cmd == "wolplug":
        wolplug(a)
    elif a.cmd == "info":
        info = json.loads(read(a.info))
        if a.id:
            info["id"] = a.id
        info["version"] = a.version
        shots = [f"screenshots/{os.path.basename(s)}" for s in a.screenshot or []]
        if shots:
            info["screenshots"] = shots
        else:
            info.pop("screenshots", None)
        write(a.out, (json.dumps(info, ensure_ascii=False, separators=(",", ":")) + "\n").encode())
    else:
        print(version_of(a.tag))


if __name__ == "__main__":
    main()
