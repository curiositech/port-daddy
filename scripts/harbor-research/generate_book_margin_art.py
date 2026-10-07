"""Generate candidate editorial analogies through the existing Nano Banana client.

Credential is read from GEMINI_API_KEY or a hidden terminal prompt, never saved.
Only the explicit art prompts leave this machine. No manuscript or reference
image is uploaded. Generated art is not evidence of an implemented mechanism.
"""
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import urllib.error

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "nano_client", ROOT / "skills/nano-banana-image-gen/scripts/generate.py")
CLIENT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLIENT)
MODEL = "gemini-3-pro-image"
OUT = ROOT / "website-v2/public/whitepaper/plates/margin-evidence"
COMMON = (
    "Editorial specimen drawing for the margin of a serious technical book. "
    "Crisp black pen linework with sparse crosshatching, one cobalt blue accent, "
    "plain pure white background. Large readable silhouette, composed for a "
    "1.3-inch-wide printed image. No framing border. Surfaces are plain, "
    "unlettered material. The drawing is an explanatory analogy, not a product. "
)
PROMPTS = {
    "sealed-specimen": COMMON +
        "An upright closed laboratory specimen case with opaque black sides, "
        "a tamper-evident cobalt seal across its lid and a small detachable "
        "paper receipt attached outside. The case conceals its contents; the "
        "receipt is blank. Plain white ground and tight framing. An analogy "
        "for revealing an attestation without revealing the underlying evidence.",
    "map-and-lens": COMMON +
        "An unfolded small street map and one large magnifying glass over a "
        "junction. The map contains only a few strong road lines; inside the "
        "lens the same junction reveals smaller paths, drawn in cobalt. "
        "All roads join consistently across the lens boundary. Plain white "
        "ground, tightly framed. Analogy for a summary that retains a route to detail.",
    "rope-splice": COMMON +
        "A short vertical rope splice, the overlapping strands individually "
        "visible. Dark strands enter at the top and cobalt strands leave at "
        "the bottom; they interweave through a long central overlap. Large "
        "simple linework, tightly framed on plain white. An analogy for "
        "continuity maintained by overlapping links rather than an unchanged body.",
    "movable-type": COMMON +
        "A single large woodcut printing block showing an abstract five-leaf "
        "branch in relief, beside two identical cobalt impressions of that "
        "branch on separate blank cards. A clear relation between reusable "
        "master and repeated impressions. All three objects are tightly "
        "composed vertically on pure white. Analogy for licensing a reusable design.",
    "bond-balance": COMMON +
        "An old equal-arm balance, front view, simple heavy black outlines. "
        "A small cobalt ingot in the left pan and three plain unmarked black "
        "weights in the right pan; the pans are level. Tight framing on pure "
        "white. An editorial analogy for weighing gain against expected loss, "
        "not a numerical diagram; all weight surfaces are unlettered.",
    "canal-lock": COMMON +
        "A compact canal lock in a clear three-quarter cutaway. Two sturdy "
        "end gates and a boat contained in the central chamber; the far "
        "gate is closed, the near gate also closed, water cobalt and walls "
        "black crosshatching. Tight white-ground composition. A physical "
        "analogy for custody during a transfer, not a literal computer protocol.",
    "one-printing-press": COMMON +
        "A small hand-operated printing press in three-quarter cutaway view: "
        "one solid metal platen poised immediately above one blank sheet on "
        "a flat bed. Several blank sheets wait together beside the press. "
        "The platen is cobalt; the mechanism black. This single press makes "
        "one impression at a time. Isolated instrument, all of it visible.",
    "reduced-key": COMMON +
        "Two keys laid vertically side by side, their bows at the same height. "
        "The left key has a wide working blade with three teeth. The right "
        "has the same bow and shaft, but only the lowest tooth remains; the "
        "upper two tooth positions are neatly cut away and shown as two "
        "small detached metal chips beside it. Black keys, cobalt cut edges. "
        "A deliberately simplified physical analogy for removing permissions.",
}

def main():
    key = os.environ.get("GEMINI_API_KEY") or getpass.getpass("Nano Banana credential (hidden): ")
    OUT.mkdir(parents=True, exist_ok=True)
    for slug, prompt in PROMPTS.items():
        if (OUT / f"{slug}.png").exists():
            print(f"Keeping existing {slug}.png", flush=True)
            continue
        try:
            data = CLIENT.call_gemini(api_key=key, model=MODEL, prompt=prompt,
                                      refs=[], aspect="3:4", image_size="1K")
        except urllib.error.HTTPError as exc:
            print(f"Generation stopped: provider HTTP {exc.code}. Credential and response body withheld.", flush=True)
            return 1
        except Exception as exc:
            print(f"Generation stopped: {type(exc).__name__}. No credential logged.", flush=True)
            return 1
        (OUT / f"{slug}.png").write_bytes(data)
        (OUT / f"{slug}.json").write_text(json.dumps({
            "model": MODEL, "prompt": prompt, "aspect": "3:4", "image_size": "1K",
            "sha256": hashlib.sha256(data).hexdigest(),
            "role": "generated editorial analogy, not measured evidence",
            "references_uploaded": []}, indent=2) + "\n")
        print(f"Generated {slug}.png", flush=True)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
