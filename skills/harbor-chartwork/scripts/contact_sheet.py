#!/usr/bin/env python3
"""contact_sheet.py -- build a grid contact sheet from one or more figure PDFs.

Usage:
  contact_sheet.py PDF [PDF ...] --out sheet.png [--cols 4] [--dpi 150] [--cell-width 360]

Renders page 0 of each PDF via PyMuPDF, scales it to a common cell width
(preserving aspect ratio), and lays the thumbnails out in a --cols-wide grid
with Pillow, captioning each cell with the PDF's filename stem. A PDF that
fails to open or render becomes a labeled placeholder cell instead of
aborting the whole sheet -- useful when running this over a batch that
includes fragments known not to compile.

Exit status: 0 once the sheet is written -- even if some cells are
placeholders, whether because a PDF is missing (e.g. its fragment failed to
compile) or failed to render; 2 if no PDFs were given at all, or --out
cannot be written.
"""
import argparse
import sys
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw, ImageFont

CAPTION_HEIGHT = 22
CELL_PADDING = 8
BORDER_COLOR = (200, 200, 200)
BG_COLOR = (255, 255, 255)
CAPTION_BG = (245, 245, 245)
CAPTION_FG = (40, 40, 40)
PLACEHOLDER_BG = (255, 230, 230)
PLACEHOLDER_FG = (150, 0, 0)


def render_thumbnail(pdf_path, dpi, cell_width):
    """Return a PIL Image thumbnail of page 0, scaled to cell_width wide."""
    try:
        if not Path(pdf_path).is_file():
            raise FileNotFoundError(f"no such file: {pdf_path}")
        doc = pymupdf.open(pdf_path)
        try:
            if doc.page_count < 1:
                raise ValueError("PDF has no pages")
            page = doc[0]
            zoom = dpi / 72.0
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        finally:
            doc.close()
    except Exception as exc:  # noqa: BLE001 -- any render failure becomes a placeholder cell
        img = Image.new("RGB", (cell_width, int(cell_width * 0.7)), PLACEHOLDER_BG)
        draw = ImageDraw.Draw(img)
        draw.text((8, 8), f"could not render:\n{exc}", fill=PLACEHOLDER_FG)
        return img

    w, h = img.size
    if w <= 0 or h <= 0:
        return Image.new("RGB", (cell_width, int(cell_width * 0.7)), PLACEHOLDER_BG)
    scale = cell_width / w
    new_h = max(1, round(h * scale))
    return img.resize((cell_width, new_h), Image.LANCZOS)


def build_contact_sheet(pdf_paths, cols, dpi, cell_width):
    thumbs = [(Path(p).stem, render_thumbnail(p, dpi, cell_width)) for p in pdf_paths]
    if not thumbs:
        raise ValueError("no PDFs given")
    cell_h = max(t.size[1] for _, t in thumbs)
    cols = max(1, cols)
    rows = (len(thumbs) + cols - 1) // cols

    sheet_w = cols * (cell_width + CELL_PADDING) + CELL_PADDING
    sheet_h = rows * (cell_h + CAPTION_HEIGHT + CELL_PADDING) + CELL_PADDING
    sheet = Image.new("RGB", (sheet_w, sheet_h), BG_COLOR)
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.load_default()
    except Exception:  # noqa: BLE001 -- default bitmap font should always load; degrade gracefully
        font = None

    for idx, (name, thumb) in enumerate(thumbs):
        col = idx % cols
        row = idx // cols
        x = CELL_PADDING + col * (cell_width + CELL_PADDING)
        y = CELL_PADDING + row * (cell_h + CAPTION_HEIGHT + CELL_PADDING)
        y_img = y + (cell_h - thumb.size[1]) // 2
        sheet.paste(thumb, (x, y_img))
        draw.rectangle([x, y, x + cell_width, y + cell_h], outline=BORDER_COLOR, width=1)

        cap_y = y + cell_h + 2
        draw.rectangle([x, cap_y, x + cell_width, cap_y + CAPTION_HEIGHT - 2], fill=CAPTION_BG)
        text = name if len(name) < 46 else name[:43] + "..."
        draw.text((x + 4, cap_y + 4), text, fill=CAPTION_FG, font=font)

    return sheet


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build a grid contact sheet from figure PDFs.")
    ap.add_argument("pdfs", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--dpi", type=int, default=150)
    ap.add_argument("--cell-width", type=int, default=360)
    args = ap.parse_args(argv)

    missing = [p for p in args.pdfs if not Path(p).is_file()]
    for p in missing:
        print(f"contact_sheet.py: warning: no such file, using a placeholder cell: {p}", file=sys.stderr)

    sheet = build_contact_sheet(args.pdfs, cols=args.cols, dpi=args.dpi, cell_width=args.cell_width)
    try:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        sheet.save(args.out)
    except OSError as exc:
        print(f"contact_sheet.py: could not write {args.out}: {exc}", file=sys.stderr)
        return 2

    print(f"contact_sheet.py: wrote {args.out} ({len(args.pdfs)} figure(s), {args.cols} cols)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
