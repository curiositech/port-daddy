#!/usr/bin/env python3
"""
Unit tests validating that all canonical diagram family templates in
skills/harbor-figure-style-guide/templates/ satisfy:
1. Harbor Figure Style standards (S1-S9 via check_figure_style.py)
2. Mechanical geometric clearance and zero collisions (via check_figure_clearance.py)
"""

import unittest
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[3]
STYLE_SCRIPT_DIR = REPO_ROOT / "skills/harbor-figure-style-guide/scripts"
sys.path.insert(0, str(STYLE_SCRIPT_DIR))

from check_figure_style import audit_tex_source
from check_figure_clearance import audit_figure_clearance

TEMPLATES_DIR = REPO_ROOT / "skills/harbor-figure-style-guide/templates"

class TestAllDiagramFamilies(unittest.TestCase):
    """Test suite for all 7 canonical diagram family templates."""

    def setUp(self):
        self.assertTrue(TEMPLATES_DIR.exists(), f"Templates dir not found: {TEMPLATES_DIR}")

    def test_state_machine_template(self):
        """State Machine template must pass style and clearance checks."""
        path = TEMPLATES_DIR / "state-machine.tex"
        self.assertTrue(path.exists(), f"Missing template: {path}")

        style_report = audit_tex_source(path, strict=True)
        self.assertTrue(style_report.passed, f"Style findings: {style_report.findings}")

        clearance_report = audit_figure_clearance(path)
        self.assertEqual(clearance_report.status, "PASS", f"Clearance violations: {clearance_report.violations}")

    def test_swimlanes_gantt_template(self):
        """Swimlanes Gantt template must pass style and clearance checks."""
        path = TEMPLATES_DIR / "swimlanes-gantt.tex"
        self.assertTrue(path.exists(), f"Missing template: {path}")

        style_report = audit_tex_source(path, strict=True)
        self.assertTrue(style_report.passed, f"Style findings: {style_report.findings}")

        clearance_report = audit_figure_clearance(path)
        self.assertEqual(clearance_report.status, "PASS", f"Clearance violations: {clearance_report.violations}")

    def test_dag_causal_tree_template(self):
        """DAG Causal Tree template must pass style and clearance checks."""
        path = TEMPLATES_DIR / "dag-causal-tree.tex"
        self.assertTrue(path.exists(), f"Missing template: {path}")

        style_report = audit_tex_source(path, strict=True)
        self.assertTrue(style_report.passed, f"Style findings: {style_report.findings}")

        clearance_report = audit_figure_clearance(path)
        self.assertEqual(clearance_report.status, "PASS", f"Clearance violations: {clearance_report.violations}")

    def test_pgfplots_regime_template(self):
        """PGFPlots Quantitative Regime template must pass style and clearance checks."""
        path = TEMPLATES_DIR / "pgfplots-regime.tex"
        self.assertTrue(path.exists(), f"Missing template: {path}")

        style_report = audit_tex_source(path, strict=True)
        self.assertTrue(style_report.passed, f"Style findings: {style_report.findings}")

        clearance_report = audit_figure_clearance(path)
        self.assertEqual(clearance_report.status, "PASS", f"Clearance violations: {clearance_report.violations}")

    def test_record_byte_layout_template(self):
        """Record Byte Layout template must pass style and clearance checks."""
        path = TEMPLATES_DIR / "record-byte-layout.tex"
        self.assertTrue(path.exists(), f"Missing template: {path}")

        style_report = audit_tex_source(path, strict=True)
        self.assertTrue(style_report.passed, f"Style findings: {style_report.findings}")

        clearance_report = audit_figure_clearance(path)
        self.assertEqual(clearance_report.status, "PASS", f"Clearance violations: {clearance_report.violations}")

    def test_before_after_pair_template(self):
        """Before/After Pair template must pass style and clearance checks."""
        path = TEMPLATES_DIR / "before-after-pair.tex"
        self.assertTrue(path.exists(), f"Missing template: {path}")

        style_report = audit_tex_source(path, strict=True)
        self.assertTrue(style_report.passed, f"Style findings: {style_report.findings}")

        clearance_report = audit_figure_clearance(path)
        self.assertEqual(clearance_report.status, "PASS", f"Clearance violations: {clearance_report.violations}")

    def test_sequence_protocol_template(self):
        """Sequence Protocol template must pass style and clearance checks."""
        path = TEMPLATES_DIR / "sequence-protocol.tex"
        self.assertTrue(path.exists(), f"Missing template: {path}")

        style_report = audit_tex_source(path, strict=True)
        self.assertTrue(style_report.passed, f"Style findings: {style_report.findings}")

        clearance_report = audit_figure_clearance(path)
        self.assertEqual(clearance_report.status, "PASS", f"Clearance violations: {clearance_report.violations}")


if __name__ == "__main__":
    unittest.main()
