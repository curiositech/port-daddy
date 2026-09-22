"""Tests for book-evidence-writing skill bundle and editorial quality gates."""

import os
import re
from pathlib import Path
import pytest
import yaml

SKILL_DIR = Path(__file__).resolve().parents[1]


def test_frontmatter_structure():
    skill_md = SKILL_DIR / "SKILL.md"
    assert skill_md.exists()
    content = skill_md.read_text(encoding="utf-8")
    parts = content.split("---", 2)
    assert len(parts) >= 3, "Frontmatter must be enclosed by ---"
    
    fm = yaml.safe_load(parts[1])
    assert fm.get("name") == "book-evidence-writing"
    assert "description" in fm
    assert fm.get("license") == "Apache-2.0"
    assert "allowed-tools" in fm
    assert "metadata" in fm
    
    metadata = fm["metadata"]
    assert metadata.get("category") == "Writing & Publishing"
    assert "tags" in metadata
    assert "provenance" in metadata
    assert "pairs-with" in metadata
    assert "io-contract" in metadata


def test_required_files_exist():
    assert (SKILL_DIR / "README.md").exists()
    assert (SKILL_DIR / "CHANGELOG.md").exists()
    assert (SKILL_DIR / "references" / "INDEX.md").exists()
    assert (SKILL_DIR / "references" / "01-argument-inspection.md").exists()
    assert (SKILL_DIR / "references" / "02-marginalia-and-cues.md").exists()
    assert (SKILL_DIR / "examples" / "INDEX.md").exists()
    assert (SKILL_DIR / "examples" / "adr-to-inspectable-argument.md").exists()


def test_detect_forbidden_adr_citations():
    """Editorial gate: Flag private ADR citations in reader-facing manuscript text."""
    bad_text = "As established in ADR-0049 and PR #340, we deploy an edge relay."
    pattern = re.compile(r"\b(?:ADR-\d{4}|PR\s*#\d+)\b", re.IGNORECASE)
    assert pattern.search(bad_text) is not None
    
    clean_text = "The edge relay federates pub/sub topics across isolated hosts."
    assert pattern.search(clean_text) is None


def test_detect_bare_margin_cues():
    """Editorial gate: Bare cues like 'Pitfall!' or 'Key idea' are prohibited."""
    bare_pattern = re.compile(r"^\s*(?:Pitfall!?|Key idea!?|Note:|Warning:)\s*$", re.IGNORECASE | re.MULTILINE)
    
    bad_margin = "Pitfall!"
    assert bare_pattern.search(bad_margin) is not None
    
    good_margin = "A restore can silently resurrect a revoked card."
    assert bare_pattern.search(good_margin) is None
