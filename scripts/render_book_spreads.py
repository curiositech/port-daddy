#!/usr/bin/env python3
"""
render_book_spreads.py — render high-resolution 14x10 in facing two-page spreads
from coordination-papers-mega-volume-spreads.pdf for visual verification and review.
"""

import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SPREADS_PDF = REPO_ROOT / "website-v2/public/whitepaper/coordination-papers-mega-volume-spreads.pdf"
DEFAULT_ARTIFACT_DIR = Path("/Users/erichowens/.gemini/antigravity/brain/7c266e41-224e-46d3-8d23-bb0d02aa8bfc")

def render_spreads(pdf_path: Path, out_dir: Path, first_sheet: int, last_sheet: int, prefix: str = "spread"):
    out_dir.mkdir(parents=True, exist_ok=True)
    out_prefix = out_dir / prefix
    cmd = [
        "pdftoppm",
        "-png",
        "-r", "150",
        "-f", str(first_sheet),
        "-l", str(last_sheet),
        str(pdf_path),
        str(out_prefix),
    ]
    print(f"Running: {' '.join(cmd)}")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"Error rendering spreads: {res.stderr}", file=sys.stderr)
        sys.exit(res.returncode)
    print(f"Successfully rendered sheets {first_sheet}..{last_sheet} to {out_dir}")

def main():
    parser = argparse.ArgumentParser(description="Render book spreads to PNG")
    parser.add_argument("--pdf", type=Path, default=DEFAULT_SPREADS_PDF, help="Path to spreads PDF")
    parser.add_argument("--outdir", type=Path, default=DEFAULT_ARTIFACT_DIR, help="Output directory")
    parser.add_argument("--first", "-f", type=int, default=8, help="First sheet number (1-indexed)")
    parser.add_argument("--last", "-l", type=int, default=32, help="Last sheet number (1-indexed)")
    parser.add_argument("--prefix", "-p", type=str, default="spread_review", help="Output filename prefix")
    args = parser.parse_args()

    if not args.pdf.exists():
        sys.exit(f"Error: Spreads PDF not found at {args.pdf}")

    render_spreads(args.pdf, args.outdir, args.first, args.last, args.prefix)

if __name__ == "__main__":
    main()
