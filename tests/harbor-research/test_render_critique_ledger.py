"""The critique renderer must refuse to overwrite a divergent projection."""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[2]
SCRIPT_DIR = REPO / "scripts" / "harbor-research"
SCRIPT = SCRIPT_DIR / "render_critique_ledger.py"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
spec = importlib.util.spec_from_file_location("render_critique_ledger", SCRIPT)
renderer = importlib.util.module_from_spec(spec)
assert spec and spec.loader
sys.modules[spec.name] = renderer
spec.loader.exec_module(renderer)


class ProjectionAuthorityTests(unittest.TestCase):
    def test_divergent_projection_fails_without_mutation(self):
        canonical = [{"#": "CA-001", "Status": "Open"}]
        edited_projection = [{"#": "CA-001", "Status": "Resolved"}]
        with tempfile.TemporaryDirectory(dir=REPO) as temp_dir:
            root = Path(temp_dir)
            json_path = root / "critique-ledger.json"
            md_path = root / "CRITIQUE-LEDGER.md"
            json_path.write_text(json.dumps(edited_projection), encoding="utf-8")
            md_before = b"original markdown bytes\n"
            md_path.write_bytes(md_before)
            json_before = json_path.read_bytes()

            with (
                mock.patch.object(renderer, "JSON_PATH", json_path),
                mock.patch.object(renderer, "MD_PATH", md_path),
                mock.patch.object(renderer.omni_ledger, "load", return_value={"critique_rows": canonical}),
                mock.patch.object(renderer.omni_ledger, "document_text") as read_markdown,
                mock.patch.object(renderer.omni_ledger, "update_document") as update_document,
                mock.patch.object(sys, "argv", [str(SCRIPT)]),
            ):
                error = io.StringIO()
                with contextlib.redirect_stderr(error), self.assertRaises(SystemExit) as raised:
                    renderer.main()

            self.assertEqual(raised.exception.code, 2)
            self.assertIn("no files were changed", error.getvalue())
            self.assertIn("omni-ledger.json", error.getvalue())
            self.assertEqual(json_path.read_bytes(), json_before)
            self.assertEqual(md_path.read_bytes(), md_before)
            read_markdown.assert_not_called()
            update_document.assert_not_called()


if __name__ == "__main__":
    unittest.main()
