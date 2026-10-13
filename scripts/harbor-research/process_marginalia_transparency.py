"""Process and isolate all 14 marginalia drawings with true transparency and tight cropping.

Eliminates cream paper backgrounds, photographed page edges, spine gutters,
vignette gradients, and unnecessary whitespace padding. Produces crisp,
anti-aliased RGBA PNGs with alpha=0 background.
"""
import hashlib
import json
import os
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PLATE_DIR = ROOT / "website-v2/public/whitepaper/plates/margin-evidence"
BACKUP_DIR = PLATE_DIR / "originals_backup"

# Explicit tight crop windows for the 8 RGB drawings (x0, y0, x1, y1)
RGB_CROPS = {
    "sealed-specimen": (240, 275, 660, 930),
    "reduced-key": (210, 135, 755, 1040),
    "bond-balance": (50, 385, 850, 825),
    "canal-lock": (60, 265, 845, 955),
    "map-and-lens": (35, 220, 845, 1080),
    "movable-type": (115, 50, 770, 1125),
    "one-printing-press": (70, 225, 820, 915),
    "rope-splice": (115, 65, 785, 1000),  # excludes lettering at bottom
}

RGBA_NAMES = [
    "ch01-fairness-ticket-dispenser",
    "ch05-continuity-rope-splice",
    "ch05-episodic-card-file",
    "ch06-reusable-printing-block",
    "ch07-cleanup-repair-kit",
    "ch08-local-admission-turnstile",
]


def isolate_rgb_drawing(name: str, crop_box: tuple) -> Image.Image:
    """Isolate an RGB drawing onto a transparent RGBA canvas."""
    orig_path = BACKUP_DIR / f"{name}.png"
    im = Image.open(orig_path).convert("RGB")
    arr = np.array(im)

    x0, y0, x1, y1 = crop_box
    patch = arr[y0:y1, x0:x1].copy()
    h, w, _ = patch.shape

    # 1. Estimate background paper color via inpainting
    hsv = cv2.cvtColor(patch, cv2.COLOR_RGB2HSV)
    v = hsv[:, :, 2]
    s = hsv[:, :, 1]
    
    # Non-paper mask: dark ink (v < 185) or vivid color (s > 45)
    non_paper = (v < 185) | (s > 45)
    # Dilate non-paper mask slightly for clean inpainting
    dilated_mask = cv2.dilate(non_paper.astype(np.uint8), np.ones((5, 5), np.uint8), iterations=2)
    
    # Inpaint to get smooth paper background surface
    bg_surface = cv2.inpaint(patch, dilated_mask, 7, cv2.INPAINT_NS)

    # 2. Derive alpha channel
    # Difference in luminance and color from estimated paper background
    diff_rgb = np.max(np.abs(patch.astype(np.float32) - bg_surface.astype(np.float32)), axis=2)
    val_diff = np.maximum(0.0, bg_surface[:, :, 2].astype(np.float32) - patch[:, :, 2].astype(np.float32))
    
    # Color accent boost (e.g. cobalt blue or red)
    sat_boost = np.maximum(0.0, s.astype(np.float32) - 40.0) * 1.5
    
    metric = np.maximum(diff_rgb, val_diff) + sat_boost

    # Continuous anti-aliased alpha
    # Low threshold: background paper noise is ~10-15
    # High threshold: full opacity at ~40
    t_low = 14.0
    t_high = 45.0
    alpha_float = np.clip((metric - t_low) / (t_high - t_low), 0.0, 1.0)

    # Clean up small isolated noise specs in pure background
    # Keep only pixels connected to or near substantial ink
    strong_mask = (alpha_float > 0.6).astype(np.uint8)
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(strong_mask)
    keep_mask = np.zeros_like(strong_mask, dtype=bool)
    for i in range(1, num_labels):
        if stats[i, cv2.CC_STAT_AREA] >= 8:
            keep_mask[labels == i] = True
    # Dilate valid object region by 10px
    valid_region = cv2.dilate(keep_mask.astype(np.uint8), np.ones((9, 9), np.uint8), iterations=2) > 0
    alpha_float[~valid_region] = 0.0

    # Ensure strong ink lines are 100% opaque
    alpha_float[v < 120] = 1.0
    # Ensure strong color accents are 100% opaque
    alpha_float[s > 90] = 1.0

    alpha = (alpha_float * 255.0).astype(np.uint8)

    # 3. De-halo RGB channels: unmix the paper background from edge pixels
    alpha_norm = np.maximum(alpha_float[:, :, np.newaxis], 1e-4)
    bg_float = bg_surface.astype(np.float32)
    patch_float = patch.astype(np.float32)

    unmixed = (patch_float - (1.0 - alpha_norm) * bg_float) / alpha_norm
    unmixed = np.clip(unmixed, 0.0, 255.0).astype(np.uint8)

    # For zero alpha pixels, set RGB to black
    unmixed[alpha == 0] = 0

    rgba = np.dstack([unmixed, alpha])
    
    # 4. Final tight crop to non-zero alpha (+ 12px margin)
    coords = np.argwhere(alpha > 10)
    if len(coords) > 0:
        cy0, cx0 = coords.min(axis=0)
        cy1, cx1 = coords.max(axis=0)
        margin = 12
        cx0 = max(0, cx0 - margin)
        cy0 = max(0, cy0 - margin)
        cx1 = min(w, cx1 + margin)
        cy1 = min(h, cy1 + margin)
        rgba = rgba[cy0:cy1, cx0:cx1]

    return Image.fromarray(rgba, mode="RGBA")


