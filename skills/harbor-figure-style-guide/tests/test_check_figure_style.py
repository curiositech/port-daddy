#!/usr/bin/env python3
"""Unit tests for check_figure_style.py."""

import tempfile
import unittest
from pathlib import Path
import sys

# Add script dir to sys.path
SCRIPT_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPT_DIR))

import check_figure_style as cfs


class TestCheckFigureStyle(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp_dir.name)

    def tearDown(self):
        self.temp_dir.cleanup()

    def _write_temp_tex(self, filename: str, content: str) -> Path:
        file_path = self.temp_path / filename
        file_path.write_text(content, encoding="utf-8")
        return file_path

    def test_compliant_figure_passes(self):
        content = """% Figure 1.1: Canonical compliant sequence diagram
\\begin{tikzpicture}[pd figure, x=1cm, y=1cm]
  \\useasboundingbox (0, 0) rectangle (11.4, 6.0);
  \\node[pd focus state, text width=3cm] (a) at (2, 5) {\\textbf{Manager}};
  \\node[pd state, text width=3cm] (b) at (8, 5) {\\textbf{Contractor}};
  \\draw[pd focus rule] (a) -- (b) node[pos=0.5, above=2pt] {1. CFP Broadcast};
  \\draw[pd rule] (b) -- (a) node[pos=0.5, above=2pt] {2. Formal Bid};
\\end{tikzpicture}
"""
        tex_file = self._write_temp_tex("compliant.tex", content)
        report = cfs.audit_tex_source(tex_file)
        self.assertTrue(report.passed)
        self.assertEqual(len([f for f in report.findings if f.severity == "FAIL"]), 0)
        self.assertIsNotNone(report.bounding_box)
        self.assertAlmostEqual(report.bounding_box[2] - report.bounding_box[0], 11.4)

    def test_font_size_violations_fail(self):
        content = """% Non-compliant figure with tiny font
\\begin{tikzpicture}[pd figure]
  \\node at (0, 0) {\\tiny Microscopic text};
  \\node at (2, 0) {\\scriptsize Small text};
  \\node at (4, 0) {\\fontsize{5}{6}\\selectfont Custom text};
\\end{tikzpicture}
"""
        tex_file = self._write_temp_tex("bad_fonts.tex", content)
        report = cfs.audit_tex_source(tex_file)
        self.assertFalse(report.passed)
        rule_ids = {f.rule_id for f in report.findings if f.severity == "FAIL"}
        self.assertIn("S2-font-tiny", rule_ids)
        self.assertIn("S2-font-scriptsize", rule_ids)
        self.assertIn("S2-fontsize-override", rule_ids)

    def test_serif_font_leaks_fail(self):
        content = """% Non-compliant figure with serif leak
\\begin{tikzpicture}[pd figure]
  \\node at (0, 0) {\\rmfamily Palatino text};
  \\node at (2, 0) {\\textrm{Roman text}};
  \\node at (4, 0) {\\normalfont Resets to body serif};
\\end{tikzpicture}
"""
        tex_file = self._write_temp_tex("serif_leaks.tex", content)
        report = cfs.audit_tex_source(tex_file)
        self.assertFalse(report.passed)
        rule_ids = {f.rule_id for f in report.findings if f.severity == "FAIL"}
        self.assertIn("S2-serif-leak", rule_ids)
        self.assertIn("S2-normalfont-reset", rule_ids)

    def test_raw_unthemed_colors_fail(self):
        content = """% Figure with raw unapproved colors
\\begin{tikzpicture}[pd figure]
  \\draw[draw=red, fill=blue] (0, 0) rectangle (2, 2);
  \\node[text=green] at (1, 1) {Raw color};
\\end{tikzpicture}
"""
        tex_file = self._write_temp_tex("raw_colors.tex", content)
        report = cfs.audit_tex_source(tex_file)
        self.assertFalse(report.passed)
        rule_ids = {f.rule_id for f in report.findings if f.severity == "FAIL"}
        self.assertIn("S3-raw-color", rule_ids)

    def test_palette_overload_fails(self):
        content = """% Figure using 5 concept hues
\\begin{tikzpicture}[pd figure]
  \\node[color=pdcobalt] at (0, 0) {1};
  \\node[color=pdteal] at (1, 0) {2};
  \\node[color=pdindigo] at (2, 0) {3};
  \\node[color=pdviolet] at (3, 0) {4};
  \\node[color=pdrust] at (4, 0) {5};
\\end{tikzpicture}
"""
        tex_file = self._write_temp_tex("overloaded_palette.tex", content)
        report = cfs.audit_tex_source(tex_file)
        self.assertFalse(report.passed)
        rule_ids = {f.rule_id for f in report.findings if f.severity == "FAIL"}
        self.assertIn("S3-palette-overload", rule_ids)

    def test_oversized_measure_fails(self):
        content = """% Figure exceeding maximum full-width bounds
\\begin{tikzpicture}[pd figure]
  \\useasboundingbox (0, 0) rectangle (18.0, 10.0);
  \\node at (5, 5) {Oversized canvas};
\\end{tikzpicture}
"""
        tex_file = self._write_temp_tex("oversized.tex", content)
        report = cfs.audit_tex_source(tex_file)
        self.assertFalse(report.passed)
        rule_ids = {f.rule_id for f in report.findings if f.severity == "FAIL"}
        self.assertIn("S1-measure", rule_ids)

    def test_scaling_and_resizebox_fail(self):
        content = """% Figure using forbidden resizebox and scale
\\resizebox{\\textwidth}{!}{
  \\begin{tikzpicture}[pd figure, scale=0.8]
    \\node at (0, 0) {Scaled text};
  \\end{tikzpicture}
}
"""
        tex_file = self._write_temp_tex("scaled.tex", content)
        report = cfs.audit_tex_source(tex_file)
        self.assertFalse(report.passed)
        rule_ids = {f.rule_id for f in report.findings if f.severity == "FAIL"}
        self.assertIn("S1-scaling", rule_ids)

    def test_banned_diagram_types_fail(self):
        content = """% Figure using banned pie chart
\\begin{tikzpicture}
  \\pie{40/Category A, 60/Category B}
\\end{tikzpicture}
"""
        tex_file = self._write_temp_tex("pie.tex", content)
        report = cfs.audit_tex_source(tex_file)
        self.assertFalse(report.passed)
        rule_ids = {f.rule_id for f in report.findings if f.severity == "FAIL"}
        self.assertIn("Taxonomy-banned-form", rule_ids)


if __name__ == "__main__":
    unittest.main()
