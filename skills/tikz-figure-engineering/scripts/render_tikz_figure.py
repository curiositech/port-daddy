#!/usr/bin/env python3
"""Compile TikZ/LaTeX figures, rasterize them, and emit review evidence.

Usage:
  python3 render_tikz_figure.py FIGURE.tex --out-dir build/figure --strict
  python3 render_tikz_figure.py FIGURE_DIRECTORY --out-dir build/sheet --contact-sheet
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

FATAL_PATTERNS = ("LaTeX Error", "Emergency stop", "Fatal error", "Undefined control sequence")
LAYOUT_PATTERNS = ("Overfull \\hbox", "Overfull \\vbox", "Missing character", "Undefined references", "Citation `")
DEFAULT_DPI = 160
PREVIEW_DPI = 144

def which(name: str) -> str | None:
    return shutil.which(name)

def run(command: list[str], cwd: Path) -> tuple[int, str]:
    result = subprocess.run(command, cwd=cwd, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, check=False)
    return result.returncode, result.stdout

def locate_engine(choice: str) -> str:
    candidates = [choice] if choice != "auto" else ["pdflatex", "xelatex", "lualatex"]
    for item in candidates:
        if which(item):
            return item
    raise RuntimeError("No LaTeX engine found. Install TeX Live/MacTeX or pass --engine.")

def source_warnings(source: str) -> list[dict[str, str]]:
    warnings: list[dict[str, str]] = []
    if "\\tiny" in source or "\\scriptsize" in source:
        warnings.append({"kind": "small-text", "message": "Avoid \\tiny and \\scriptsize in body figures."})
    for label in re.findall(r"node(?:\[[^\]]*\])?\s*\{([^{}]{30,})\}", source):
        words = len(re.findall(r"\\?[A-Za-z]+|[A-Za-z0-9]+", label))
        if words > 7:
            warnings.append({"kind": "long-edge-label", "message": f"Edge label has {words} tokens; move explanation to a callout or caption."})
    if source.count("to[out=") >= 4:
        warnings.append({"kind": "curvature-density", "message": "Four or more routed curves: check whether lanes or panels communicate the relation better."})
    return warnings

def parse_pdf_dimensions(pdf: Path) -> tuple[float | None, float | None]:
    if not which("pdfinfo"):
        return None, None
    code, out = run(["pdfinfo", str(pdf)], pdf.parent)
    if code != 0:
        return None, None
    match = re.search(r"Page size:\s+([\d.]+) x ([\d.]+) pts", out)
    if not match:
        return None, None
    return float(match.group(1)) / 72.0, float(match.group(2)) / 72.0

def render_png(pdf: Path, png: Path, dpi: int) -> str | None:
    if which("pdftocairo"):
        code, output = run(["pdftocairo", "-png", "-singlefile", "-r", str(dpi), str(pdf), str(png.with_suffix(""))], pdf.parent)
        if code == 0 and png.exists():
            return None
        return output[-1000:]
    if which("magick"):
        code, output = run(["magick", "-density", str(dpi), str(pdf) + "[0]", str(png)], pdf.parent)
        if code == 0 and png.exists():
            return None
        return output[-1000:]
    return "No rasterizer found (install poppler pdftocairo or ImageMagick)."

def compile_one(source: Path, out_dir: Path, engine: str, dpi: int, max_w: float | None, max_h: float | None) -> dict:
    source = source.resolve()
    out_dir = out_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    jobname = source.stem
    command = [engine, "-interaction=nonstopmode", "-halt-on-error", f"-output-directory={out_dir}", f"-jobname={jobname}", str(source.resolve())]
    code, output = run(command, out_dir)
    log_path = out_dir / f"{jobname}.log"
    log = log_path.read_text(errors="replace") if log_path.exists() else output
    pdf = out_dir / f"{jobname}.pdf"
    warnings = source_warnings(source.read_text(errors="replace"))
    for pattern in LAYOUT_PATTERNS:
        if pattern in log:
            warnings.append({"kind": "latex-layout", "message": pattern})
    fatal = [pattern for pattern in FATAL_PATTERNS if pattern in log]
    width, height = parse_pdf_dimensions(pdf) if pdf.exists() else (None, None)
    if width and max_w and width > max_w + 0.01:
        warnings.append({"kind": "page-width", "message": f"Rendered page width {width:.2f}in exceeds {max_w:.2f}in."})
    if height and max_h and height > max_h + 0.01:
        warnings.append({"kind": "page-height", "message": f"Rendered page height {height:.2f}in exceeds {max_h:.2f}in."})
    png = out_dir / f"{jobname}.png"
    raster_error = render_png(pdf, png, dpi) if pdf.exists() else None
    if raster_error:
        warnings.append({"kind": "rasterization", "message": raster_error})
    return {"source": str(source), "engine": engine, "command": command, "compiled": code == 0 and pdf.exists(),
            "fatal": fatal, "warnings": warnings, "pdf": str(pdf) if pdf.exists() else None,
            "png": str(png) if png.exists() else None, "width_in": width, "height_in": height,
            "log": str(log_path) if log_path.exists() else None, "tail": log[-1600:]}

def contact_sheet(pngs: list[Path], out_dir: Path) -> str | None:
    if len(pngs) < 2:
        return None
    if not which("magick"):
        return "ImageMagick unavailable; individual PNGs were produced but no contact sheet."
    sheet = out_dir / "contact-sheet.png"
    command = ["magick", "montage", *map(str, pngs), "-thumbnail", "900x", "-background", "white", "-gravity", "north", "-tile", "2x", "-geometry", "+20+20", str(sheet)]
    code, output = run(command, out_dir)
    # Some ImageMagick builds warn about an unset default label font even though
    # montage writes a valid image. The artifact, not that irrelevant warning,
    # is the success criterion here.
    return None if sheet.exists() else output[-1000:]

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="A self-contained .tex file or directory of .tex files")
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--engine", default="auto", choices=["auto", "pdflatex", "xelatex", "lualatex"])
    parser.add_argument("--dpi", type=int,
                        help=f"Color inspection resolution (default: {DEFAULT_DPI}; overrides --preview).")
    parser.add_argument("--preview", action="store_true",
                        help=f"Fast color-only inspection PNG at {PREVIEW_DPI} DPI; compile and strict checks remain enabled.")
    parser.add_argument("--strict", action="store_true", help="Fail on warnings as well as compilation errors")
    parser.add_argument("--contact-sheet", action="store_true")
    parser.add_argument("--max-width-in", type=float)
    parser.add_argument("--max-height-in", type=float)
    args = parser.parse_args()
    dpi = args.dpi if args.dpi is not None else (PREVIEW_DPI if args.preview else DEFAULT_DPI)
    args.out_dir = args.out_dir.resolve()
    if not args.input.exists():
        parser.error(f"Input does not exist: {args.input}")
    sources = [args.input.resolve()] if args.input.suffix == ".tex" else sorted(path.resolve() for path in args.input.rglob("*.tex"))
    if not sources:
        parser.error("No .tex sources found.")
    try:
        engine = locate_engine(args.engine)
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    reports = [compile_one(source, args.out_dir / source.stem, engine, dpi, args.max_width_in, args.max_height_in) for source in sources]
    pngs = [Path(item["png"]) for item in reports if item["png"]]
    sheet_error = contact_sheet(pngs, args.out_dir) if args.contact_sheet else None
    report = {"tool": "render_tikz_figure", "engine": engine, "strict": args.strict,
              "dpi": dpi, "preview": args.preview, "figures": reports,
              "contact_sheet_error": sheet_error}
    report_path = args.out_dir / "render-report.json"
    args.out_dir.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    failed = [item for item in reports if not item["compiled"] or item["fatal"] or (args.strict and item["warnings"])]
    for item in reports:
        state = "PASS" if item not in failed else "REVIEW"
        print(f"{state} {item['source']} -> {item['pdf'] or 'no PDF'}")
        for warning in item["warnings"]:
            print(f"  {warning['kind']}: {warning['message']}")
    print(f"Report: {report_path}")
    if sheet_error:
        print(f"CONTACT SHEET REVIEW: {sheet_error}")
    return 1 if failed or (args.strict and sheet_error) else 0

if __name__ == "__main__":
    raise SystemExit(main())
