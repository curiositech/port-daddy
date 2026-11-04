#!/usr/bin/env python3
"""Source-package regressions; synthetic fixtures never run the daemon."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("book_source", ROOT / "scripts/build-book-source.py")
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class SourceBundleTests(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / ".cache/book-source-tests"
        scratch.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=scratch)
        self.root = Path(self.temporary.name)
        for name in bundle.REQUIRED + bundle.HELPERS:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture\n")
        (self.root / "book/textbook.json").write_text(json.dumps({"chapters": [{"source": "book/chapter.tex"}]}))
        (self.root / "book/chapter.tex").write_text("A complete synthetic chapter.\n")
        (self.root / "book/fonts/manifest.json").write_text('{"files":[]}')
        self.archive = self.root / "out/source.tar.gz"
        self.receipt = self.root / bundle.RECEIPT

    def tearDown(self):
        self.temporary.cleanup()

    def build(self):
        return bundle.build(self.root, self.archive, self.receipt)

    def test_determinism_ignores_source_mtime_and_permissions(self):
        first = self.build()
        content = self.archive.read_bytes()
        path = self.root / "book/chapter.tex"
        os.utime(path, (42, 42))
        path.chmod(0o600)
        self.assertEqual(first, self.build())
        self.assertEqual(content, self.archive.read_bytes())
        with tarfile.open(self.archive) as archive:
            self.assertEqual(archive.getnames(), sorted(archive.getnames()))
            self.assertTrue(all(row.uid == 0 and row.mtime == bundle.EPOCH for row in archive))

    def test_changed_and_new_source_fail_freshness(self):
        self.build()
        bundle.check(self.root, self.receipt)
        chapter = self.root / "book/chapter.tex"
        original = chapter.read_bytes()
        chapter.write_text("Changed chapter\n")
        with self.assertRaisesRegex(ValueError, "stale"):
            bundle.check(self.root, self.receipt)
        chapter.write_bytes(original)
        (self.root / "book/new-figure.tex").write_text("New authored input\n")
        with self.assertRaisesRegex(ValueError, "stale"):
            bundle.check(self.root, self.receipt)

    def test_missing_chapter_and_external_registry_path_fail(self):
        (self.root / "book/chapter.tex").unlink()
        with self.assertRaisesRegex(ValueError, "Chapter is not contained"):
            self.build()
        (self.root / "book/textbook.json").write_text('{"chapters":[{"source":"../external.tex"}]}')
        with self.assertRaisesRegex(ValueError, "Unsafe source path"):
            self.build()

    def test_symlinks_lfs_pointers_and_private_fonts_fail(self):
        path = self.root / "book/link.tex"
        path.symlink_to(self.root / "book/chapter.tex")
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.build()
        path.unlink()
        path.write_text("version https://git-lfs.github.com/spec/v1\noid sha256:abc\n")
        with self.assertRaisesRegex(ValueError, "Git LFS"):
            self.build()
        path.unlink()
        (self.root / "book/SuisseIntl-Regular.otf").write_bytes(b"OTTO")
        with self.assertRaisesRegex(ValueError, "Private Suisse"):
            self.build()

    def test_extract_verifies_hashes_and_refuses_existing_destination(self):
        self.build()
        destination = self.root / "clean"
        extracted = bundle.extract(self.archive, destination)
        self.assertFalse((extracted / ".git").exists())
        bundle.verify_extracted(extracted)
        unexpected = extracted / "book/injected.tex"
        unexpected.write_text("An unlisted extra input")
        with self.assertRaisesRegex(ValueError, "unlisted"):
            bundle.verify_extracted(extracted)
        unexpected.unlink()
        with self.assertRaisesRegex(ValueError, "already exists"):
            bundle.extract(self.archive, destination)
        (extracted / "book/chapter.tex").write_text("Corruption")
        with self.assertRaisesRegex(ValueError, "integrity mismatch"):
            bundle.verify_extracted(extracted)

    def test_archive_traversal_and_link_rejected_before_writing(self):
        for name, kind in [("../escape", tarfile.REGTYPE), (bundle.PREFIX + "/link", tarfile.SYMTYPE)]:
            archive_path = self.root / "malicious.tar.gz"
            with tarfile.open(archive_path, "w:gz") as archive:
                member = tarfile.TarInfo(name)
                member.type = kind
                member.linkname = "/outside"
                archive.addfile(member, io.BytesIO())
            destination = self.root / "unsafe"
            with self.assertRaises(ValueError):
                bundle.extract(archive_path, destination)
            self.assertFalse(destination.exists())

    def test_redirect_block_preserves_other_rules_and_is_checked(self):
        path = self.root / "website-v2/public/_redirects"
        path.parent.mkdir(parents=True, exist_ok=True)
        original = "/existing /destination 301\n/* /index.html 200\n"
        path.write_text(original)
        receipt = self.build()
        self.assertTrue(path.read_text().endswith(original))
        self.assertIn(receipt["archive"]["url"], path.read_text())
        path.write_text(path.read_text().replace(receipt["archive"]["url"], "https://example.org/wrong"))
        with self.assertRaisesRegex(ValueError, "redirects"):
            bundle.check(self.root, self.receipt)

    def test_open_profile_does_not_discover_private_font_directory(self):
        # The helper normally discovers fonts under the user's home. An explicit
        # public proof must work even when that directory happens to exist.
        candidate = self.root / "coding/tmp/book-private-fonts/suisse-intl-20260918/Suisse Intl/OTF"
        candidate.mkdir(parents=True)
        font_spec = importlib.util.spec_from_file_location("prepare_fonts", ROOT / "scripts/prepare-book-fonts.py")
        fonts = importlib.util.module_from_spec(font_spec)
        font_spec.loader.exec_module(fonts)
        from unittest.mock import patch
        out = self.root / "font-config"
        with patch.object(fonts.Path, "home", return_value=self.root), \
             patch.dict(os.environ, {"PD_BOOK_FONT_PROFILE": "open-proof", "PD_BOOK_FONT_DIR": ""}), \
             patch.object(sys, "argv", ["prepare-book-fonts.py", str(out)]):
            fonts.main()
        self.assertEqual(json.loads((out / "book-font-profile.json").read_text())["profile"], "open-proof")
        with self.assertRaisesRegex(ValueError, "Remove PD_BOOK_FONT_DIR"):
            fonts.configuration("open-proof", str(candidate))


if __name__ == "__main__":
    unittest.main()
