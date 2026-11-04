# SPDX-License-Identifier: GPL-2.0-or-later
# python3 -I tools/wolpack/test_wolpack.py   (HUBCHECK=wasm/bin/hubcheck also runs the checker on what it built)
import hashlib, io, json, os, subprocess, sys, tarfile, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
WOLPACK = os.path.join(HERE, "wolpack.py")
PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000001000000010008000000")  # header only: enough for the member rules


def package(files):
    """A .pkg.tar.zst with these (path, bytes) files and a .PKGINFO, as makepkg would write one."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as t:
        for name, data in [(".PKGINFO", b"pkgname = notes\n")] + files:
            m = tarfile.TarInfo(name)
            m.size = len(data)
            t.addfile(m, io.BytesIO(data))
    return subprocess.run(["zstd", "-q", "-c"], input=buf.getvalue(), capture_output=True, check=True).stdout


def run(*a):
    return subprocess.run([sys.executable, "-I", WOLPACK, *a], capture_output=True, text=True)


class T(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        p = lambda n: os.path.join(self.d, n)
        json.dump({"id": "alice.notes", "version": "0", "name": "Notes", "summary": "Quick notes", "package": "notes",
                   "targets": [{"abi": "linux", "arch": "amd64", "entry": "bin/notes"}]}, open(p("Info.json"), "w"))
        open(p("payload.pkg.tar.zst"), "wb").write(package([("usr/bin/notes", b"#!/bin/sh\n")]))
        open(p("icon.png"), "wb").write(PNG)

    def members(self, path):
        with tarfile.open(path) as t:
            return [(m.name, m.mode, m.uid, m.mtime, t.extractfile(m).read()) for m in t.getmembers()]

    def test_wol_layout_and_sums(self):
        r = run("wol", "--info", f"{self.d}/Info.json", "--payload", f"{self.d}/payload.pkg.tar.zst", "--version", "1.0-1",
                "--icon", f"{self.d}/icon.png", "--out", self.d)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = r.stdout.strip()
        self.assertTrue(out.endswith("alice.notes-1.0-1.wol"))
        ms = self.members(out)
        self.assertEqual([m[0] for m in ms], ["Info.json", "icon.png", "payload.pkg", "SHA256"])
        self.assertTrue(all(m[1] == 0o644 and m[2] == 0 and m[3] == 0 for m in ms))
        self.assertEqual(json.loads(ms[0][4])["version"], "1.0-1")
        want = "".join(sorted(f"SHA256 ({n}) = {hashlib.sha256(b).hexdigest()}\n" for n, _, _, _, b in ms[:-1]))
        self.assertEqual(ms[-1][4].decode(), want)
        again = run("wol", "--info", f"{self.d}/Info.json", "--payload", f"{self.d}/payload.pkg.tar.zst", "--version", "1.0-1",
                    "--icon", f"{self.d}/icon.png", "--out", os.path.join(self.d, "b"))
        self.assertEqual(open(out, "rb").read(), open(again.stdout.strip(), "rb").read(), "not reproducible")
        if os.environ.get("HUBCHECK"):
            rep = json.loads(subprocess.run([os.environ["HUBCHECK"], "check", "app", out], capture_output=True, text=True).stdout)
            self.assertNotEqual(rep["verdict"], "block", rep)
            self.assertEqual(rep["file"], {"id": "alice.notes", "version": "1.0-1"})

    def test_payload_must_be_a_package(self):
        open(f"{self.d}/bad.pkg", "wb").write(b"not zstd")
        r = run("wol", "--info", f"{self.d}/Info.json", "--payload", f"{self.d}/bad.pkg", "--version", "1.0-1", "--out", self.d)
        self.assertEqual(r.returncode, 2)

    def wol_with(self, files, name="payload2.pkg.tar.zst"):
        open(f"{self.d}/{name}", "wb").write(package(files))
        return run("wol", "--info", f"{self.d}/Info.json", "--payload", f"{self.d}/{name}", "--version", "1.0-1", "--out", self.d)

    def test_a_web_app_under_opt_reaches_the_kit_by_its_absolute_path(self):
        # ADR 0048: the kit is /usr/share/wolos/webapps/kit/; from /opt/wolos/webapps/<slug>/ "../kit/" is outside the policy.
        page = lambda href: f'<link rel="stylesheet" href="{href}wolkit.css"><script src="{href}bridge.js"></script>'.encode()
        ok = self.wol_with([("opt/wolos/webapps/hello/index.html", page("/usr/share/wolos/webapps/kit/")),
                            ("opt/wolos/webapps/hello/app.toml", b'id = "org.wolos.webapp.hello"\n')])
        self.assertEqual(ok.returncode, 0, ok.stderr)
        bad = self.wol_with([("opt/wolos/webapps/hello/index.html", page("../kit/"))])
        self.assertEqual(bad.returncode, 2)
        self.assertIn("../kit/", bad.stderr)
        self.assertIn("/usr/share/wolos/webapps/kit/", bad.stderr)
        js = self.wol_with([("opt/wolos/webapps/hello/app.js", b'import("../kit/wolkit.js")')])
        self.assertEqual(js.returncode, 2, js.stderr)
        # a package never ships the kit, and its pages do not name a kit under /opt
        own = self.wol_with([("opt/wolos/webapps/kit/wolkit.css", b"a{}"), ("opt/wolos/webapps/hello/index.html", page("/usr/share/wolos/webapps/kit/"))])
        self.assertEqual(own.returncode, 2)
        self.assertIn("never ships the kit", own.stderr)
        under = self.wol_with([("opt/wolos/webapps/hello/index.html", page("/opt/wolos/webapps/kit/"))])
        self.assertEqual(under.returncode, 2)
        # other packages, and web files outside /opt/wolos/webapps, are not looked at
        other = self.wol_with([("usr/share/doc/notes/index.html", page("../kit/")), ("usr/bin/notes", b"x")])
        self.assertEqual(other.returncode, 0, other.stderr)

    def test_wolplug(self):
        pd = os.path.join(self.d, "plug")
        os.makedirs(os.path.join(pd, ".git"))
        open(os.path.join(pd, "plugin.toml"), "w").write('schema = 1\nid = "alice.stats"\nname = "Stats"\nversion = "1.0"\n')
        open(os.path.join(pd, "card.lua"), "w").write("return 1\n")
        r = run("wolplug", "--dir", pd, "--version", "1.0", "--out", self.d)
        self.assertEqual(r.returncode, 0, r.stderr)
        tar = subprocess.run(["zstd", "-dc", r.stdout.strip()], capture_output=True, check=True).stdout
        with tarfile.open(fileobj=io.BytesIO(tar)) as t:
            self.assertEqual(t.getnames(), ["alice.stats/card.lua", "alice.stats/plugin.toml", "SHA256"])
        self.assertEqual(run("wolplug", "--dir", pd, "--version", "2.0", "--out", self.d).returncode, 2)

    def test_verdict(self):
        rep = os.path.join(self.d, "r.json")
        json.dump({"verdict": "pass", "findings": [], "file": {"id": "a.b", "version": "1.0-1"}}, open(rep, "w"))
        self.assertEqual(run("verdict", "--report", rep, "--id", "a.b", "--version", "1.0-1").returncode, 0)
        self.assertEqual(run("verdict", "--report", rep, "--id", "a.c", "--version", "1.0-1").returncode, 1)
        self.assertEqual(run("verdict", "--report", rep, "--id", "a.b", "--version", "1.0").returncode, 1)
        json.dump({"verdict": "flag", "findings": [], "file": {"id": "a.b", "version": "1.0-1"}}, open(rep, "w"))
        self.assertEqual(run("verdict", "--report", rep, "--id", "a.b", "--version", "1.0-1").returncode, 1)

    def test_version_of(self):
        self.assertEqual(run("version-of", "v0.9.1-1").stdout.strip(), "0.9.1-1")
        self.assertEqual(run("version-of", "version-1").stdout.strip(), "version-1")


if __name__ == "__main__":
    unittest.main()
