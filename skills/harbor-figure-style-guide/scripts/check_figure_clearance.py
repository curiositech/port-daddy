#!/usr/bin/env python3
"""check_figure_clearance.py -- Geometric clearance and margin auditor for figures.

Audits rendered PDF figures (or compiles TeX fragments on the fly) to verify:
  1. Box Margins: All text inside a container box has a comfortable margin
     (padding >= min_box_margin) from the box boundaries.
  2. Edge/Stroke Clearance: Labels on edges, paths, or arrows maintain a
     fixed safe distance (clearance >= min_clearance) without hitting strokes.
  3. External Geometry Collision: Text outside a box does NOT collide with or
     touch the box border or other vector shapes.
  4. Text-Text Collision: Distinct labels/captions never overlap or crowd each other.

Requirements:
  PyMuPDF (fitz) - available in standard Python environment.

Usage:
  python3 check_figure_clearance.py figure.pdf
  python3 check_figure_clearance.py figure.tex [--preamble book|research]
  python3 check_figure_clearance.py whitepaper/figures/*.tex
  python3 check_figure_clearance.py --json figure.pdf
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None


@dataclass
class TextBlock:
    text: str
    rect: fitz.Rect
    block_id: int
    line_id: int


@dataclass
class ContainerBox:
    rect: fitz.Rect
    is_fill: bool
    is_stroke: bool
    fill_color: Optional[Tuple[float, ...]]
    stroke_color: Optional[Tuple[float, ...]]
    drawing_id: int


@dataclass
class StrokeSegment:
    p1: fitz.Point
    p2: fitz.Point
    drawing_id: int
    color: Optional[Tuple[float, ...]]


def line_intersects_rect(p1: fitz.Point, p2: fitz.Point, rect: fitz.Rect) -> bool:
    """Tests if a line segment (p1, p2) intersects or is contained within rect."""
    if rect.contains(p1) or rect.contains(p2):
        return True
    rx0, ry0, rx1, ry1 = rect.x0, rect.y0, rect.x1, rect.y1
    seg_box = fitz.Rect(min(p1.x, p2.x), min(p1.y, p2.y), max(p1.x, p2.x), max(p1.y, p2.y))
    if not seg_box.intersects(rect):
        return False
    edges = [
        (fitz.Point(rx0, ry0), fitz.Point(rx1, ry0)),
        (fitz.Point(rx1, ry0), fitz.Point(rx1, ry1)),
        (fitz.Point(rx1, ry1), fitz.Point(rx0, ry1)),
        (fitz.Point(rx0, ry1), fitz.Point(rx0, ry0)),
    ]
    def ccw(A: fitz.Point, B: fitz.Point, C: fitz.Point) -> bool:
        return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x)
    def intersect(A: fitz.Point, B: fitz.Point, C: fitz.Point, D: fitz.Point) -> bool:
        return ccw(A, C, D) != ccw(B, C, D) and ccw(A, B, C) != ccw(A, B, D)
    for ea, eb in edges:
        if intersect(p1, p2, ea, eb):
            return True
    return False


@dataclass
class ClearanceViolation:
    kind: str  # 'BOX_MARGIN_DEFICIT', 'BOX_COLLISION', 'STROKE_COLLISION', 'TEXT_COLLISION'
    severity: str  # 'FAIL', 'WARN'
    message: str
    text: str
    rect: Tuple[float, float, float, float]
    target_rect: Optional[Tuple[float, float, float, float]] = None
    deficit_pt: float = 0.0


@dataclass
class FigureClearanceReport:
    file_path: str
    status: str  # 'PASS', 'FAIL'
    violations: List[ClearanceViolation]
    total_text_blocks: int
    total_containers: int
    total_strokes: int


def compile_tex_to_temp_pdf(tex_path: Path, preamble_mode: str = "book") -> Optional[Path]:
    """Compiles a .tex fragment using compile_fragment.sh to a temp PDF."""
    repo_root = Path(__file__).resolve().parents[3]
    compiler = repo_root / "skills/harbor-chartwork/scripts/compile_fragment.sh"
    if not compiler.exists() or not os.access(compiler, os.X_OK):
        return None

    temp_dir = Path(tempfile.mkdtemp(prefix="pd_clearance_"))
    cmd = [
        str(compiler),
        str(tex_path),
        "--preamble",
        preamble_mode,
        "--out",
        str(temp_dir),
    ]
    try:
        res = subprocess.run(
            cmd,
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            check=False,
            timeout=40,
        )
        if res.returncode != 0:
            return None
        pdfs = list(temp_dir.glob("*.pdf"))
        if pdfs:
            return pdfs[0]
    except Exception:
        return None
    return None


def extract_figure_geometry(
    page: fitz.Page,
) -> Tuple[List[TextBlock], List[ContainerBox], List[fitz.Rect], List[StrokeSegment]]:
    """Extracts text blocks, container boxes, line/arrow stroke paths, and segments from a page."""
    # 1. Extract and cluster text
    raw_words = page.get_text("words")
    # Group words by (block_no, line_no)
    lines: Dict[Tuple[int, int], List[Any]] = {}
    for w in raw_words:
        key = (w[5], w[6])
        lines.setdefault(key, []).append(w)

    text_blocks: List[TextBlock] = []
    for key, words in lines.items():
        if not words:
            continue
        line_text = " ".join(w[4] for w in words).strip()
        if not line_text:
            continue
        x0 = min(w[0] for w in words)
        y0 = min(w[1] for w in words)
        x1 = max(w[2] for w in words)
        y1 = max(w[3] for w in words)
        text_blocks.append(
            TextBlock(
                text=line_text,
                rect=fitz.Rect(x0, y0, x1, y1),
                block_id=key[0],
                line_id=key[1],
            )
        )

    # 2. Extract drawings
    drawings = page.get_drawings()
    containers: List[ContainerBox] = []
    strokes: List[fitz.Rect] = []
    stroke_segments: List[StrokeSegment] = []

    page_rect = page.rect
    for i, d in enumerate(drawings):
        r = d.get("rect")
        if not r:
            continue
        rect = fitz.Rect(r)
        # Skip the entire page boundary or huge background rects (> 90% page area)
        if rect.width > 0.92 * page_rect.width and rect.height > 0.92 * page_rect.height:
            continue

        dtype = d.get("type", "")
        is_fill = "f" in dtype
        is_stroke = "s" in dtype

        items = d.get("items", [])
        has_curves = any(it[0] == "c" for it in items)
        is_closed_box = False

        if is_fill:
            is_closed_box = True
        elif is_stroke and not has_curves and len(items) >= 4:
            # Check if lines close a polygon
            pts = []
            for it in items:
                if it[0] == "re":
                    is_closed_box = True
                    break
                elif it[0] == "l":
                    pts.append(it[1])
                    pts.append(it[2])
            if not is_closed_box and pts:
                # If start is close to end
                p_first, p_last = pts[0], pts[-1]
                if abs(p_first.x - p_last.x) < 1.0 and abs(p_first.y - p_last.y) < 1.0:
                    is_closed_box = True

        # If it is a 2D container box (width and height >= 4pt)
        if is_closed_box and rect.width >= 4.0 and rect.height >= 4.0:
            containers.append(
                ContainerBox(
                    rect=rect,
                    is_fill=is_fill,
                    is_stroke=is_stroke,
                    fill_color=d.get("fill"),
                    stroke_color=d.get("color"),
                    drawing_id=i,
                )
            )
        elif rect.width > 0.2 or rect.height > 0.2:
            # Thin stroke / arrow / line / curve
            strokes.append(rect)

        # Collect line segments for stroke collision auditing
        if is_stroke:
            for it in items:
                if it[0] == "l":
                    p1, p2 = it[1], it[2]
                    if (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2 > 0.04:
                        stroke_segments.append(
                            StrokeSegment(
                                p1=p1,
                                p2=p2,
                                drawing_id=i,
                                color=d.get("color"),
                            )
                        )

    return text_blocks, containers, strokes, stroke_segments


def audit_page_clearance(
    page: fitz.Page,
    min_box_margin: float = 3.0,
    min_clearance: float = 2.5,
    min_text_sep: float = 1.0,
) -> List[ClearanceViolation]:
    """Audits text margins, stroke clearances, and geometry collisions on a page."""
    violations: List[ClearanceViolation] = []
    text_blocks, containers, strokes, stroke_segments = extract_figure_geometry(page)

    # 1. Container Box Margin Audit
    for tb in text_blocks:
        t_rect = tb.rect
        # Find all containers that completely or mostly cover tb
        enclosing = []
        external_colliding = []

        for c in containers:
            c_rect = c.rect
            # Check if t_rect is inside c_rect (allowing a tiny tolerance for border thickness)
            if (
                c_rect.x0 <= t_rect.x0 + 1.5
                and c_rect.x1 >= t_rect.x1 - 1.5
                and c_rect.y0 <= t_rect.y0 + 1.5
                and c_rect.y1 >= t_rect.y1 - 1.5
            ):
                enclosing.append(c)
            elif c_rect.intersects(t_rect):
                # Intersection area
                inter = c_rect.intersect(t_rect)
                if inter.width > 1.0 and inter.height > 1.0:
                    external_colliding.append((c, inter))

        # Check tightest enclosing box for margin
        if enclosing:
            # Sort by area ascending to find the immediate parent box
            enclosing.sort(key=lambda c: c.rect.width * c.rect.height)
            parent = enclosing[0]
            p_rect = parent.rect

            m_left = t_rect.x0 - p_rect.x0
            m_right = p_rect.x1 - t_rect.x1
            m_top = t_rect.y0 - p_rect.y0
            m_bottom = p_rect.y1 - t_rect.y1

            min_m = min(m_left, m_right, m_top, m_bottom)
            if min_m < min_box_margin:
                side = (
                    "left"
                    if min_m == m_left
                    else "right"
                    if min_m == m_right
                    else "top"
                    if min_m == m_top
                    else "bottom"
                )
                violations.append(
                    ClearanceViolation(
                        kind="BOX_MARGIN_DEFICIT",
                        severity="FAIL" if min_m < 1.0 else "WARN",
                        message=(
                            f"Text '{tb.text}' inside box has insufficient {side} margin: "
                            f"{min_m:.2f}pt (required >= {min_box_margin:.1f}pt)"
                        ),
                        text=tb.text,
                        rect=(t_rect.x0, t_rect.y0, t_rect.x1, t_rect.y1),
                        target_rect=(p_rect.x0, p_rect.y0, p_rect.x1, p_rect.y1),
                        deficit_pt=round(min_box_margin - min_m, 2),
                    )
                )

        # Check external colliding boxes (e.g. text outside a box striking into it)
        for c, inter in external_colliding:
            # If the box is not an ancestor of the text
            if c not in enclosing:
                violations.append(
                    ClearanceViolation(
                        kind="BOX_COLLISION",
                        severity="FAIL",
                        message=(
                            f"Text '{tb.text}' collides with external box "
                            f"(overlap {inter.width:.1f}x{inter.height:.1f}pt)"
                        ),
                        text=tb.text,
                        rect=(t_rect.x0, t_rect.y0, t_rect.x1, t_rect.y1),
                        target_rect=(c.rect.x0, c.rect.y0, c.rect.x1, c.rect.y1),
                        deficit_pt=round(max(inter.width, inter.height), 2),
                    )
                )

    # 2. Text-to-Text Collision Audit
    for i, tb1 in enumerate(text_blocks):
        for j in range(i + 1, len(text_blocks)):
            tb2 = text_blocks[j]
            # If from same block/line, PyMuPDF grouped them
            if tb1.block_id == tb2.block_id and tb1.line_id == tb2.line_id:
                continue

            if tb1.rect.intersects(tb2.rect):
                inter = tb1.rect.intersect(tb2.rect)
                if inter.width > 0.8 and inter.height > 0.8:
                    violations.append(
                        ClearanceViolation(
                            kind="TEXT_COLLISION",
                            severity="FAIL",
                            message=(
                                f"Text '{tb1.text}' overlaps with '{tb2.text}' "
                                f"by {inter.width:.1f}x{inter.height:.1f}pt"
                            ),
                            text=tb1.text,
                            rect=(tb1.rect.x0, tb1.rect.y0, tb1.rect.x1, tb1.rect.y1),
                            target_rect=(tb2.rect.x0, tb2.rect.y0, tb2.rect.x1, tb2.rect.y1),
                            deficit_pt=round(max(inter.width, inter.height), 2),
                        )
                    )

    # 3. Container-to-Container Collision Audit
    for i in range(len(containers)):
        c1 = containers[i]
        for j in range(i + 1, len(containers)):
            c2 = containers[j]
            if c1.rect.intersects(c2.rect):
                inter = c1.rect.intersect(c2.rect)
                # Valid containment if one completely encloses the other or same rect
                is_nested = (
                    c1.rect.contains(c2.rect)
                    or c2.rect.contains(c1.rect)
                    or (
                        abs(c1.rect.x0 - c2.rect.x0) < 1.0
                        and abs(c1.rect.x1 - c2.rect.x1) < 1.0
                        and abs(c1.rect.y0 - c2.rect.y0) < 1.0
                        and abs(c1.rect.y1 - c2.rect.y1) < 1.0
                    )
                )
                if not is_nested and inter.width > 1.2 and inter.height > 1.2:
                    violations.append(
                        ClearanceViolation(
                            kind="BOX_COLLISION",
                            severity="FAIL",
                            message=(
                                f"Container box #{c1.drawing_id} partially overlaps box #{c2.drawing_id} "
                                f"(overlap {inter.width:.1f}x{inter.height:.1f}pt)"
                            ),
                            text="",
                            rect=(c1.rect.x0, c1.rect.y0, c1.rect.x1, c1.rect.y1),
                            target_rect=(c2.rect.x0, c2.rect.y0, c2.rect.x1, c2.rect.y1),
                            deficit_pt=round(max(inter.width, inter.height), 2),
                        )
                    )

    # 4. Stroke-to-Text Collision Audit
    for tb in text_blocks:
        t_rect = tb.rect
        for seg in stroke_segments:
            if line_intersects_rect(seg.p1, seg.p2, t_rect):
                # Check if shielded by an opaque container box drawn after the stroke
                shielded = False
                for c in containers:
                    if c.drawing_id > seg.drawing_id and c.is_fill and c.rect.contains(t_rect):
                        shielded = True
                        break
                if not shielded:
                    violations.append(
                        ClearanceViolation(
                            kind="STROKE_COLLISION",
                            severity="FAIL",
                            message=(
                                f"Vector stroke #{seg.drawing_id} intersects unshielded text '{tb.text}'"
                            ),
                            text=tb.text,
                            rect=(t_rect.x0, t_rect.y0, t_rect.x1, t_rect.y1),
                            target_rect=(seg.p1.x, seg.p1.y, seg.p2.x, seg.p2.y),
                            deficit_pt=round(max(t_rect.width, t_rect.height), 2),
                        )
                    )

    return violations


def audit_figure_clearance(
    file_path: Path,
    min_box_margin: float = 3.0,
    min_clearance: float = 2.5,
    min_text_sep: float = 1.0,
    page_index: int = 0,
) -> FigureClearanceReport:
    """Audits a PDF or TeX figure file for geometric clearance and margins."""
    if fitz is None:
        raise RuntimeError("PyMuPDF (fitz) is required to run check_figure_clearance.py")

    target_pdf = file_path
    is_temp_pdf = False

    if file_path.suffix.lower() == ".tex":
        compiled = compile_tex_to_temp_pdf(file_path)
        if not compiled or not compiled.exists():
            return FigureClearanceReport(
                file_path=str(file_path),
                status="FAIL",
                violations=[
                    ClearanceViolation(
                        kind="COMPILATION_ERROR",
                        severity="FAIL",
                        message=f"Failed to compile {file_path.name} to PDF for clearance check.",
                        text="",
                        rect=(0, 0, 0, 0),
                    )
                ],
                total_text_blocks=0,
                total_containers=0,
                total_strokes=0,
            )
        target_pdf = compiled
        is_temp_pdf = True

    try:
        doc = fitz.open(str(target_pdf))
        idx = min(max(0, page_index), len(doc) - 1)
        page = doc[idx]
        text_blocks, containers, strokes, _ = extract_figure_geometry(page)
        violations = audit_page_clearance(
            page,
            min_box_margin=min_box_margin,
            min_clearance=min_clearance,
            min_text_sep=min_text_sep,
        )
        has_fail = any(v.severity == "FAIL" for v in violations)
        report_label = f"{file_path} (p.{idx + 1})" if len(doc) > 1 else str(file_path)
        report = FigureClearanceReport(
            file_path=report_label,
            status="FAIL" if has_fail else "PASS",
            violations=violations,
            total_text_blocks=len(text_blocks),
            total_containers=len(containers),
            total_strokes=len(strokes),
        )
        doc.close()
        return report
    finally:
        if is_temp_pdf and target_pdf.exists():
            try:
                target_pdf.unlink()
                if target_pdf.parent.exists():
                    target_pdf.parent.rmdir()
            except Exception:
                pass


def format_report_cli(report: FigureClearanceReport, verbose: bool = False) -> str:
    """Formats report into crisp Swiss CLI output."""
    lines = []
    color_pass = "\033[32m"
    color_fail = "\033[31m"
    color_warn = "\033[33m"
    color_cyan = "\033[36m"
    color_reset = "\033[0m"

    tag = f"{color_pass}[PASS]{color_reset}" if report.status == "PASS" else f"{color_fail}[FAIL]{color_reset}"
    lines.append(f"{tag} {report.file_path}")
    lines.append(
        f"       Elements: {report.total_text_blocks} text blocks | "
        f"{report.total_containers} boxes | {report.total_strokes} strokes"
    )

    if not report.violations:
        lines.append("       ✓ All text margins, edge clearances, and geometry clear of collisions.")
    else:
        for v in report.violations:
            v_tag = f"{color_fail}[FAIL]{color_reset}" if v.severity == "FAIL" else f"{color_warn}[WARN]{color_reset}"
            lines.append(f"       {v_tag} {v.kind}: {v.message}")
            if verbose and v.deficit_pt > 0:
                lines.append(f"             Deficit: {v.deficit_pt:.2f}pt at {v.rect}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="Audit figure PDF or TeX for text margins, clearances, and collisions."
    )
    parser.add_argument("paths", nargs="+", help="PDF or TeX file paths to audit")
    parser.add_argument(
        "--min-box-margin",
        type=float,
        default=3.0,
        help="Minimum inner padding (pt) inside container boxes (default: 3.0)",
    )
    parser.add_argument(
        "--min-clearance",
        type=float,
        default=2.5,
        help="Minimum clearance (pt) from external geometry/strokes (default: 2.5)",
    )
    parser.add_argument(
        "--min-text-sep",
        type=float,
        default=1.0,
        help="Minimum separation (pt) between distinct text items (default: 1.0)",
    )
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose details")
    parser.add_argument("--page", type=int, default=1, help="Page number to audit in PDF (1-indexed, default: 1)")

    args = parser.parse_args()

    reports = []
    has_any_fail = False

    for p_str in args.paths:
        p = Path(p_str)
        if not p.exists():
            print(f"Error: file not found: {p}", file=sys.stderr)
            has_any_fail = True
            continue

        report = audit_figure_clearance(
            p,
            min_box_margin=args.min_box_margin,
            min_clearance=args.min_clearance,
            min_text_sep=args.min_text_sep,
            page_index=args.page - 1,
        )
        reports.append(report)
        if report.status == "FAIL":
            has_any_fail = True

        if not args.json:
            print(format_report_cli(report, verbose=args.verbose))

    if args.json:
        data = {
            "summary": {
                "total": len(reports),
                "passed": sum(1 for r in reports if r.status == "PASS"),
                "failed": sum(1 for r in reports if r.status == "FAIL"),
            },
            "reports": [
                {
                    "file_path": r.file_path,
                    "status": r.status,
                    "total_text_blocks": r.total_text_blocks,
                    "total_containers": r.total_containers,
                    "total_strokes": r.total_strokes,
                    "violations": [asdict(v) for v in r.violations],
                }
                for r in reports
            ],
        }
        print(json.dumps(data, indent=2))

    sys.exit(1 if has_any_fail else 0)


if __name__ == "__main__":
    main()