def process_rgba_drawing(name: str) -> Image.Image:
    """Crop an existing RGBA drawing tightly to its non-zero alpha content."""
    orig_path = BACKUP_DIR / f"{name}.png"
    im = Image.open(orig_path).convert("RGBA")
    arr = np.array(im)
    alpha = arr[:, :, 3]

    coords = np.argwhere(alpha > 10)
    if len(coords) == 0:
        return im

    cy0, cx0 = coords.min(axis=0)
    cy1, cx1 = coords.max(axis=0)
    margin = 15
    h, w = alpha.shape
    cx0 = max(0, cx0 - margin)
    cy0 = max(0, cy0 - margin)
    cx1 = min(w, cx1 + margin)
    cy1 = min(h, cy1 + margin)

    cropped = arr[cy0:cy1, cx0:cx1]
    return Image.fromarray(cropped, mode="RGBA")


def main():
    print("Processing all 14 marginalia drawings...")
    results = {}

    # Process 8 RGB drawings
    for name, crop_box in RGB_CROPS.items():
        print(f"  Isolating RGB drawing: {name}")
        out_img = isolate_rgb_drawing(name, crop_box)
        out_png = PLATE_DIR / f"{name}.png"
        out_img.save(out_png, format="PNG", optimize=True)

        # Update JSON sidecar
        out_json = PLATE_DIR / f"{name}.json"
        digest = hashlib.sha256(out_png.read_bytes()).hexdigest()
        meta = json.loads(out_json.read_text()) if out_json.exists() else {}
        meta["sha256"] = digest
        meta["image_size"] = f"{out_img.width}x{out_img.height}"
        out_json.write_text(json.dumps(meta, indent=2) + "\n")
        results[name] = {
            "size": f"{out_img.width}x{out_img.height}",
            "sha256": digest
        }

    # Process 6 RGBA drawings
    for name in RGBA_NAMES:
        print(f"  Tight-cropping RGBA drawing: {name}")
        out_img = process_rgba_drawing(name)
        out_png = PLATE_DIR / f"{name}.png"
        out_img.save(out_png, format="PNG", optimize=True)

        # Update JSON sidecar
        out_json = PLATE_DIR / f"{name}.json"
        digest = hashlib.sha256(out_png.read_bytes()).hexdigest()
        meta = json.loads(out_json.read_text()) if out_json.exists() else {}
        meta["sha256"] = digest
        meta["image_size"] = f"{out_img.width}x{out_img.height}"
        out_json.write_text(json.dumps(meta, indent=2) + "\n")
        results[name] = {
            "size": f"{out_img.width}x{out_img.height}",
            "sha256": digest
        }

    print("\nProcessing complete! Manifest:")
    for name, data in results.items():
        print(f"  {name:32s}: {data['size']:12s} {data['sha256']}")


if __name__ == "__main__":
    main()
