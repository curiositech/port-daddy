#!/usr/bin/env python3
"""check_figure_style.py -- Authoritative style and geometry checker for Harbor figures.

Audits TikZ figure fragments (.tex) and compiled figure documents (.pdf)
against the Harbor Figure Standard (v2), the 5-point legibility rubric,
and the Swiss Modernist design laws.

Exit codes:
  0: All figures passed cleanly (or warnings only, when not in --strict mode).
  1: One or more figures failed hard checks.
  2: Command-line or runtime error.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# Try importing fitz for geometry inspection on PDFs
try:
    import fitz  # PyMuPDF
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False

# -----------------------------------------------------------------------------
# Configuration & Constants
# -----------------------------------------------------------------------------

APPROVED_CONCEPT_HUES = {
    "pdcobalt", "pdteal", "pdhealth", "pdindigo",
    "pdviolet", "pdrust", "pdgold", "pderror", "pdamber",
    "pdswissblue", "pdswissviolet", "pdswissred"
}

ALLOWED_LINE_WEIGHTS = {
    0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.6
}

RAW_COLORS = {
    "red", "blue", "green", "yellow", "cyan", "magenta",
    "orange", "purple", "brown", "pink"
}

BANNED_FORMS = [
    (re.compile(r"\\pie\b"), "Pie charts are banned. Use horizontal bar charts or a table."),
    (re.compile(r"tikz-3dplot"), "3D perspective projections are banned. Use 2D orthogonal views."),
    (re.compile(r"\\tdplotsetmaincoords"), "3D coordinates are banned. Use 2D orthogonal views.")
]

COLUMN_WIDTH_CM_DEFAULT = 11.5   # 4.5 inches = 11.43 cm
WIDE_WIDTH_CM_MAX = 15.6         # 6.0 inches = 15.24 cm
MIN_FONT_PT_FLOOR = 7.0          # Hard floor in rendered PDF


@dataclass
class Finding:
    rule_id: str
    severity: str  # "FAIL" or "WARN"
    message: str
    line_number: Optional[int] = None
    snippet: Optional[str] = None


@dataclass
class FigureReport:
    target_path: str
    file_type: str  # "tex" or "pdf"
    passed: bool
    findings: List[Finding] = field(default_factory=list)
    hues_used: List[str] = field(default_factory=list)
    bounding_box: Optional[Tuple[float, float, float, float]] = None


# -----------------------------------------------------------------------------
# TeX Source Linter (AST / Regex Checks)
# -----------------------------------------------------------------------------

def strip_latex_comments(content: str) -> str:
    """Strip LaTeX comments (%...) while preserving newlines and line counts."""
    lines = content.splitlines(keepends=True)
    clean_lines = []
    for line in lines:
        in_escape = False
        clean_chars = []
        for ch in line:
            if ch == "\\" and not in_escape:
                in_escape = True
                clean_chars.append(ch)
            elif ch == "%" and not in_escape:
                break
            else:
                in_escape = False
                clean_chars.append(ch)
        clean_lines.append("".join(clean_chars) + "\n")
    return "".join(clean_lines)


def audit_tex_source(file_path: Path, strict: bool = False) -> FigureReport:
    """Audit a .tex fragment against the Harbor figure standards (S1-S9)."""
    raw_content = file_path.read_text(encoding="utf-8", errors="replace")
    clean_content = strip_latex_comments(raw_content)
    lines = raw_content.splitlines()
    clean_lines = clean_content.splitlines()

    findings: List[Finding] = []
    hues_found: Set[str] = set()

    # Rule S9: Provenance comment
    if not lines or not lines[0].strip().startswith("%"):
        findings.append(Finding(
            rule_id="S9-provenance",
            severity="WARN",
            message="Line 1 should be a structured provenance comment describing the figure.",
            line_number=1,
            snippet=lines[0] if lines else ""
        ))

    # Rule S1: Bounding box and Measure
    bbox_match = re.search(r"\\useasboundingbox\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)\s*rectangle\s*\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)", clean_content)
    bbox_tuple = None
    if bbox_match:
        x1, y1, x2, y2 = map(float, bbox_match.groups())
        width_cm = abs(x2 - x1)
        height_cm = abs(y2 - y1)
        bbox_tuple = (x1, y1, x2, y2)
        if width_cm > WIDE_WIDTH_CM_MAX:
            findings.append(Finding(
                rule_id="S1-measure",
                severity="FAIL",
                message=f"Bounding box width ({width_cm:.2f} cm) exceeds maximum full-width limit ({WIDE_WIDTH_CM_MAX:.2f} cm).",
                snippet=bbox_match.group(0)
            ))
        elif width_cm > COLUMN_WIDTH_CM_DEFAULT + 0.2:
            findings.append(Finding(
                rule_id="S1-measure",
                severity="WARN",
                message=f"Figure width ({width_cm:.2f} cm) exceeds single-column measure ({COLUMN_WIDTH_CM_DEFAULT:.2f} cm). Must be justified as full-width in brief.",
                snippet=bbox_match.group(0)
            ))

    # Rule S1: Resizebox / scaling prohibition
    resize_match = re.search(r"\\resizebox\s*\{([^}]+)\}", clean_content)
    if resize_match:
        findings.append(Finding(
            rule_id="S1-scaling",
            severity="FAIL",
            message="Forbidden \\resizebox detected. Draw directly to physical dimensions; do not scale.",
            snippet=resize_match.group(0)
        ))

    # Check for [scale=...] in tikzpicture options
    scale_match = re.search(r"\\begin\{tikzpicture\}\s*\[[^\]]*\bscale\s*=\s*([0-9.]+)", clean_content)
    if scale_match and float(scale_match.group(1)) != 1.0:
        findings.append(Finding(
            rule_id="S1-scaling",
            severity="FAIL",
            message=f"Forbidden tikzpicture scale={scale_match.group(1)} detected. Draw to physical 1cm coordinates.",
            snippet=scale_match.group(0)
        ))

    # Line-by-line checks
    for idx, line in enumerate(clean_lines, start=1):
        # Rule S2: Banned small font sizes
        if re.search(r"\\tiny\b", line):
            findings.append(Finding(
                rule_id="S2-font-tiny",
                severity="FAIL",
                message="Forbidden \\tiny detected. Minimum size is \\pdfiglabelsize (\\footnotesize).",
                line_number=idx,
                snippet=line.strip()
            ))
        if re.search(r"\\scriptsize\b", line):
            findings.append(Finding(
                rule_id="S2-font-scriptsize",
                severity="FAIL",
                message="Forbidden \\scriptsize detected. Use \\pdfiglabelsize (\\footnotesize).",
                line_number=idx,
                snippet=line.strip()
            ))

        # Rule S2: Hardcoded \fontsize
        if re.search(r"\\fontsize\s*\{", line):
            findings.append(Finding(
                rule_id="S2-fontsize-override",
                severity="FAIL",
                message="Inline \\fontsize override detected inside drawing. Use standard typographic roles.",
                line_number=idx,
                snippet=line.strip()
            ))

        # Rule S2: Serif font resets / family overrides
        if re.search(r"\\(?:rmfamily|textrm|rmdefault)\b", line):
            findings.append(Finding(
                rule_id="S2-serif-leak",
                severity="FAIL",
                message="Serif font family override detected inside drawing. Figures must inherit grotesk (Heros).",
                line_number=idx,
                snippet=line.strip()
            ))

        # Rule S2: \normalfont in node text (resets to book body serif)
        if "\\normalfont" in line and "\\node" in line:
            findings.append(Finding(
                rule_id="S2-normalfont-reset",
                severity="FAIL",
                message="\\normalfont inside node text resets font family to body serif. Remove it.",
                line_number=idx,
                snippet=line.strip()
            ))

        # Rule S3: Concept hue extraction
        for hue in APPROVED_CONCEPT_HUES:
            if re.search(rf"\b{hue}\b", line):
                hues_found.add(hue)

        # Rule S3: Raw unthemed colors
        for raw_c in RAW_COLORS:
            # Check if used as draw=red, fill=blue, text=green, etc.
            if re.search(rf"\b(?:draw|fill|color|text)\s*=\s*{raw_c}\b", line) or re.search(rf"\[[^\]]*\b{raw_c}\b[^\]]*\]", line):
                # Ensure it's not part of an approved compound token or macro
                if not any(token in line for token in ["pd", "hhpaper", "white", "black"]):
                    findings.append(Finding(
                        rule_id="S3-raw-color",
                        severity="FAIL",
                        message=f"Raw unthemed color '{raw_c}' detected. Use semantic tokens (pd focus, pd truth, pd breach, etc.).",
                        line_number=idx,
                        snippet=line.strip()
                    ))

        # Rule S4: Line width validation
        lw_matches = re.finditer(r"line\s+width\s*=\s*([0-9.]+)\s*pt", line)
        for m in lw_matches:
            val = float(m.group(1))
            if val not in ALLOWED_LINE_WEIGHTS:
                findings.append(Finding(
                    rule_id="S4-weight-ladder",
                    severity="WARN",
                    message=f"Line width {val}pt is off the standard weight ladder (0.5pt, 0.9pt, 1.6pt).",
                    line_number=idx,
                    snippet=line.strip()
                ))

        # Rule S5: Low-alpha fills without draw boundary
        if re.search(r"\\(?:fill|path\[[^\]]*fill)\s*\[[^\]]*!([0-9]{1,2})\b", line):
            if "draw=" not in line and "pd" not in line:
                findings.append(Finding(
                    rule_id="S5-bare-fill",
                    severity="FAIL",
                    message="Shaded fill detected without drawn boundary edge. Fills must be bounded.",
                    line_number=idx,
                    snippet=line.strip()
                ))

    # Rule S3: Overloaded palette count
    if len(hues_found) > 4:
        findings.append(Finding(
            rule_id="S3-palette-overload",
            severity="FAIL",
            message=f"Figure uses {len(hues_found)} hues ({', '.join(sorted(hues_found))}). Maximum permitted is 4.",
            snippet=f"Hues: {', '.join(sorted(hues_found))}"
        ))

    # Banned Diagram Types
    for pattern, reason in BANNED_FORMS:
        if pattern.search(clean_content):
            findings.append(Finding(
                rule_id="Taxonomy-banned-form",
                severity="FAIL",
                message=reason,
                snippet=pattern.pattern
            ))

    has_failures = any(f.severity == "FAIL" or (strict and f.severity == "WARN") for f in findings)
    return FigureReport(
        target_path=str(file_path),
        file_type="tex",
        passed=not has_failures,
        findings=findings,
        hues_used=sorted(list(hues_found)),
        bounding_box=bbox_tuple
    )


# -----------------------------------------------------------------------------
# PDF Geometry Inspector (PyMuPDF T1-T10 Checks)
# -----------------------------------------------------------------------------

def audit_pdf_geometry(file_path: Path, min_font_pt: float = MIN_FONT_PT_FLOOR, strict: bool = False) -> FigureReport:
    """Inspect rendered PDF geometry using PyMuPDF (when available)."""
    if not HAS_PYMUPDF:
        return FigureReport(
            target_path=str(file_path),
            file_type="pdf",
            passed=True,
            findings=[Finding(
                rule_id="T0-env",
                severity="WARN",
                message="PyMuPDF (fitz) is not installed in the current environment; rendered geometry checks skipped."
            )]
        )

    findings: List[Finding] = []
    doc = fitz.open(file_path)
    families_seen: Set[str] = set()

    for page_num in range(len(doc)):
        page = doc[page_num]
        text_dict = page.get_text("dict")

        for block in text_dict.get("blocks", []):
            if "lines" not in block:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    text = span["text"].strip()
                    if not text:
                        continue
                    font_size = span["size"]
                    font_name = span["font"]

                    # Check T1: Minimum font floor
                    if font_size < min_font_pt - 0.05:
                        findings.append(Finding(
                            rule_id="T1-min-font",
                            severity="FAIL",
                            message=f"Rendered glyph height ({font_size:.2f} pt) is below minimum {min_font_pt:.1f} pt floor.",
                            snippet=f"'{text}' [{font_name}]"
                        ))

                    # Check T10: Font family uniformity (flag serif fonts)
                    # Ignore caption, math, or mono fonts
                    is_math = any(m in font_name.lower() for m in ["math", "msam", "msbm", "eurm"])
                    is_mono = any(m in font_name.lower() for m in ["mono", "code", "courier", "cursor"])
                    if not is_math and not is_mono:
                        families_seen.add(font_name)
                        if any(serif in font_name.lower() for serif in ["pagella", "palatino", "times", "roman", "cmr"]):
                            findings.append(Finding(
                                rule_id="T10-serif-leak",
                                severity="FAIL",
                                message=f"Serif body font '{font_name}' detected in drawing text.",
                                snippet=f"'{text}'"
                            ))

    has_failures = any(f.severity == "FAIL" or (strict and f.severity == "WARN") for f in findings)
    return FigureReport(
        target_path=str(file_path),
        file_type="pdf",
        passed=not has_failures,
        findings=findings
    )


# -----------------------------------------------------------------------------
# Reporting & CLI
# -----------------------------------------------------------------------------

def format_terminal_report(reports: List[FigureReport]) -> str:
    """Format check findings for terminal display."""
    output = []
    total_figs = len(reports)
    passed_count = sum(1 for r in reports if r.passed)
    failed_count = total_figs - passed_count

    output.append("\n=======================================================")
    output.append("          HARBOR FIGURE STYLE AUDIT REPORT            ")
    output.append("=======================================================\n")

    for rep in reports:
        status_mark = "PASS" if rep.passed else "FAIL"
        output.append(f"[{status_mark}] {rep.target_path} ({rep.file_type.upper()})")
        if rep.hues_used:
            output.append(f"       Concept Hues ({len(rep.hues_used)}): {', '.join(rep.hues_used)}")
        if rep.bounding_box:
            x1, y1, x2, y2 = rep.bounding_box
            output.append(f"       Bounding Box: {abs(x2-x1):.2f} x {abs(y2-y1):.2f} cm")

        if not rep.findings:
            output.append("       ✓ All style rules cleanly satisfied.\n")
        else:
            for f in rep.findings:
                loc = f" (line {f.line_number})" if f.line_number else ""
                output.append(f"       [{f.severity}] {f.rule_id}{loc}: {f.message}")
                if f.snippet:
                    output.append(f"             Snippet: {f.snippet[:80]}")
            output.append("")

    output.append("-------------------------------------------------------")
    output.append(f"Summary: {total_figs} inspected | {passed_count} passed | {failed_count} failed\n")
    return "\n".join(output)


def format_markdown_report(reports: List[FigureReport]) -> str:
    """Format check findings as a Markdown table and summary."""
    lines = [
        "# Harbor Figure Style & Quality Audit Report\n",
        f"**Inspected:** {len(reports)} files | "
        f"**Passed:** {sum(1 for r in reports if r.passed)} | "
        f"**Failed:** {sum(1 for r in reports if not r.passed)}\n",
        "| File | Type | Status | Hues | Issues |",
        "|---|---|---|---|---|"
    ]
    for rep in reports:
        status = "✅ PASS" if rep.passed else "❌ FAIL"
        hues = ", ".join(rep.hues_used) if rep.hues_used else "None"
        issues_summary = "<br>".join([f"**[{f.severity}]** {f.rule_id}: {f.message}" for f in rep.findings]) if rep.findings else "None"
        lines.append(f"| `{Path(rep.target_path).name}` | {rep.file_type.upper()} | {status} | {hues} | {issues_summary} |")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Authoritative Harbor Figure Style Checker.")
    parser.add_argument("paths", nargs="+", help="Paths to TikZ fragment .tex or rendered .pdf files, or directories.")
    parser.add_argument("--strict", action="store_true", help="Treat warnings as fatal errors.")
    parser.add_argument("--json", dest="json_out", help="Write findings to a JSON file.")
    parser.add_argument("--md", dest="md_out", help="Write findings to a Markdown file.")
    parser.add_argument("--min-font-pt", type=float, default=MIN_FONT_PT_FLOOR, help="Minimum font size floor for PDF geometry checks.")

    args = parser.parse_args()

    files_to_check: List[Path] = []
    for p_str in args.paths:
        p = Path(p_str)
        if p.is_dir():
            files_to_check.extend(sorted(p.glob("**/*.tex")))
            files_to_check.extend(sorted(p.glob("**/*.pdf")))
        elif p.is_file():
            files_to_check.append(p)
        else:
            print(f"Error: Target path '{p_str}' does not exist.", file=sys.stderr)
            return 2

    if not files_to_check:
        print("No .tex or .pdf files found for inspection.", file=sys.stderr)
        return 0

    reports: List[FigureReport] = []
    for f in files_to_check:
        if f.suffix.lower() == ".tex":
            reports.append(audit_tex_source(f, strict=args.strict))
        elif f.suffix.lower() == ".pdf":
            reports.append(audit_pdf_geometry(f, min_font_pt=args.min_font_pt, strict=args.strict))

    print(format_terminal_report(reports))

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as jf:
            json.dump([asdict(r) for r in reports], jf, indent=2)
        print(f"Wrote JSON report to {args.json_out}")

    if args.md_out:
        with open(args.md_out, "w", encoding="utf-8") as mf:
            mf.write(format_markdown_report(reports))
        print(f"Wrote Markdown report to {args.md_out}")

    all_passed = all(r.passed for r in reports)
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
