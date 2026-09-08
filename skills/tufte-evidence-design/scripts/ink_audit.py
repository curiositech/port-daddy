#!/usr/bin/env python3
"""
ink_audit.py — heuristic data-ink / chartjunk audit for a rendered PNG figure.

Tufte's data-ink ratio (data-ink / total ink) is a design principle, not a
measurable property of a rasterized image: a computer can't tell which pixels
encode "data" versus "decoration" without knowing what the chart means. This
script instead computes cheap, honest PROXIES a human reviewer can sanity-check
a figure against, and says so loudly. Treat every number here as a heuristic
prompt for a human look, never as a pass/fail gate on its own.

What it measures, from pixel data alone:
  - ink_fraction        : fraction of pixels that differ from the dominant
                           (background) color — a rough stand-in for "how much
                           of the page is marked at all."
  - distinct_colors     : count of distinct RGB(A) colors seen. A flat,
                           high-data-ink chart (Tufte's own style) typically
                           uses very few colors; a photographic background,
                           an unflattened gradient, or heavy anti-aliased
                           decoration inflates this a lot.
  - edge_density        : fraction of pixels with a large color jump versus
                           their right/below neighbor — a crude texture/moiré
                           proxy. Heavy gridlines, hatching, and vibration
                           patterns (classic Tufte chartjunk complaints) raise
                           this; a clean line chart on white does not.
  - top_colors          : the most common colors and their pixel share, so a
                           human can eyeball whether the "background" the
                           script picked actually is the background.
  - flags               : plain-English heuristic warnings, each naming which
                           number triggered it and why it MIGHT indicate
                           chartjunk — never a certainty.

Degrades gracefully: uses Pillow if installed (any PNG Pillow can open); with
no Pillow, falls back to a small pure-stdlib PNG decoder that handles the
common case (8-bit depth, non-interlaced, color types 0/2/3/4/6). Anything
else (16-bit, interlaced, exotic color types) without Pillow gets a clear
error telling you to install Pillow rather than a wrong answer.

Usage:
    python3 ink_audit.py figure.png
    python3 ink_audit.py figure.png --json
    python3 ink_audit.py figure.png --background auto|white|0,0,0

Exit codes: 0 on success (even with flags raised — flags are advisory, not
failures), 1 on a file/decode error, 2 on bad arguments.
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
import warnings
import zlib
from collections import Counter
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Image loading: Pillow if available, else a minimal stdlib PNG decoder.
# ---------------------------------------------------------------------------

class DecodedImage:
    """width, height, and a flat list of (r, g, b, a) tuples, row-major."""

    def __init__(self, width: int, height: int, pixels: list):
        self.width = width
        self.height = height
        self.pixels = pixels  # list of (r,g,b,a), len == width*height

    def get(self, x: int, y: int):
        return self.pixels[y * self.width + x]


def _load_with_pillow(path: Path) -> Optional[DecodedImage]:
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        return None
    img = Image.open(path).convert("RGBA")
    width, height = img.size
    with warnings.catch_warnings():
        # Pillow's getdata() is deprecated in favor of get_flattened_data(),
        # not yet available in all supported Pillow versions; suppress the
        # noise rather than require a specific Pillow release.
        warnings.simplefilter("ignore", DeprecationWarning)
        pixels = list(img.getdata())
    return DecodedImage(width, height, pixels)


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def _load_with_stdlib_png(path: Path) -> DecodedImage:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG file (bad signature)")

    pos = 8
    idat = bytearray()
    width = height = bit_depth = color_type = None
    palette = None
    trns = None

    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        ctype = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        pos += 8 + length + 4  # skip CRC

        if ctype == b"IHDR":
            width, height, bit_depth, color_type, _comp, _filt, interlace = (
                struct.unpack(">IIBBBBB", chunk)
            )
            if interlace != 0:
                raise ValueError(
                    "interlaced PNG not supported by the stdlib fallback decoder "
                    "(install Pillow: pip install Pillow)"
                )
            if bit_depth != 8:
                raise ValueError(
                    f"bit depth {bit_depth} not supported by the stdlib fallback "
                    "decoder — only 8-bit PNGs (install Pillow for full support)"
                )
        elif ctype == b"PLTE":
            palette = [tuple(chunk[i:i + 3]) for i in range(0, len(chunk), 3)]
        elif ctype == b"tRNS":
            trns = chunk
        elif ctype == b"IDAT":
            idat += chunk
        elif ctype == b"IEND":
            break

    if width is None:
        raise ValueError("no IHDR chunk found")

    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color_type)
    if channels is None:
        raise ValueError(f"unsupported PNG color type {color_type}")

    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    out_rows = []
    prev = bytearray(stride)
    offset = 0
    for _y in range(height):
        filt = raw[offset]
        offset += 1
        row = bytearray(raw[offset:offset + stride])
        offset += stride
        if filt == 0:
            pass
        elif filt == 1:  # Sub
            for i in range(channels, stride):
                row[i] = (row[i] + row[i - channels]) & 0xFF
        elif filt == 2:  # Up
            for i in range(stride):
                row[i] = (row[i] + prev[i]) & 0xFF
        elif filt == 3:  # Average
            for i in range(stride):
                a = row[i - channels] if i >= channels else 0
                b = prev[i]
                row[i] = (row[i] + ((a + b) // 2)) & 0xFF
        elif filt == 4:  # Paeth
            for i in range(stride):
                a = row[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                row[i] = (row[i] + _paeth(a, b, c)) & 0xFF
        else:
            raise ValueError(f"unknown PNG filter type {filt}")
        out_rows.append(row)
        prev = row

    pixels = []
    trns_gray_or_rgb = None
    if trns and color_type in (0, 2):
        trns_gray_or_rgb = trns

    for row in out_rows:
        for x in range(width):
            base = x * channels
            if color_type == 0:  # grayscale
                g = row[base]
                a = 255
                if trns_gray_or_rgb and len(trns_gray_or_rgb) >= 2:
                    if struct.unpack(">H", trns_gray_or_rgb[:2])[0] & 0xFF == g:
                        a = 0
                pixels.append((g, g, g, a))
            elif color_type == 2:  # truecolor
                r, g, b = row[base], row[base + 1], row[base + 2]
                pixels.append((r, g, b, 255))
            elif color_type == 3:  # palette
                idx = row[base]
                r, g, b = palette[idx] if palette else (0, 0, 0)
                a = 255
                if trns and idx < len(trns):
                    a = trns[idx]
                pixels.append((r, g, b, a))
            elif color_type == 4:  # grayscale+alpha
                g, a = row[base], row[base + 1]
                pixels.append((g, g, g, a))
            elif color_type == 6:  # truecolor+alpha
                r, g, b, a = row[base], row[base + 1], row[base + 2], row[base + 3]
                pixels.append((r, g, b, a))

    return DecodedImage(width, height, pixels)


def load_image(path: Path) -> DecodedImage:
    img = _load_with_pillow(path)
    if img is not None:
        return img
    return _load_with_stdlib_png(path)


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------

def flatten_on_white(rgba):
    """Composite an (r,g,b,a) pixel onto a white background for comparison
    purposes — a transparent PNG's "ink" is what shows once placed on a page."""
    r, g, b, a = rgba
    if a == 255:
        return (r, g, b)
    af = a / 255.0
    return (
        round(r * af + 255 * (1 - af)),
        round(g * af + 255 * (1 - af)),
        round(b * af + 255 * (1 - af)),
    )


