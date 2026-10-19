"""Batch process all 27 newly generated marginalia drawings into transparent RGBA PNGs.

Applies:
- Inpainting to remove any stray letters / figure labels
- Background isolation: pure alpha=0 for off-white paper
- Crisp 100% opacity for ink linework and cobalt blue accents
- Clean anti-aliased alpha edge blending with de-haloing
- Tight bounding box crop with modest padding
- JSON provenance sidecars matching repo standards
"""
import glob
import hashlib
import json
import os
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

BRAIN_DIR = Path("/Users/erichowens/.gemini/antigravity/brain/7c266e41-224e-46d3-8d23-bb0d02aa8bfc")
OUT_DIR = Path("/Users/erichowens/coding/tmp/book-figures-reconciled/website-v2/public/whitepaper/plates/margin-evidence")
OUT_DIR.mkdir(parents=True, exist_ok=True)

ITEMS = [
    ("ch01-flywheel-governor", "flywheel_governor_*.jpg",
     "Steam engine centrifugal flyball governor with two rotating balls on hinged arms, cobalt blue valve collar. Explanatory analogy for rate-limiting and backpressure regulation."),
    ("ch01-railway-token-staff", "railway_token_staff_*.jpg",
     "English railway brass token staff with cobalt blue locking collar. Analogy for single-writer mutual exclusion."),
    ("ch01-water-meter-dial", "water_meter_dial_*.jpg",
     "Rotary water flow meter with cutaway piston and cobalt blue indicator needle. Analogy for monotonic append-only state accounting."),
    
    ("ch02-finite-grant-parking-meter", "parking_meter_*.jpg",
     "Clockwork mechanical parking meter with cobalt blue expired flag. Analogy for finite-duration capability grants and lease expiry."),
    ("ch02-nested-measuring-spoons", "measuring_spoons_*.jpg",
     "Graduated set of nested metal measuring spoons on a split ring, smallest inner spoon cobalt blue. Analogy for monotonic capability restriction."),
    ("ch02-colander-mesh", "colander_mesh_*.jpg",
     "Analytical laboratory test sieve with fine wire mesh and cobalt blue top rim. Analogy for attenuation caveats filtering operations."),
    ("ch02-couriers-dispatch-pouch", "courier_pouch_*.jpg",
     "Leather diplomatic courier pouch with cobalt blue wax seal over tie cord. Analogy for third-party caveat discharge."),
    
    ("ch03-authorized-speaking-tube", "speaking_tube_*.jpg",
     "Shipboard brass acoustic speaking tube with cobalt blue whistle stopper plug. Analogy for strictly mediated communication across isolation boundaries."),
    ("ch03-two-shutter-shadowbox", "shadowbox_*.jpg",
     "Laboratory pass-through transfer box with interlocked guillotine doors, front hatch cobalt blue. Analogy for noninterference between secret input and observer."),
    ("ch03-sandglass-flow-orifice", "hourglass_orifice_*.jpg",
     "Sandglass with calibrated cobalt blue orifice plate restricting sand flow. Analogy for differential privacy leakage budget metering."),
    ("ch03-lead-lined-darkslide", "darkslide_cassette_*.jpg",
     "Photographic plate holder with lead darkslide partially withdrawn by cobalt blue pull tab. Analogy for controlled zero-knowledge revelation."),
    
    ("ch04-selective-attention-annunciator", "annunciator_panel_*.jpg",
     "Shipboard annunciator panel with one dropped cobalt blue signal flag. Analogy for selective attention and exception reporting."),
    ("ch04-tide-gauge-staff", "tide_gauge_*.jpg",
     "Mechanical tide gauge recording drum with float wire and cobalt blue pulley wheel. Analogy for synthesizing continuous noisy telemetry into a legible trend."),
    ("ch04-sextant-index-mirror", "sextant_mirror_*.jpg",
     "Marine brass navigation sextant with cobalt blue index mirror bracket aligning split horizon. Analogy for split-ranker comparison and sighting agreement."),
    ("ch04-telegraph-sounder-key", "telegraph_sounder_*.jpg",
     "Electric Morse telegraph sounder with cobalt blue coil bobbin. Analogy for discrete signals carrying dense meaning across an attention bottleneck."),
    
    ("ch05-wax-seal-signet", "wax_signet_*.jpg",
     "Engraved signet ring poised above cobalt blue sealing wax on parchment. Analogy for durable cryptographic witness binding an act to persistent identity."),
    ("ch05-stagecoach-relay-post", "relay_post_*.jpg",
     "Stagecoach harness hitch and team swap with cobalt blue padded collar. Analogy for hot-swapping model backends without discarding mission or carriage."),
    ("ch05-stepped-surveyors-pole", "surveyor_pole_*.jpg",
     "Surveyor leveling rod with cobalt blue zero benchmark band against a vertical cliff. Analogy for the front-loaded probation cliff."),
    
    ("ch06-wharf-steelyard-scale", "steelyard_scale_*.jpg",
     "Dockside steelyard beam scale with cobalt blue sliding counterpoise weight. Analogy for price clearing discovery balancing supply and demand."),
    ("ch06-dockyard-cargo-sling", "cargo_sling_*.jpg",
     "Woven hemp dockyard cargo sling net lifting wooden crates with cobalt blue hoist hook. Analogy for bundling work orders and batch execution."),
    ("ch06-grain-tally-board", "tally_board_*.jpg",
     "Dockmaster wooden tally board with pegged ivory counters and one cobalt blue marker peg. Analogy for discrete unit economics per executed agent run."),
    
    ("ch07-dual-control-escrow-box", "escrow_box_*.jpg",
     "Reinforced iron escrow chest with two distinct keys, left key handle cobalt blue. Analogy for bilateral dual-control escrow settlement."),
    ("ch07-shear-pin-fuse", "shear_pin_*.jpg",
     "Propeller drive-shaft sleeve coupling with cobalt blue shear pin snapped in two. Analogy for sacrificial slashing protecting the host system."),
    
    ("ch08-quarantine-inspection-lantern", "quarantine_lantern_*.jpg",
     "Maritime port quarantine inspection lantern with cobalt blue cylindrical fresnel lens. Analogy for admission gating until proofs clear."),
    ("ch08-transit-customs-seal", "customs_seal_*.jpg",
     "Industrial customs transit seal with cobalt blue metal crimp button clamped over braided wire. Analogy for transit through intermediary harbors without disclosure."),
    ("ch08-interlocking-railway-lever", "interlocking_lever_*.jpg",
     "Railway switch mechanical interlocking ground lever with cobalt blue grip and cutaway locking dogs. Analogy for distributed mutual exclusion across federation boundaries."),
    ("ch08-closed-traverse-compass", "traverse_compass_*.jpg",
     "Surveyor vernier traverse compass on tripod with cobalt blue needle tip sighting station peg. Analogy for sheaf Laplacian cycle consistency.")
]

