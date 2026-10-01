#!/usr/bin/env python3
"""Isolated integrity tests for the Harbor research ledger.

Every fixture lives under this linked worktree's .scratch directory. The real
manifest, archive, source documents, and retirement command are never touched.
"""
from __future__ import annotations

from contextlib import redirect_stdout
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
import omni_ledger as ledger


WORKTREE = Path(__file__).resolve().parents[2]
SCRATCH = WORKTREE / ".scratch" / "omni-ledger-tests"


class OmniLedgerFixture(unittest.TestCase):
    def setUp(self):
        SCRATCH.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=SCRATCH)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.base = self.root / "docs" / "harbor-research"
        self.base.mkdir(parents=True)
        self.data_path = self.base / "omni-ledger.json"
        self.archive_path = self.base / "omni-sources.zip"
        self.view_path = self.base / "OMNI-LEDGER.md"
        self.originals = {
            "docs/harbor-research/one.md": b"# One\nOriginal one.\n",
            "docs/harbor-research/two.md": b"# Two\nOriginal two.\n",
        }
        for name, raw in self.originals.items():
            p = self.root / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(raw)
        with zipfile.ZipFile(self.archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, raw in self.originals.items():
                archive.writestr(name, raw)
        sources = []
        for index, (name, raw) in enumerate(self.originals.items(), 1):
            sources.append({
                "id": f"SRC-{index:03d}", "path": name,
                "sha256": ledger.digest(raw), "bytes": len(raw),
                "disposition": "retire", "reason": "fixture", "tracked": True,
                "pages": 0, "text": raw.decode(),
                "text_sha256": ledger.digest(raw),
            })
        self.manifest = {
            "version": 1, "authority": "fixture", "scope": "fixture",
            "captured_head": "fixture", "archive_sha256": ledger.digest(self.archive_path.read_bytes()),
            "sources": sources,
            "records": [{
                "id": "work-1", "title": "A bounded check", "papers": ["paper1"],
                "kind": "research", "result": "One claim", "assumptions": [],
                "status": "open", "evidence": [], "next": "Check source",
                "acceptance": "Source checked", "depends_on": [],
                "sources": [{"path": "docs/harbor-research/one.md", "locator": "L1"}],
            }],
            "coverage": {
                "review_complete": True,
                "source_readers": {name: ["fixture-reader"] for name in self.originals},
            },
            "decisions": [],
            "retirement_complete": False,
        }
        self.save_manifest()
        patches = [
            patch.object(ledger, "ROOT", self.root),
            patch.object(ledger, "BASE", self.base),
            patch.object(ledger, "DATA", self.data_path),
            patch.object(ledger, "ARCHIVE", self.archive_path),
            patch.object(ledger, "VIEW", self.view_path),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        ledger._source_map.cache_clear()
        self.addCleanup(ledger._source_map.cache_clear)

    def save_manifest(self):
        self.data_path.write_text(json.dumps(self.manifest, indent=2) + "\n")

    def assert_originals_exist(self):
        for name, raw in self.originals.items():
            self.assertEqual((self.root / name).read_bytes(), raw)


class IntegrityTests(OmniLedgerFixture):
    def test_archive_corruption_prevents_every_deletion(self):
        with self.archive_path.open("ab") as archive:
            archive.write(b"tampered-after-capture")
        with self.assertRaisesRegex(ValueError, "Archive checksum"):
            ledger.retire()
        self.assert_originals_exist()
        self.assertFalse(ledger.load()["retirement_complete"])

    def test_changed_source_prevents_every_deletion(self):
        changed = self.root / "docs/harbor-research/two.md"
        changed.write_text("Changed after capture.\n")
        with self.assertRaisesRegex(ValueError, "Source changed since capture"):
            ledger.retire()
        self.assertEqual((self.root / "docs/harbor-research/one.md").read_bytes(),
                         self.originals["docs/harbor-research/one.md"])
        self.assertEqual(changed.read_text(), "Changed after capture.\n")
        self.assertFalse(ledger.load()["retirement_complete"])

    def test_traversal_is_rejected_by_document_apis(self):
        for path in ("../outside.md", "docs/harbor-research/../../outside.md"):
            with self.subTest(path=path):
                with self.assertRaises(ValueError):
                    ledger.document_text(path)
                with self.assertRaises(ValueError):
                    ledger.document_exists(path)
                with self.assertRaises(ValueError):
                    ledger.update_document(path, "tamper")
        self.assert_originals_exist()

    def test_duplicate_and_unknown_work_ids_fail_check(self):
        duplicate = dict(self.manifest["records"][0])
        self.manifest["records"].append(duplicate)
        self.manifest["records"][0]["depends_on"] = ["missing-work"]
        self.save_manifest()
        errors = ledger.check()
        self.assertTrue(any("Duplicate work IDs" in error for error in errors), errors)
        self.assertTrue(any("unknown dependency missing-work" in error for error in errors), errors)
        self.assert_originals_exist()

    def test_missing_retained_source_is_not_reported_as_existing(self):
        name = "docs/harbor-research/one.md"
        self.manifest["sources"][0]["disposition"] = "retain"
        self.save_manifest()
        ledger._source_map.cache_clear()
        (self.root / name).unlink()
        self.assertFalse(ledger.document_exists(name))
        with self.assertRaises(FileNotFoundError):
            ledger.document_text(name)

    def test_protected_paper_cannot_be_retired(self):
        old_name = "docs/harbor-research/one.md"
        new_name = "docs/harbor-research/paper8.tex"
        (self.root / old_name).rename(self.root / new_name)
        raw = self.originals.pop(old_name)
        self.originals[new_name] = raw
        self.manifest["sources"][0]["path"] = new_name
        self.manifest["records"][0]["sources"][0]["path"] = new_name
        self.manifest["coverage"]["source_readers"][new_name] = self.manifest["coverage"]["source_readers"].pop(old_name)
        with zipfile.ZipFile(self.archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, content in self.originals.items():
                archive.writestr(name, content)
        self.manifest["archive_sha256"] = ledger.digest(self.archive_path.read_bytes())
        self.save_manifest()
        errors = ledger.check()
        self.assertEqual(errors, [f"Protected paper cannot be retired: {new_name}"])
        with self.assertRaisesRegex(ValueError, "Protected paper cannot be retired"):
            ledger.retire()
        self.assert_originals_exist()

    def test_render_is_deterministic_and_document_update_stays_canonical(self):
        self.assertEqual(ledger.check(), [])
        ledger.render()
        first = self.view_path.read_bytes()
        ledger.render()
        self.assertEqual(first, self.view_path.read_bytes())
        ledger.update_document("docs/harbor-research/one.md", "# One\nRevised canonical source.\n")
        self.assertEqual(ledger.document_text("docs/harbor-research/one.md"),
                         "# One\nRevised canonical source.\n")
        self.assertEqual(ledger.check(), [])
        self.assertEqual(ledger.load()["sources"][0]["text"], "# One\nRevised canonical source.\n")
        self.assertNotIn(b"Revised canonical source.", self.view_path.read_bytes())
        self.assert_originals_exist()
        with zipfile.ZipFile(self.archive_path) as archive:
            self.assertEqual(archive.read("docs/harbor-research/one.md"),
                             self.originals["docs/harbor-research/one.md"])

    def test_check_detects_stale_markdown_projection(self):
        ledger.render()
        self.assertEqual(ledger.check(), [])
        self.view_path.write_text("stale projection\n")
        self.assertIn("Omni Markdown projection is stale; run render", ledger.check())
        ledger.render()
        self.assertEqual(ledger.check(), [])

    def test_retired_documents_remain_readable_after_fixture_retirement(self):
        with redirect_stdout(io.StringIO()):
            ledger.retire()
        self.assertTrue(ledger.load()["retirement_complete"])
        for name, raw in self.originals.items():
            self.assertFalse((self.root / name).exists())
            self.assertTrue(ledger.document_exists(name))
            self.assertEqual(ledger.document_text(name), raw.decode())
        self.assertTrue(set(self.originals).issubset(
            ledger.document_glob("docs/harbor-research/*.md")))
        self.assertEqual(ledger.check(), [])


if __name__ == "__main__":
    unittest.main()
