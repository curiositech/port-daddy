"""scripts/whitepaper-plates/print_weight.py: the check names an offender, --write
repairs it and records both digests, a second run is idempotent, --force re-derives
from the kept original, and a replacement placed at the governed path supersedes
the kept original instead of being silently discarded (Codex review of #10334)."""
import contextlib
import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/whitepaper-plates"))
import print_weight as pw  # noqa: E402

DIR = "plates/margin-evidence"


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def art(path: Path, size=(1200, 1500), seed=1) -> None:
    """A noisy RGBA cutout: a disc of noise on a transparent field, heavy as a PNG."""
    import numpy as np
    from PIL import Image
    w, h = size
    rgb = np.random.default_rng(seed).integers(0, 256, (h, w, 3), dtype=np.uint8)
    yy, xx = np.mgrid[0:h, 0:w]
    alpha = (((xx - w / 2) ** 2 + (yy - h / 2) ** 2) < (w / 3) ** 2).astype(np.uint8) * 255
    Image.fromarray(np.dstack([rgb, alpha]), "RGBA").save(path)


def quiet(fn, *args):
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*args)


class PrintWeight(unittest.TestCase):
    def setUp(self):
        (ROOT / ".cache").mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT / ".cache", prefix="test-print-weight-")
        base = Path(self.tmp.name)
        self.web, self.orig = base / "web", base / "originals"
        self.dir = self.web / DIR
        self.dir.mkdir(parents=True)
        self.saved = (pw.ROOT, pw.WEB, pw.ORIGINALS)
        pw.ROOT, pw.WEB, pw.ORIGINALS = base, self.web, self.orig
        self.png = self.dir / "lantern.png"
        art(self.png)
        (self.dir / "lantern.json").write_text(json.dumps({"sha256": sha(self.png), "prompt": "a lantern"}))

    def tearDown(self):
        pw.ROOT, pw.WEB, pw.ORIGINALS = self.saved
        self.tmp.cleanup()

    def sidecar(self):
        return json.loads((self.dir / "lantern.json").read_text())

    def test_check_names_the_offender_and_write_repairs_it(self):
        self.assertEqual(quiet(pw.check, [DIR]), 1)
        self.assertEqual(quiet(pw.write, [DIR], False), 0)
        wrapper = self.dir / "lantern.pdf"
        self.assertFalse(self.png.exists())
        self.assertTrue(wrapper.exists())
        kept = self.orig / DIR / "lantern.png"
        self.assertTrue(kept.exists())
        side = self.sidecar()
        self.assertEqual(side["print_master"]["source_sha256"], side["sha256"])
        self.assertEqual(side["print_master"]["source_sha256"], sha(kept))
        self.assertEqual(side["print_master"]["sha256"], sha(wrapper))
        self.assertLessEqual(max(side["print_master"]["pixels"]), pw.POLICY[DIR]["cap"])
        self.assertLessEqual(wrapper.stat().st_size, pw.POLICY[DIR]["budget"])
        self.assertEqual(quiet(pw.check, [DIR]), 0)
        import fitz
        with fitz.open(wrapper) as doc:
            xref = doc[0].get_images(full=True)[0][0]
            self.assertEqual(doc.xref_get_key(xref, "Filter"), ("name", "/DCTDecode"))
            self.assertEqual(doc.xref_get_key(xref, "SMask")[0], "xref")

    def test_a_second_write_changes_nothing(self):
        quiet(pw.write, [DIR], False)
        before = sha(self.dir / "lantern.pdf"), self.sidecar()
        quiet(pw.write, [DIR], False)
        self.assertEqual((sha(self.dir / "lantern.pdf"), self.sidecar()), before)

    def test_force_rederives_from_the_kept_original(self):
        quiet(pw.write, [DIR], False)
        source = self.sidecar()["print_master"]["source_sha256"]
        quiet(pw.write, [DIR], True)
        side = self.sidecar()
        self.assertEqual(side["print_master"]["source_sha256"], source)
        self.assertEqual(side["print_master"]["sha256"], sha(self.dir / "lantern.pdf"))

    def test_a_kept_original_without_a_record_is_not_mistaken_for_a_replacement(self):
        quiet(pw.write, [DIR], False)
        kept = self.orig / DIR / "lantern.png"
        kept_sha = sha(kept)
        ledger = pw.load_ledger()
        del ledger["derivatives"][f"{DIR}/lantern"]  # a derivative made before the ledger existed
        pw.save_ledger(ledger)
        quiet(pw.write, [DIR], True)
        self.assertEqual(sha(kept), kept_sha, "the kept original survives a --force run with no recorded digest")
        self.assertEqual(self.sidecar()["print_master"]["source_sha256"], kept_sha)

    def test_a_derivative_that_fails_a_tightened_policy_is_repaired_without_force(self):
        quiet(pw.write, [DIR], False)
        saved = dict(pw.POLICY[DIR])
        try:
            pw.POLICY[DIR]["cap"] = 400
            self.assertEqual(quiet(pw.check, [DIR]), 1)
            self.assertEqual(quiet(pw.write, [DIR], False), 0)
            self.assertLessEqual(max(self.sidecar()["print_master"]["pixels"]), 400)
            self.assertEqual(quiet(pw.check, [DIR]), 0)
        finally:
            pw.POLICY[DIR] = saved

    def test_check_fails_a_derivative_changed_by_hand(self):
        quiet(pw.write, [DIR], False)
        wrapper = self.dir / "lantern.pdf"
        wrapper.write_bytes(wrapper.read_bytes() + b"\n%hand-edited")
        self.assertEqual(quiet(pw.check, [DIR]), 1)

    def test_a_replacement_supersedes_the_kept_original(self):
        quiet(pw.write, [DIR], False)
        old_original = sha(self.orig / DIR / "lantern.png")
        art(self.png, seed=2)  # new art, same slug, dropped at the governed path
        new_sha = sha(self.png)
        self.assertNotEqual(new_sha, old_original)
        self.assertEqual(quiet(pw.write, [DIR], False), 0)
        self.assertFalse(self.png.exists())
        self.assertEqual(sha(self.orig / DIR / "lantern.png"), new_sha)
        side = self.sidecar()
        self.assertEqual(side["print_master"]["source_sha256"], new_sha)
        self.assertEqual(side["print_master"]["sha256"], sha(self.dir / "lantern.pdf"))
        self.assertEqual(quiet(pw.check, [DIR]), 0)


if __name__ == "__main__":
    unittest.main()