def process_one(slug: str, pattern: str, prompt_desc: str):
    matches = sorted(glob.glob(str(BRAIN_DIR / pattern)))
    if not matches:
        print(f"ERROR: No match for {pattern}")
        return False
    src_path = Path(matches[-1])
    im = Image.open(src_path).convert("RGB")
    arr = np.array(im)
    h, w, _ = arr.shape

    # 1. Clean small disconnected text / letters (e.g. A, B, Fig 1.1)
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    _, thresh = cv2.threshold(gray, 190, 255, cv2.THRESH_BINARY_INV)
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(thresh)

    # Inpaint small detached text components
    mask_remove = np.zeros((h, w), dtype=np.uint8)
    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        # Text letter components typically 15 to 1200 pixels
        if 10 < area < 1500:
            # check distance to outer edge or if detached
            x, y, sw, sh = stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_TOP], stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
            # If on right 30% and narrow or near borders
            if (x > w * 0.55 and sh < 40) or (x < w * 0.15 and sh < 40) or (y > h * 0.85 and sh < 40) or (y < h * 0.15 and sh < 40):
                mask_remove[labels == i] = 255
            # Also catch isolated letter tags in the diagram
            elif sw < 30 and sh < 30 and area < 400:
                mask_remove[labels == i] = 255

    if np.any(mask_remove):
        mask_remove = cv2.dilate(mask_remove, np.ones((5,5), np.uint8))
        arr = cv2.inpaint(arr, mask_remove, 5, cv2.INPAINT_TELEA)

    # 2. Derive alpha channel
    hsv = cv2.cvtColor(arr, cv2.COLOR_RGB2HSV)
    v = hsv[:, :, 2]
    s = hsv[:, :, 1]

    # Non-paper mask: dark ink (v < 205) or vivid color (s > 35)
    non_paper = (v < 205) | (s > 35)

    alpha = np.zeros((h, w), dtype=np.uint8)
    alpha[non_paper] = 255
    # Smooth edges with 3x3 Gaussian
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0)

    # Clean isolated noise in background
    strong_mask = (alpha > 120).astype(np.uint8)
    num_l, labs, st, _ = cv2.connectedComponentsWithStats(strong_mask)
    keep_mask = np.zeros_like(strong_mask, dtype=bool)
    for i in range(1, num_l):
        if st[i, cv2.CC_STAT_AREA] >= 50:
            keep_mask[labs == i] = True
    valid_region = cv2.dilate(keep_mask.astype(np.uint8), np.ones((11, 11), np.uint8), iterations=2) > 0
    alpha[~valid_region] = 0

    rgba = np.dstack([arr, alpha])

    # 3. Tight crop around alpha > 20
    y_indices, x_indices = np.where(alpha > 20)
    if len(y_indices) == 0 or len(x_indices) == 0:
        print(f"ERROR: Empty alpha for {slug}")
        return False
    y0, y1 = max(0, y_indices.min() - 15), min(h, y_indices.max() + 15)
    x0, x1 = max(0, x_indices.min() - 15), min(w, x_indices.max() + 15)

    cropped = rgba[y0:y1, x0:x1]
    out_img = Image.fromarray(cropped, "RGBA")
    png_path = OUT_DIR / f"{slug}.png"
    out_img.save(png_path)

    # 4. JSON sidecar
    raw_bytes = png_path.read_bytes()
    sidecar = {
        "model": "gemini-3-pro-image",
        "prompt": prompt_desc,
        "aspect": "3:4",
        "image_size": "1K",
        "sha256": hashlib.sha256(raw_bytes).hexdigest(),
        "role": "generated editorial analogy, not measured evidence",
        "references_uploaded": []
    }
    (OUT_DIR / f"{slug}.json").write_text(json.dumps(sidecar, indent=2) + "\n")
    print(f"Processed {slug}.png (size: {out_img.size})")
    return True

def main():
    success = 0
    for slug, pat, desc in ITEMS:
        if process_one(slug, pat, desc):
            success += 1
    print(f"\nCompleted {success}/{len(ITEMS)} items.")

if __name__ == "__main__":
    main()
