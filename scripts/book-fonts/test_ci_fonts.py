#!/usr/bin/env python3
"""Round-trip and refusal tests for ci_fonts.py, with stand-in fonts.

No licensed bytes are needed: the pins are swapped for the digests of four
synthetic files, so the tests exercise every path CI and the uploader take.
"""
from __future__ import annotations

import base64
import hashlib
import io
import lzma
import os
import stat
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ci_fonts  # noqa: E402

NAMES = [f"SuisseIntl-{s}.otf" for s in ("Regular", "RegularItalic", "Semibold", "SemiboldItalic")]


def fake_font(name: str) -> bytes:
    # Incompressible enough to need several slices, like the real files.
    seed = hashlib.sha256(name.encode()).digest()
    blocks = [hashlib.sha256(seed + i.to_bytes(4, "big")).digest() for i in range(2000)]
    return b"OTTO" + b"".join(blocks)


class CourierTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.fonts = Path(self.tmp.name) / "fonts"
        self.fonts.mkdir()
        self.data = {name: fake_font(name) for name in NAMES}
        for name, data in self.data.items():
            (self.fonts / name).write_bytes(data)
        self.pins = {name: hashlib.sha256(data).hexdigest() for name, data in self.data.items()}
        patcher = mock.patch.object(ci_fonts, "pins", return_value=self.pins)
        patcher.start()
        self.addCleanup(patcher.stop)

    def env(self, parts):
        return {ci_fonts.slot(i): part for i, part in enumerate(parts)}

    def test_pack_is_deterministic(self):
        self.assertEqual(ci_fonts.pack(self.fonts, self.pins), ci_fonts.pack(self.fonts, self.pins))

    def test_every_slice_fits_a_secret(self):
        parts = ci_fonts.slices(ci_fonts.pack(self.fonts, self.pins))
        self.assertGreater(len(parts), 1)
        self.assertTrue(all(len(p) <= ci_fonts.SLICE < 48 * 1024 for p in parts))

    def test_round_trip_restores_exact_bytes_privately(self):
        parts = ci_fonts.slices(ci_fonts.pack(self.fonts, self.pins))
        dest = Path(self.tmp.name) / "restored"
        self.assertEqual(ci_fonts.restore(dest, self.env(parts)), 0)
        self.assertEqual(sorted(p.name for p in dest.iterdir()), sorted(NAMES))
        for name in NAMES:
            self.assertEqual((dest / name).read_bytes(), self.data[name])
            self.assertEqual(stat.S_IMODE((dest / name).stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(dest.stat().st_mode), 0o700)

    def test_no_secret_means_not_configured(self):
        self.assertEqual(ci_fonts.restore(Path(self.tmp.name) / "x", {}), ci_fonts.NOT_CONFIGURED)

    def test_a_missing_final_slice_is_refused(self):
        parts = ci_fonts.slices(ci_fonts.pack(self.fonts, self.pins))
        with self.assertRaisesRegex(ci_fonts.FontError, "do not reassemble"):
            ci_fonts.restore(Path(self.tmp.name) / "x", self.env(parts[:-1]))

    def test_a_gap_is_refused(self):
        parts = ci_fonts.slices(ci_fonts.pack(self.fonts, self.pins))
        env = self.env(parts)
        env[ci_fonts.slot(1)] = ""
        with self.assertRaisesRegex(ci_fonts.FontError, "earlier slice is empty"):
            ci_fonts.restore(Path(self.tmp.name) / "x", env)

    def test_reordered_slices_are_refused(self):
        parts = ci_fonts.slices(ci_fonts.pack(self.fonts, self.pins))
        parts[0], parts[1] = parts[1], parts[0]
        with self.assertRaises(ci_fonts.FontError):
            ci_fonts.restore(Path(self.tmp.name) / "x", self.env(parts))

    def test_a_substituted_font_is_refused_at_upload_and_restore(self):
        (self.fonts / NAMES[2]).write_bytes(fake_font("impostor"))
        with self.assertRaisesRegex(ci_fonts.FontError, "is not the pinned"):
            ci_fonts.pack(self.fonts, self.pins)
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w") as tar:
            for name in NAMES:
                data = (self.fonts / name).read_bytes()
                info = tarfile.TarInfo(name)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
        text = base64.b64encode(lzma.compress(buffer.getvalue())).decode()
        with self.assertRaisesRegex(ci_fonts.FontError, "is not the pinned"):
            ci_fonts.restore(Path(self.tmp.name) / "x", {ci_fonts.slot(0): text})

    def test_extra_or_traversing_members_are_refused(self):
        for name in ("../escape.otf", "SuisseIntl-Bold.otf"):
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode="w") as tar:
                info = tarfile.TarInfo(name)
                info.size = 4
                tar.addfile(info, io.BytesIO(b"OTTO"))
            text = base64.b64encode(lzma.compress(buffer.getvalue())).decode()
            with self.assertRaisesRegex(ci_fonts.FontError, "unexpected archive member"):
                ci_fonts.restore(Path(self.tmp.name) / "x", {ci_fonts.slot(0): text})

    def test_restore_refuses_a_destination_inside_the_repository(self):
        parts = ci_fonts.slices(ci_fonts.pack(self.fonts, self.pins))
        with self.assertRaisesRegex(ci_fonts.FontError, "outside the repository"):
            ci_fonts.restore(ci_fonts.ROOT / ".cache" / "fonts", self.env(parts))

    def test_upload_sets_slices_and_deletes_stale_ones(self):
        calls = []

        def fake_gh(args, stdin=None):
            calls.append((args, stdin))
            if args[:2] == ["secret", "list"]:
                return '[{"name":"BOOK_SUISSE_00"},{"name":"BOOK_SUISSE_11"},{"name":"OTHER"}]'
            return ""

        with mock.patch.object(ci_fonts, "gh", side_effect=fake_gh), \
             mock.patch.object(ci_fonts.shutil, "which", return_value="/usr/bin/gh"):
            self.assertEqual(ci_fonts.upload(self.fonts, "o/r", dry_run=False), 0)
        sets = [(a, s) for a, s in calls if a[:2] == ["secret", "set"]]
        parts = ci_fonts.slices(ci_fonts.pack(self.fonts, self.pins))
        self.assertEqual([a[2] for a, _ in sets], [ci_fonts.slot(i) for i in range(len(parts))])
        self.assertEqual([s for _, s in sets], parts)
        # The value travels on stdin, never in argv.
        self.assertTrue(all(s not in " ".join(a) for a, s in sets))
        deletes = [a[2] for a, _ in calls if a[:2] == ["secret", "delete"]]
        self.assertEqual(deletes, ["BOOK_SUISSE_11"])

    def test_the_workflows_name_every_slot(self):
        root = ci_fonts.ROOT
        workflow = (root / ".github/workflows/book-publication.yml").read_text()
        for index in range(ci_fonts.SLOTS):
            name = ci_fonts.slot(index)
            self.assertIn(f"{name}: ${{{{ secrets.{name} }}}}", workflow)
        self.assertNotIn(ci_fonts.slot(ci_fonts.SLOTS), workflow)

    def test_the_real_pins_name_the_four_styles(self):
        import json
        files = json.loads(ci_fonts.PINS_FILE.read_text())["files"]
        self.assertEqual(sorted(files), sorted(NAMES))
        self.assertTrue(all(len(v) == 64 and int(v, 16) >= 0 for v in files.values()))


if __name__ == "__main__":
    unittest.main()