def parse_background_arg(value: str):
    if value in (None, "auto"):
        return None
    if value == "white":
        return (255, 255, 255)
    parts = value.split(",")
    if len(parts) != 3:
        raise argparse.ArgumentTypeError(
            "background must be 'auto', 'white', or 'R,G,B'"
        )
    try:
        r, g, b = (int(p.strip()) for p in parts)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("background R,G,B must be integers") from exc
    return (r, g, b)


def audit(img: DecodedImage, background_override=None, sample_stride: int = 1) -> dict:
    n = img.width * img.height
    flat = [flatten_on_white(p) for p in img.pixels]

    color_counts = Counter(flat)
    distinct_colors = len(color_counts)

    if background_override is not None:
        background = background_override
    else:
        background = color_counts.most_common(1)[0][0]

    ink_pixels = sum(count for color, count in color_counts.items() if color != background)
    ink_fraction = ink_pixels / n if n else 0.0

    top_colors = [
        {"rgb": list(color), "fraction": round(count / n, 4)}
        for color, count in color_counts.most_common(8)
    ]

    # Edge density: crude texture/moiré proxy. Sampled (stride) for speed on
    # large images; a stride of 1 checks every pixel.
    def channel_dist(c1, c2):
        return abs(c1[0] - c2[0]) + abs(c1[1] - c2[1]) + abs(c1[2] - c2[2])

    THRESH = 60  # sum of abs channel deltas; tuned to catch hard edges, not AA
    edge_hits = 0
    edge_checked = 0
    w, h = img.width, img.height
    for y in range(0, h, sample_stride):
        row_base = y * w
        for x in range(0, w - 1, sample_stride):
            c1 = flat[row_base + x]
            c2 = flat[row_base + x + 1]
            edge_checked += 1
            if channel_dist(c1, c2) > THRESH:
                edge_hits += 1
            if y + 1 < h:
                c3 = flat[(y + 1) * w + x]
                edge_checked += 1
                if channel_dist(c1, c3) > THRESH:
                    edge_hits += 1
    edge_density = edge_hits / edge_checked if edge_checked else 0.0

    megapixels = n / 1_000_000

    flags = []
    if ink_fraction > 0.55:
        flags.append(
            f"ink_fraction={ink_fraction:.2f} is high for a data graphic — check "
            "for a filled/tinted background, a colored plot-area, or a heavy "
            "border/frame that isn't carrying data (Tufte: erase non-data-ink)."
        )
    if distinct_colors > 5000 and megapixels < 4:
        flags.append(
            f"distinct_colors={distinct_colors} is high for this image size — "
            "check for an unflattened gradient, a photographic/textured "
            "background, or anti-aliasing artifacts standing in for real marks."
        )
    if edge_density > 0.08:
        flags.append(
            f"edge_density={edge_density:.3f} is high — check for heavy "
            "gridlines, hatching/cross-hatch fills, or moiré-like repeating "
            "texture (Tufte's 'vibration' complaint about grids and patterns)."
        )
    if ink_fraction < 0.01:
        flags.append(
            f"ink_fraction={ink_fraction:.3f} is very low — confirm the figure "
            "actually renders data and the background wasn't mis-detected "
            "(try --background white or --background R,G,B)."
        )
    if not flags:
        flags.append(
            "No heuristic flags raised. This does NOT mean the figure is good "
            "Tufte design — data-ink ratio, chartjunk, and the Lie Factor are "
            "judgments about MEANING no pixel-counter can make. Read "
            "references/doctrines.md and use the SKILL.md checklists for the "
            "judgment call; use these numbers only as a second opinion."
        )

    return {
        "file_info": {"width": img.width, "height": img.height, "megapixels": round(megapixels, 2)},
        "background_rgb": list(background),
        "background_source": "override" if background_override is not None else "auto (mode color)",
        "ink_fraction": round(ink_fraction, 4),
        "distinct_colors": distinct_colors,
        "edge_density": round(edge_density, 4),
        "top_colors": top_colors,
        "flags": flags,
        "caveat": (
            "All numbers are pixel-level heuristics, not a measurement of "
            "Tufte's data-ink ratio (which requires knowing what the data IS). "
            "Use this as a prompt for human review, not an automated gate."
        ),
    }


