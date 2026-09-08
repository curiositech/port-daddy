#!/usr/bin/env python3
"""Regenerate the Swiss plates with nano banana, round 3.

Round 2's renders read as Microsoft Paint. Two causes, both in the prompt
rather than in the model:

1. Every round-2 prompt appended a shared GRID block asking for "a quiet
   lattice of hairline-thin near-black construction rules ... with one running
   at exactly 45 degrees". The model drew them, crudely and inconsistently, on
   nearly every plate. They read as leftover scaffolding, not as structure --
   and they are wrong on the merits: a Muller-Brockmann poster is *disciplined*
   by its grid, it does not print it. That block is dropped entirely here.

2. The precision language was aspirational ("perfectly circular", "no
   waviness") but sat at the end of a long paragraph of scene description. It
   is hoisted here into its own short, imperative block at the top of the
   prompt, phrased as the production method rather than as an adjective:
   plotter-cut vinyl and screenprint, not drawing.

Everything else -- the palette, the per-plate composition, the reserved
lettering band -- is carried over from swiss_prompts.PLATES unchanged.

Usage:
    set -a; . "$SP/secrets/gemini.env"; set +a
    python3 scripts/whitepaper-plates/swiss_regen.py --out DIR --only cover
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import swiss_prompts as sp  # noqa: E402

GENERATE = os.path.expanduser("~/.claude/skills/nano-banana-image-gen/scripts/generate.py")

# Hoisted to the top of every prompt. Stated as a production method, because
# "draw a perfect circle" is a wish and "this was cut on a plotter" is a
# description of an artefact the model has seen a great deal of.
PRECISION = (
    "PRODUCTION METHOD, and the single most important property of this image: this plate was "
    "not drawn by hand. Every shape was cut on a vinyl plotter from mathematically defined "
    "geometry and screenprinted as one flat pass of opaque ink on paper. Consequently: every "
    "circular form is a true circle or a true segment of one, holding exactly one constant "
    "radius along its whole length; where an arc is broken and resumed, both parts lie on the "
    "SAME circle at the same radius and the same band thickness, so the eye reads one interrupted "
    "ring rather than two unrelated curves. Every band holds one constant thickness end to end. "
    "Every straight edge is dead straight and every corner is a true right angle. Shapes that "
    "share a baseline, a centre line or an edge share it exactly. Nothing wobbles, tapers, "
    "frays or varies in width. There is no sketch quality, no marker or brush character, no "
    "hand-inked look, no rounded-off corners where corners are meant to be sharp.\n\n"
)

# Replaces the deleted GRID block: say what must NOT appear, since round 2
# proved the model will happily add marks if the prompt leaves room.
NO_MARKS = (
    "\n\nNothing appears on the sheet except the shapes described above on bare paper. In "
    "particular there are absolutely no construction lines, no guide lines, no grid, no "
    "hairline rules, no diagonal line across the picture, no tick marks, no crop or registration "
    "marks, no drop shadows, no outlines around filled shapes, no gradients, no paper texture "
    "effects, no lettering, numerals or symbols of any kind."
)


def rebuild(name: str, spec: dict) -> str:
    """The chosen round-2 prompt, minus the construction grid, plus precision."""
    body = spec[spec.get("chosen", "a")]
    # Drop the shared GRID paragraph wherever it landed in the body.
    body = body.replace(sp.GRID, "")
    # And any residual sentence that invites construction rules.
    body = re.sub(r"[^.]*\bconstruction (?:rule|hairline|line)s?\b[^.]*\.\s*", "", body)
    return PRECISION + body.strip() + NO_MARKS


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", action="append")
    ap.add_argument("--style", help="style-template image for the non-cover plates")
    ap.add_argument("--candidates", type=int, default=1,
                    help="how many renders to make per plate, written as NAME-1.png, "
                         "NAME-2.png ... Volume is how precision is actually bought from "
                         "an image model: round 3 proved that no amount of prompt language "
                         "makes chapter-stp's two arcs share a radius, but a handful of "
                         "candidates will contain one where they do. Pick by eye, then "
                         "record the pick in PROVENANCE.json's chosen/chosen_rationale.")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.dry_run and not os.environ.get("GEMINI_API_KEY"):
        raise SystemExit("GEMINI_API_KEY is not set; source the secrets env file first")

    os.makedirs(args.out, exist_ok=True)
    names = args.only or list(sp.PLATES)
    for name in names:
        spec = sp.PLATES[name]
        scene = rebuild(name, spec)
        if args.dry_run:
            print(f"--- {name} ({spec['aspect']}, {len(scene)} chars) ---")
            print(scene[:600] + "...\n")
            continue
        for i in range(1, args.candidates + 1):
            stem = name if args.candidates == 1 else f"{name}-{i}"
            out = os.path.join(args.out, f"{stem}.png")
            cmd = [sys.executable, GENERATE, "--scene", scene, "--out", out,
                   "--aspect", spec["aspect"], "--image-size", "4K", "--no-fallback"]
            if spec.get("style") and args.style:
                cmd += ["--style", args.style]
            print(f"generating {stem} ...", flush=True)
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode != 0:
                print(f"  FAILED {stem}: {r.stderr.strip()[-400:]}", file=sys.stderr)
            else:
                print(f"  wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
