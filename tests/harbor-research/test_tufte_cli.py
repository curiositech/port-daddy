#!/usr/bin/env python3
"""Fixture-based tests for skills/tufte-evidence-design/scripts/tufte.py.

stdlib-only (unittest, tempfile, subprocess, zlib, struct -- no pymupdf, no
Pillow). Runs the real CLI as a subprocess against small fixtures under a
tempdir, the same pattern as test_margin_lint.py and
test_check_marginalia_sidecars.py. The library-checks CI job that runs this
directory's tests has no pymupdf installed (only the figures job does), so
this file writes its own synthetic PNGs with a tiny stdlib encoder rather
than reaching for PyMuPDF or Pillow.

Run:
    python3 -m unittest discover -s tests/harbor-research
    python3 tests/harbor-research/test_tufte_cli.py
"""
from __future__ import annotations

import json
import struct
import subprocess
import sys
import unittest
import zlib
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parents[2]
CLI = REPO_ROOT / "skills" / "tufte-evidence-design" / "scripts" / "tufte.py"


def run_cli(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(CLI), *args], capture_output=True, text=True)


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_rgb_png(path: Path, width: int, height: int, pixel_fn) -> None:
    """A minimal, dependency-free 8-bit truecolor (non-interlaced, filter-none)
    PNG encoder -- ink_audit.py already carries the matching stdlib decoder,
    this is just its write-side counterpart for test fixtures."""
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type 0 (None) for every scanline
        for x in range(width):
            r, g, b = pixel_fn(x, y)
            raw += bytes((r, g, b))
    idat = zlib.compress(bytes(raw), 9)
    png = sig + _png_chunk(b"IHDR", ihdr) + _png_chunk(b"IDAT", idat) + _png_chunk(b"IEND", b"")
    Path(path).write_bytes(png)


def write_all_ink_png(path: Path) -> None:
    """A synthetic PNG with no single dominant color (many equal-sized
    vertical stripes, each a distinct color), so ink_audit's auto-detected
    background is a small minority and ink_fraction reads high -- the same
    construction figcheck's own ink-metrics test uses, built here with the
    stdlib PNG encoder above instead of PyMuPDF."""
    n = 25
    width = 200

    def pixel_fn(x, y):
        i = min(x * n // width, n - 1)
        return ((i * 37) % 256, (i * 91) % 256, (i * 151) % 256)

    write_rgb_png(path, width, 200, pixel_fn)


def write_blank_png(path: Path) -> None:
    write_rgb_png(path, 200, 200, lambda x, y: (255, 255, 255))


def run_cli_without_pillow(args: list[str]) -> subprocess.CompletedProcess:
    """Run the CLI in a child process where `import PIL` fails, so ink_audit
    must take its stdlib PNG decoder rather than Pillow."""
    import os
    with TemporaryDirectory() as shim:
        (Path(shim) / "PIL.py").write_text("raise ImportError('Pillow deliberately unavailable in this test')\n", encoding="utf-8")
        env = dict(os.environ)
        env["PYTHONPATH"] = shim + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
        return subprocess.run([sys.executable, str(CLI), *args], capture_output=True, text=True, env=env)


class TestStdlibDecoderFallback(unittest.TestCase):
    """ink_audit degrades to its own PNG decoder when Pillow is absent, and
    reads the same numbers off the same file either way."""

    def test_audit_runs_without_pillow(self) -> None:
        with TemporaryDirectory() as tmp:
            png = Path(tmp) / "allink.png"
            write_all_ink_png(png)
            result = run_cli_without_pillow(["audit", str(png), "--json"])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertIn("ink_fraction", result.stdout)

    def test_numbers_agree_with_and_without_pillow(self) -> None:
        with TemporaryDirectory() as tmp:
            png = Path(tmp) / "allink.png"
            write_all_ink_png(png)
            with_pillow = run_cli(["audit", str(png), "--json"])
            without = run_cli_without_pillow(["audit", str(png), "--json"])
            self.assertEqual(with_pillow.returncode, 0, msg=with_pillow.stderr)
            self.assertEqual(without.returncode, 0, msg=without.stderr)
            a = json.loads(with_pillow.stdout)
            b = json.loads(without.stdout)
            self.assertEqual(a[0]["ink_fraction"], b[0]["ink_fraction"])


class TestAuditSubcommand(unittest.TestCase):
    def test_audit_clean_image_exits_zero_even_without_strict(self) -> None:
        with TemporaryDirectory() as tmp:
            png = Path(tmp) / "blank.png"
            write_blank_png(png)
            result = run_cli(["audit", str(png)])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)

    def test_audit_flagged_image_exits_zero_without_strict(self) -> None:
        with TemporaryDirectory() as tmp:
            png = Path(tmp) / "allink.png"
            write_all_ink_png(png)
            result = run_cli(["audit", str(png)])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertIn("high for a data graphic", result.stdout)

    def test_audit_flagged_image_exits_nonzero_with_strict(self) -> None:
        with TemporaryDirectory() as tmp:
            png = Path(tmp) / "allink.png"
            write_all_ink_png(png)
            result = run_cli(["audit", str(png), "--strict"])
            self.assertEqual(result.returncode, 1)

    def test_audit_missing_file_exits_nonzero(self) -> None:
        result = run_cli(["audit", "/no/such/file.png"])
        self.assertEqual(result.returncode, 1)
        self.assertIn("no such file", result.stdout)

    def test_audit_json_output_is_parseable(self) -> None:
        with TemporaryDirectory() as tmp:
            png = Path(tmp) / "blank.png"
            write_blank_png(png)
            result = run_cli(["audit", str(png), "--json"])
            self.assertEqual(result.returncode, 0)
            data = json.loads(result.stdout)
            self.assertEqual(len(data), 1)
            self.assertIn("ink_fraction", data[0])


