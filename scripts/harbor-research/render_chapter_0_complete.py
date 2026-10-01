#!/usr/bin/env python3
"""
Render all 66 pages of Chapter 0 into individual high-res pages and facing spreads.
"""
import os
import fitz
from PIL import Image

PDF_PATH = "website-v2/public/whitepaper/test-chapter-0-book.pdf"
OUT_DIR = "/Users/erichowens/.gemini/antigravity/brain/7c266e41-224e-46d3-8d23-bb0d02aa8bfc/rendered_chapter_0"
SPREADS_DIR = os.path.join(OUT_DIR, "spreads")

os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(SPREADS_DIR, exist_ok=True)

doc = fitz.open(PDF_PATH)
num_pages = len(doc)
print(f"Opened {PDF_PATH}, total pages: {num_pages}")

# 1. Render individual pages at 150 DPI
page_images = []
for p in range(num_pages):
    page = doc[p]
    pix = page.get_pixmap(dpi=150)
    page_num = p + 1
    out_file = os.path.join(OUT_DIR, f"ch0_page_{page_num:02d}.png")
    pix.save(out_file)
    page_images.append(out_file)
    if page_num % 10 == 0 or page_num == num_pages:
        print(f"Rendered pages up to {page_num}/{num_pages}")

# 2. Render facing spreads (page 2+3, 4+5, 6+7, ..., 64+65, 66)
# Page 1 is recto standalone (half-title / blank)
print("Synthesizing facing spreads...")
spread_idx = 1

# Page 1 standalone
img1 = Image.open(page_images[0])
w, h = img1.size
spread1 = Image.new("RGB", (w * 2, h), (255, 255, 255))
spread1.paste(img1, (w, 0))  # Recto on right
spread1.save(os.path.join(SPREADS_DIR, f"spread_{spread_idx:02d}_p01.png"))
spread_idx += 1

# Spreads for p2-p3, p4-p5, ...
for p in range(1, num_pages, 2):
    left_p = p
    right_p = p + 1 if p + 1 < num_pages else None

    img_left = Image.open(page_images[left_p])
    w_l, h_l = img_left.size

    if right_p is not None:
        img_right = Image.open(page_images[right_p])
        w_r, h_r = img_right.size
        spread_img = Image.new("RGB", (w_l + w_r, max(h_l, h_r)), (255, 255, 255))
        spread_img.paste(img_left, (0, 0))
        spread_img.paste(img_right, (w_l, 0))
        spread_file = os.path.join(SPREADS_DIR, f"spread_{spread_idx:02d}_p{left_p+1:02d}_p{right_p+1:02d}.png")
    else:
        spread_img = Image.new("RGB", (w_l * 2, h_l), (255, 255, 255))
        spread_img.paste(img_left, (0, 0))
        spread_file = os.path.join(SPREADS_DIR, f"spread_{spread_idx:02d}_p{left_p+1:02d}.png")

    spread_img.save(spread_file)
    spread_idx += 1

print(f"Completed! {num_pages} pages and {spread_idx - 1} spreads saved to {OUT_DIR}")
