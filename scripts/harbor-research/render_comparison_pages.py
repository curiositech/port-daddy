#!/usr/bin/env python3
"""
Render all pages of figures-side-by-side-comparison.pdf into high-res PNG images.
"""
import os
import sys
import fitz

PDF_PATH = "website-v2/public/whitepaper/figures-side-by-side-comparison.pdf"
OUT_DIR = os.environ.get("RENDER_OUT_DIR", os.path.join(os.path.dirname(__file__), "../../.cache/rendered_comparison"))

os.makedirs(OUT_DIR, exist_ok=True)

if not os.path.exists(PDF_PATH):
    print(f"Error: {PDF_PATH} does not exist yet.")
    sys.exit(1)

doc = fitz.open(PDF_PATH)
num_pages = len(doc)
print(f"Opened {PDF_PATH}, total pages: {num_pages}")

for p in range(num_pages):
    page = doc[p]
    pix = page.get_pixmap(dpi=150)
    page_num = p + 1
    out_file = os.path.join(OUT_DIR, f"comparison_page_{page_num:02d}.png")
    pix.save(out_file)
    print(f"Rendered Page {page_num:02d} -> {out_file}")

print(f"All {num_pages} comparison pages rendered to {OUT_DIR}")