def format_human(result: dict) -> str:
    lines = []
    fi = result["file_info"]
    lines.append(f"Image: {fi['width']}x{fi['height']} px ({fi['megapixels']} MP)")
    lines.append(
        f"Background: rgb{tuple(result['background_rgb'])} "
        f"({result['background_source']})"
    )
    lines.append(f"Ink fraction:     {result['ink_fraction']:.4f}")
    lines.append(f"Distinct colors:  {result['distinct_colors']}")
    lines.append(f"Edge density:     {result['edge_density']:.4f}")
    lines.append("")
    lines.append("Top colors (rgb, fraction of pixels):")
    for c in result["top_colors"]:
        lines.append(f"  {tuple(c['rgb'])!s:<18} {c['fraction']:.4f}")
    lines.append("")
    lines.append("Flags:")
    for f in result["flags"]:
        lines.append(f"  - {f}")
    lines.append("")
    lines.append(result["caveat"])
    return "\n".join(lines)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Heuristic data-ink / chartjunk proxy audit for a PNG figure."
    )
    parser.add_argument("image", type=Path, help="path to a PNG file")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of text")
    parser.add_argument(
        "--background",
        default="auto",
        help="'auto' (most common color, default), 'white', or 'R,G,B'",
    )
    parser.add_argument(
        "--stride",
        type=int,
        default=1,
        help="sample every Nth pixel for edge density on large images (default 1)",
    )
    args = parser.parse_args(argv)

    if not args.image.exists():
        print(f"error: no such file: {args.image}", file=sys.stderr)
        return 1
    if args.image.suffix.lower() != ".png":
        print(
            "error: this tool only decodes PNG directly. Convert other formats "
            "with e.g. `magick input.jpg output.png` or install Pillow, which "
            "this script will also use to open other formats if you rename the "
            "extension is not sufficient — Pillow is chosen by import, not by "
            "filename, so a real PNG (magic bytes 89 50 4E 47) is required.",
            file=sys.stderr,
        )
        return 2

    try:
        background_override = parse_background_arg(args.background)
    except argparse.ArgumentTypeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    try:
        img = load_image(args.image)
    except Exception as exc:  # noqa: BLE001 - surface any decode failure plainly
        print(f"error decoding {args.image}: {exc}", file=sys.stderr)
        return 1

    result = audit(img, background_override=background_override, sample_stride=max(1, args.stride))

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(format_human(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
