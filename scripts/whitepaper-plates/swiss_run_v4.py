#!/usr/bin/env python3
"""Render the round-4 Swiss plates with nano banana, N candidates each.

Round 4 changed the design rather than the wording (see swiss_prompts_v4.py):
a hard modular grid, flat signal-colour planes, and a high-contrast halftone
photograph from the chapter's own world cropped square to that grid. What no
prompt can buy is a held radius or a clean crop on the first try, so this
renders N candidates per plate and leaves the picking to the eye.

The cover is rendered first and alone, because every other plate takes the
chosen cover as its style reference -- that is what keeps thirteen separate
generations reading as one book.

Usage:
    set -a; . "$SP/secrets/gemini.env"; set +a
    python3 scripts/whitepaper-plates/swiss_run_v4.py --out DIR --only cover -n 6
    python3 scripts/whitepaper-plates/swiss_run_v4.py --out DIR --skip cover \\
        --style DIR/cover-3.png -n 6 --workers 4
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import swiss_prompts_v4 as v4  # noqa: E402

# The image generator lives outside this repository, in the skill library, so
# its path cannot be a repo-relative one. It is not hard-coded either: set
# PD_NANO_BANANA to point at another checkout, and the default is the standard
# install location rather than one machine's. A reviewer was right that a bare
# ~/.claude path made this script unrunnable by anyone whose skills live
# elsewhere.
GENERATE = os.path.expanduser(
    os.environ.get("PD_NANO_BANANA",
                   "~/.claude/skills/nano-banana-image-gen/scripts/generate.py"))


def render(job: tuple[str, dict, int, str, str | None]) -> tuple[str, bool, str]:
    name, spec, index, out_dir, style = job
    stem = f"{name}-{index}"
    out = os.path.join(out_dir, f"{stem}.png")
    if os.path.exists(out) and os.path.getsize(out) > 0:
        return stem, True, "already present"
    if not os.path.isfile(GENERATE):
        # Say which path was tried and how to change it, rather than failing
        # later inside the subprocess with a bare "No such file or directory".
        raise SystemExit(
            f"image generator not found at {GENERATE}\n"
            f"Set PD_NANO_BANANA to the path of nano-banana-image-gen's "
            f"scripts/generate.py in your own skill library.")
    cmd = [sys.executable, GENERATE,
           "--scene", v4.prompt(name),
           "--out", out,
           "--aspect", spec["aspect"],
           "--image-size", spec["image_size"],
           "--no-fallback"]
    if spec.get("style") and style:
        cmd += ["--style", style]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        # The generator's useful line is usually the last one, but an API
        # error body can run long and the cause sits inside it, so keep enough
        # to read rather than a 300-character tail.
        return stem, False, result.stderr.strip()[-2000:]
    return stem, True, out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", action="append", help="render just these plates")
    ap.add_argument("--skip", action="append", default=[], help="skip these plates")
    ap.add_argument("--style", help="chosen cover render, used as the style template")
    ap.add_argument("-n", "--candidates", type=int, default=6)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not args.dry_run and not os.environ.get("GEMINI_API_KEY"):
        raise SystemExit("GEMINI_API_KEY is not set; source the secrets env file first")

    os.makedirs(args.out, exist_ok=True)
    names = [n for n in (args.only or list(v4.PLATES)) if n not in args.skip]

    jobs = [(name, v4.PLATES[name], i, args.out, args.style)
            for name in names
            for i in range(1, args.candidates + 1)]

    if args.dry_run:
        for name in names:
            print(f"--- {name} ({v4.PLATES[name]['aspect']}) x{args.candidates} ---")
            print(v4.prompt(name)[:400] + " ...\n")
        return 0

    failures = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for stem, ok, detail in pool.map(render, jobs):
            if ok:
                print(f"  ok   {stem}  {detail}", flush=True)
            else:
                failures += 1
                print(f"  FAIL {stem}: {detail}", file=sys.stderr, flush=True)
    print(f"done: {len(jobs) - failures}/{len(jobs)} rendered")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
