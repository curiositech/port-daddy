#!/usr/bin/env python3
"""
Generate 14 ship-avatar personae for the Port Daddy fleet via Nano Banana Pro.

Each ship gets a character avatar in the brand palette (cobalt #003fb8,
deep teal/sage #006b5f, cream #f2eee6, near-black #1f1f1f). The style is
editorial-illustration-meets-architectural-blueprint: flat shapes, decisive
linework, halftone shading accents, a single readable figure.

Outputs:
  assets/ship-avatars/<ship>/avatar-512.png  (Nano Banana Pro, 1:1)
  assets/ship-avatars/<ship>/avatar-128.png  (PIL Lanczos downscale)
  assets/ship-avatars/<ship>/avatar-64.png   (PIL Lanczos downscale)

Runs SEQUENTIALLY (per CLAUDE.md image-gen guidance), with retry-on-fail.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

# Repo root resolves relative to this script (scripts/ship-avatars/generate_fleet.py)
REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_ROOT = REPO_ROOT / "assets" / "ship-avatars"
LOG_DIR = Path.home() / "coding" / "tmp" / "ship-avatars-work" / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MODEL_PRO = "gemini-3-pro-image-preview"
MODEL_FALLBACK = "gemini-2.5-flash-image"

# Shared style preamble — every prompt inherits this DNA.
STYLE_PREAMBLE = (
    "An editorial character portrait, square 1:1 composition, designed for use "
    "as a circular avatar (the subject's head and shoulders sit comfortably inside "
    "the central circle; nothing important touches the corners). "
    "Visual style: flat editorial illustration with a subtle architectural-blueprint "
    "sensibility — confident clean linework, halftone-dot or fine-hatching shading, "
    "no painterly rendering, no photorealism, no 3D, no glossy chrome, no anime style, "
    "no pixel art. "
    "Strict four-color palette only: warm cream background (#f2eee6), cobalt blue "
    "(#003fb8) as the dominant accent color, deep teal-sage green (#006b5f) as a "
    "secondary accent, and near-black ink (#1f1f1f) for outlines and shadow. "
    "Absolutely no other colors — no reds, no yellows, no purples, no skin-pink. "
    "Skin and faces should be rendered in flat warm cream tones with cobalt or "
    "ebony linework, like a Patrick Leger or a New Yorker spot illustration. "
    "The background is plain cream with at most a single soft cobalt or sage shape "
    "behind the subject (a circle, an arch, a faint blueprint grid). "
    "The figure is centered, occupies most of the frame at head-and-shoulders or "
    "three-quarter view, and reads clearly even at 64x64 pixels. "
    "Single figure only, no text labels, no captions, no signatures, no logos."
)

# 14 ship personae. order matters for the ROSTER.md grid.
SHIPS = [
    {
        "name": "code-reviewer",
        "family": "critical",
        "blurb": "Opinionated senior eng with operator's priors. Carries the weight of every ADR.",
        "scene": (
            "A stern but kind-eyed editor in a workshop apron, mid-thirties, "
            "head-and-shoulders portrait facing slightly off-camera. They wear a "
            "cobalt-blue workshop apron over a cream shirt. In one hand they hold "
            "a single red pen — the ONLY non-palette color in the entire image, a "
            "deliberate accent. A pair of small wire-rim reading glasses sits "
            "halfway down their nose. Behind them, a faint sage-green diagonal "
            "blueprint grid. Their expression: someone who has read your work "
            "carefully and is about to be honest about it."
        ),
    },
    {
        "name": "red-team",
        "family": "critical",
        "blurb": "The honest adversary. Looks for what could go wrong. Civil but not cuddly.",
        "scene": (
            "A fencer in mid-en-garde stance, masked, viewed from the chest up so "
            "the mask is the focal point. The fencing mask is sage-green wire mesh "
            "with a cobalt-blue trim. They wear a cream-white fencing jacket with "
            "cobalt piping. One gloved hand grips the hilt of a foil that runs "
            "diagonally across the lower frame. The mask hides their face entirely "
            "— a deliberate, sportive anonymity, not menacing. Behind: a single "
            "soft cobalt circle suggesting a target."
        ),
    },
    {
        "name": "test-author",
        "family": "generative",
        "blurb": "Patient craftsperson. Writes the tests you knew you needed.",
        "scene": (
            "A writer at a small wooden desk, three-quarter overhead view that "
            "still shows the face clearly. They sit upright, a cream notebook open "
            "in front of them, a cobalt fountain pen poised in their hand. Their "
            "expression is quiet, focused, mid-thought. They wear a cobalt cardigan "
            "over a cream shirt. Sage-green geometric shapes suggest filing trays "
            "and an inkwell on the desk. Calm and ordered."
        ),
    },
    {
        "name": "tautology-sniffer",
        "family": "critical",
        "blurb": "The unsentimental copyeditor of tests. Suspicious of green ticks.",
        "scene": (
            "A copyeditor at a desk, holding a large round magnifying glass up to "
            "one eye — the glass dominates the composition, distorting that eye "
            "into a comically large but precise circle. They scrutinize a cream "
            "galley proof covered in faint sage halftone dots and tiny cobalt "
            "marginalia. They wear a cobalt vest over a cream shirt. Skeptical "
            "raised eyebrow above the magnified eye. Dry, unsentimental."
        ),
    },
    {
        "name": "tenderfoot",
        "family": "observational",
        "blurb": "Fresh-eyes new dev. Hopeful, asks dumb questions, finds real lies in docs.",
        "scene": (
            "A young apprentice surveyor, early twenties, head-and-shoulders. "
            "They hold a cream clipboard against their chest and look upward and "
            "off-camera, as if studying an enormous building they have never seen "
            "before. Eyes wide, slightly nervous but eager. They wear a sage-green "
            "field jacket over a cream shirt, with a cobalt pencil tucked behind "
            "one ear. Hair short and a little unkempt. Hopeful expression."
        ),
    },
    {
        "name": "augur",
        "family": "critical",
        "blurb": "Diviner who reads contradictions in plans. Predicts future bugs.",
        "scene": (
            "An elderly figure in a flowing classical toga, head-and-shoulders, "
            "looking upward as if reading the sky. The toga is deep cobalt-blue "
            "with a single sage-green border stripe. White hair, lined face "
            "rendered in flat cream with fine cobalt linework. A small sage-green "
            "bird in mid-flight passes through the upper background. A faint "
            "cobalt geometric halo arcs behind their head. Solemn, knowing."
        ),
    },
    {
        "name": "gardener",
        "family": "maintenance",
        "blurb": "Quiet, methodical. Tends git history like a garden.",
        "scene": (
            "A gloved figure in profile, pruning a small ornamental tree whose "
            "branches form the unmistakable shape of a git commit graph — three "
            "parallel branch lines with merge nodes drawn as sage-green circles. "
            "They wear a cobalt-blue work coat and cream gardening gloves, and "
            "hold a small pair of pruning shears. Quiet, methodical expression. "
            "The little tree sits in a cream terracotta pot."
        ),
    },
    {
        "name": "qa",
        "family": "critical",
        "blurb": "Post-commit smoke-tester. Boring, deterministic, useful.",
        "scene": (
            "A quality inspector with a cream clipboard tucked under one arm and "
            "a wooden-handled approval stamp raised in the other hand, mid-stamp. "
            "They wear a cobalt-blue jumpsuit with a sage-green name-badge shape "
            "on the chest (no readable text on it, just a sage rectangle). Their "
            "expression is pragmatic and slightly tired but reliable. A small "
            "checkmark shape, in sage, floats subtly behind them."
        ),
    },
    {
        "name": "test-hunter",
        "family": "observational",
        "blurb": "Coverage cartographer. Maps gaps.",
        "scene": (
            "A tracker in a sage-green field coat, crouched slightly, reading a "
            "large cream paper map laid across their forearm like a hunter reads "
            "tracks. They wear a cobalt-blue scarf wrapped at the neck. The map "
            "shows abstract cobalt contour lines and small sage X marks. Their "
            "eyes scan the page intently. Outdoors-rugged but precise."
        ),
    },
    {
        "name": "documentarian",
        "family": "maintenance",
        "blurb": "Scribe. Watches code-doc drift.",
        "scene": (
            "A monkish scribe seated at a tall sloped desk, three-quarter view, "
            "writing on a cream parchment with a slender cobalt-tipped feather pen. "
            "An ink-pot in sage-green sits at the corner of the desk. They wear a "
            "cobalt robe with a cream collar. Behind them, a tall narrow window "
            "lets a single soft sage-green shaft of light fall onto the page. "
            "Patient, careful expression."
        ),
    },
    {
        "name": "simplifier",
        "family": "maintenance",
        "blurb": "Refactor monk. Cuts what can be cut.",
        "scene": (
            "A sculptor in a cream apron, mid-three-quarter view, holding a small "
            "wooden mallet in one hand and a steel chisel in the other against a "
            "rough cobalt-blue block of marble. Small chipped fragments of cobalt "
            "stone are scattered on the cream floor at their feet. Their "
            "expression is calm, contemplative — already seeing the simpler shape "
            "inside the block. Sage-green geometric dust motes in the air."
        ),
    },
    {
        "name": "cartographer",
        "family": "observational",
        "blurb": "Roadmap mapmaker. Sees the project as a territory.",
        "scene": (
            "A mapmaker at a drafting table, three-quarter overhead view that "
            "still shows the face. They lean over a large cream sheet showing "
            "faint cobalt blueprint lines and a delicate sage-green compass rose "
            "in the lower corner of the sheet. A cobalt T-square and a sage "
            "triangle ruler rest beside their hand. They wear a cobalt-blue vest "
            "and cream shirt with sleeves rolled. Absorbed in the work."
        ),
    },
    {
        "name": "spark",
        "family": "generative",
        "blurb": "Idea spotter. Lights up when a pattern surfaces.",
        "scene": (
            "An ideating figure in three-quarter view, holding a small lit oil "
            "lantern up beside their face. The lantern's glow is rendered as a "
            "soft sage-green halftone-dotted aura on their cheek and on the open "
            "cream notebook in their other hand. Their expression: just-saw-it — "
            "eyes wide, the small involuntary half-smile of pattern recognition. "
            "They wear a cobalt sweater. Dark sage background suggesting night."
        ),
    },
    {
        "name": "spider",
        "family": "generative",
        "blurb": "External crawler. Brings news from outside the harbor.",
        "scene": (
            "A wiry explorer in a cobalt-blue field coat, head-and-shoulders "
            "portrait. A coil of cream rope is slung diagonally across their "
            "chest. They carry a small leather-bound sage-green notebook in one "
            "hand. Wind-tousled hair. Behind their shoulder, a faint sage-green "
            "web-like pattern of crisscrossing lines suggests the world beyond "
            "the harbor. Their expression: alert, just-returned, with news to "
            "share."
        ),
    },
]


def get_api_key() -> str:
    env_file = Path.home() / "coding" / "jbuds4life" / "next-app" / ".env.local"
    if not env_file.exists():
        sys.exit(f"Cannot find {env_file}")
    for line in env_file.read_text().splitlines():
        if line.startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("GEMINI_API_KEY not found in env.local")


def call_gemini(api_key: str, model: str, prompt: str, timeout: int = 240) -> bytes:
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": "1:1"},
        },
    }
    req = urllib.request.Request(
        ENDPOINT.format(model=model),
        data=json.dumps(body).encode(),
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode())

    cand = data.get("candidates", [{}])[0]
    finish = cand.get("finishReason")
    parts = cand.get("content", {}).get("parts", [])
    for p in parts:
        inline = p.get("inlineData") or p.get("inline_data")
        if inline and inline.get("data"):
            return base64.b64decode(inline["data"])
        if "text" in p:
            sys.stderr.write(f"  [model-text] {p['text'][:200]}\n")
    raise RuntimeError(f"No image in response (finishReason={finish})")


def generate_one(ship: dict, api_key: str, force: bool = False) -> bool:
    name = ship["name"]
    out_dir = OUT_ROOT / name
    out_dir.mkdir(parents=True, exist_ok=True)
    out_512 = out_dir / "avatar-512.png"
    out_128 = out_dir / "avatar-128.png"
    out_64 = out_dir / "avatar-64.png"

    if out_512.exists() and out_128.exists() and out_64.exists() and not force:
        print(f"[skip] {name} already done")
        return True

    prompt = (
        f"{STYLE_PREAMBLE}\n\n"
        f"Subject — {name.upper()}:\n{ship['scene']}\n\n"
        "Render as a square 1:1 portrait avatar. Keep the figure's head centered "
        "in the upper-middle area so the avatar reads cleanly when cropped to a "
        "circle. No text, no captions, no logos, no signatures anywhere in the "
        "image."
    )

    log_path = LOG_DIR / f"{name}.log"
    log_path.write_text(prompt)
    print(f"[gen] {name} ...", flush=True)

    last_err = None
    for attempt, model in enumerate([MODEL_PRO, MODEL_PRO, MODEL_FALLBACK], 1):
        try:
            t0 = time.time()
            img_bytes = call_gemini(api_key, model, prompt)
            elapsed = time.time() - t0
            out_512.write_bytes(img_bytes)

            # Normalize to 512x512 (the model may return ~1024 or odd dims).
            with Image.open(out_512) as im:
                im = im.convert("RGB")
                if im.size != (512, 512):
                    im = im.resize((512, 512), Image.LANCZOS)
                    im.save(out_512, format="PNG", optimize=True)
                im_128 = im.resize((128, 128), Image.LANCZOS)
                im_128.save(out_128, format="PNG", optimize=True)
                im_64 = im.resize((64, 64), Image.LANCZOS)
                im_64.save(out_64, format="PNG", optimize=True)

            print(
                f"  ok {name} via {model} in {elapsed:.1f}s "
                f"({out_512.stat().st_size // 1024}KB)"
            )
            return True
        except urllib.error.HTTPError as e:
            body = e.read().decode() if e.fp else ""
            print(f"  http {e.code} attempt {attempt}: {body[:200]}")
            last_err = e
            time.sleep(2 + attempt)
        except Exception as e:
            print(f"  err attempt {attempt}: {e}")
            last_err = e
            time.sleep(2 + attempt)

    print(f"[fail] {name}: {last_err}", file=sys.stderr)
    return False


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated ship names to regenerate")
    ap.add_argument("--force", action="store_true", help="overwrite existing")
    args = ap.parse_args()

    api_key = get_api_key()
    only = set(args.only.split(",")) if args.only else None

    results = {}
    for ship in SHIPS:
        if only and ship["name"] not in only:
            continue
        ok = generate_one(ship, api_key, force=args.force)
        results[ship["name"]] = ok
        time.sleep(0.5)  # gentle pacing

    print()
    print("Summary:")
    for name, ok in results.items():
        print(f"  {'OK ' if ok else 'XX '} {name}")
    failed = [n for n, ok in results.items() if not ok]
    if failed:
        print(f"\n{len(failed)} failed: {failed}")
        sys.exit(1)
    print(f"\n{len(results)} ships generated.")


if __name__ == "__main__":
    main()
