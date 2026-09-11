#!/usr/bin/env python3
"""Encode the chosen round-4 Swiss renders into the Book's plate directory.

The post is the round-2 pipeline unchanged, because the Swiss register is
hard-edged and wants no softening: inset 2% to lose the render edge, centre
crop-fit to the exact target aspect (the chapter plates are 2:1 and no image
model offers it, so they are generated at 16:9 and cut), Lanczos to the stated
long edge, progressive JPEG at quality 88. No paper-tone balance, no feathered
border -- those belong to the maritime plates.

The picks are passed in as NAME=INDEX pairs and written into PROVENANCE.json
beside the prompt that produced them, so the record says which of the six was
taken and why.

Usage:
    python3 scripts/whitepaper-plates/install_swiss_v4.py \\
        --renders "$SP/swiss-v4" cover=3 part-I=2 chapter-swk=5 ...
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date

from PIL import Image, ImageOps

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import swiss_prompts_v4 as v4  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PLATE_DIR = os.path.join(REPO, "website-v2", "public", "whitepaper", "plates", "swiss")

# name -> (final aspect string, (width, height)).
#
# Round 2's plates were 3400px on the long edge, which is 486 dpi across a 7in
# trim. Flat colour compresses to nothing, so nobody noticed. Round 4's plates
# are halftone photographs, which are noise: at 3400px the thirteen of them came
# to 15 MB against a whole-book budget of 12. 2100px is 300 dpi at the trim --
# the print standard, not a compromise -- and brings them to about a third of
# that. The aspect ratios are unchanged, so the TeX that places them does not
# move.
TARGETS = {
    "cover": ("2:3", (2100, 3150)),
    "part-I": ("3:2", (2100, 1400)),
    "part-II": ("3:2", (2100, 1400)),
    "part-III": ("3:2", (2100, 1400)),
    "part-IV": ("3:2", (2100, 1400)),
}
for _chapter in ("swk", "anchor", "sealed", "ls", "stp", "he", "bonded", "fh"):
    TARGETS[f"chapter-{_chapter}"] = ("2:1", (2100, 1050))

POST = ("inset 2% to remove the render edge, center-crop-fit to the exact target "
        "aspect ratio (ImageOps.fit, centered), Lanczos resize to the stated long "
        "edge, JPEG encode at quality 88 progressive; no paper-tone balancing and "
        "no border feathering (the Swiss register is hard-edged)")


def encode(src: str, dest: str, size: tuple[int, int]) -> tuple[list[int], int]:
    try:
        im = Image.open(src).convert("RGB")
    except (OSError, ValueError) as err:
        # A truncated or half-written render is the likely cause: the generator
        # writes into this directory while a long run is still going.
        raise SystemExit(f"cannot read render {src}: {err}") from err
    raw = list(im.size)
    w, h = im.size
    inset = (int(w * 0.02), int(h * 0.02))
    im = im.crop((inset[0], inset[1], w - inset[0], h - inset[1]))
    im = ImageOps.fit(im, size, Image.LANCZOS, centering=(0.5, 0.5))
    im.save(dest, quality=88, progressive=True, optimize=True)
    return raw, os.path.getsize(dest)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--renders", required=True, help="directory of NAME-N.png candidates")
    ap.add_argument("--why", default="", help="one rationale applied to every plate")
    ap.add_argument("picks", nargs="+", help="NAME=INDEX, or NAME=INDEX:rationale")
    args = ap.parse_args()

    chosen: dict[str, tuple[int, str]] = {}
    for pick in args.picks:
        name, sep, rest = pick.partition("=")
        index, _, why = rest.partition(":")
        if not sep:
            raise SystemExit(f"pick {pick!r} is not NAME=INDEX")
        if name not in TARGETS:
            raise SystemExit(f"unknown plate: {name} (expected one of {', '.join(sorted(TARGETS))})")
        if not index.isdigit():
            # A rationale full of commas and colons is easy to mis-quote, and a
            # shell that eats the quoting hands us "NAME=" or "NAME=the only
            # candidate...". Say which pick is malformed instead of dying in
            # int() with a ValueError that names neither the plate nor the pick.
            raise SystemExit(f"pick for {name!r} has no candidate index: {pick!r}")
        chosen[name] = (int(index), why or args.why)

    path = os.path.join(PLATE_DIR, "PROVENANCE.json")
    with open(path, encoding="utf-8") as handle:
        record = json.load(handle)
    record["generated"] = date.today().isoformat()
    record["pipeline_version"] = v4.PIPELINE_VERSION
    record["post"] = POST
    record["style_reference"] = ("the chosen cover render, passed to every other plate as the "
                                 "style template so thirteen separate generations read as one book")
    record["palette"] = v4.PALETTE
    record["candidates_per_plate"] = 6

    for name, (index, why) in sorted(chosen.items()):
        aspect, size = TARGETS[name]
        src = os.path.join(args.renders, f"{name}-{index}.png")
        if not os.path.exists(src):
            raise SystemExit(f"missing render: {src}")
        dest = os.path.join(PLATE_DIR, f"{name}.jpg")
        raw, written = encode(src, dest, size)
        spec = v4.PLATES[name]
        entry = record["plates"].setdefault(name, {})
        entry.update({
            "file": f"{name}.jpg",
            # Per-plate, not only at the top: the record kept saying 2.0.0 on
            # every plate while the top-level field said 4.0.0, because the
            # round-2 installer wrote it here and the round-4 one only wrote
            # it there. A per-plate version that never moves is worse than
            # none -- it reads as "this plate was not regenerated".
            "pipeline_version": v4.PIPELINE_VERSION,
            "mechanism": spec["subject"].split(".")[0].replace("Subject: ", ""),
            "generation_aspect": spec["aspect"],
            "final_aspect": aspect,
            "image_size": spec["image_size"],
            "raw_size": raw,
            "size": list(size),
            "bytes": written,
            "source_render": os.path.basename(src),
            "candidates": 6,
            "chosen": str(index),
            "chosen_rationale": why or "cleanest crop and the steadiest grid of the six",
            "prompt": v4.prompt(name),
        })
        entry.pop("prompt_other", None)
        print(f"{name}: {os.path.basename(src)} {raw} -> {size} {written} bytes")

    # Write through a temp file in the same directory and rename over the
    # original: PROVENANCE.json is the only record of which candidate was
    # taken and why, and a run interrupted midway through json.dump would
    # leave it truncated with no way back except the last commit.
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(record, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    os.replace(tmp, path)
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