class TestMarginLintSubcommand(unittest.TestCase):
    def test_delegates_to_margin_lint_and_passes_repo_root(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = repo / "ch.tex"
            chapter.write_text(
                "\\section{Intro}\nPlain prose, no margin apparatus.\n",
                encoding="utf-8",
            )
            result = run_cli(["margin-lint", str(chapter), "--repo-root", str(repo)])
            self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
            self.assertIn("no findings", result.stdout)

    def test_delegates_a_real_violation(self) -> None:
        with TemporaryDirectory() as tmp:
            repo = Path(tmp)
            chapter = repo / "ch.tex"
            chapter.write_text(
                "\\section{Intro}\nA claim needs provenance.\\footnote{elsewhere.}\n",
                encoding="utf-8",
            )
            result = run_cli(["margin-lint", str(chapter), "--repo-root", str(repo), "--json"])
            self.assertEqual(result.returncode, 0)  # footnote rule is advisory
            findings = json.loads(result.stdout)
            self.assertEqual(findings[0]["rule"], "no-footnote-in-body")


class TestChecklistSubcommand(unittest.TestCase):
    def test_no_argument_lists_kinds(self) -> None:
        result = run_cli(["checklist"])
        self.assertEqual(result.returncode, 0)
        self.assertIn("sparklines", result.stdout)
        self.assertIn("margin-apparatus", result.stdout)

    def test_sparklines_kind_prints_its_checklist(self) -> None:
        result = run_cli(["checklist", "sparklines"])
        self.assertEqual(result.returncode, 0)
        self.assertIn("word/line-height sized", result.stdout)

    def test_unknown_kind_exits_nonzero(self) -> None:
        result = run_cli(["checklist", "not-a-real-kind-at-all"])
        self.assertEqual(result.returncode, 2)


class TestDecisionTreeSubcommand(unittest.TestCase):
    def test_prints_the_mermaid_flowchart(self) -> None:
        result = run_cli(["decision-tree"])
        self.assertEqual(result.returncode, 0)
        self.assertIn("flowchart TD", result.stdout)
        self.assertIn("critiques-and-limits.md", result.stdout)


class TestUsageErrors(unittest.TestCase):
    def test_no_subcommand_exits_nonzero(self) -> None:
        result = run_cli([])
        self.assertNotEqual(result.returncode, 0)

    def test_unknown_subcommand_exits_nonzero(self) -> None:
        result = run_cli(["not-a-subcommand"])
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
