#!/usr/bin/env python3
"""Render Port Daddy Open Graph social cards (1200x630).

Warm Swiss editorial design:
  - cream background (#f2eee6 base, #f7f3eb raised panel)
  - Fraunces (display serif) for the headline
  - Source Sans 3 for eyebrow / subtitle / footer
  - cobalt (#003fb8) accent rule + dot, teal (#006b5f) secondary accent
  - indigo-black (#1A1A2E) text + hairline frame
  - the real Port Daddy brand mark + "Port Daddy" wordmark, top-left

Input contract (unchanged): a JSON payload with publicDir, outputDir, and a
`routes` list of {image, route, title, description, section, sectionLabel,
sourceImage}. Only the styling changed; the wiring in generate-og-cards.mjs is
preserved. `sourceImage` is now optional (the flat design no longer embeds a
screenshot).
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH = 1200
HEIGHT = 630

# Warm Swiss palette
CREAM = (242, 238, 230)        # #f2eee6  page background
RAISED = (247, 243, 235)       # #f7f3eb  raised panel
INK = (26, 26, 46)             # #1A1A2E  indigo-black text + outline
INK_SOFT = (74, 74, 96)        # muted body text
COBALT = (0, 63, 184)          # #003fb8  primary accent
TEAL = (0, 107, 95)            # #006b5f  secondary accent
HAIRLINE = (210, 204, 192)     # faint warm rule

FONT_DIR = Path(__file__).resolve().parent / "og-fonts"
FRAUNCES_SEMIBOLD = FONT_DIR / "Fraunces-Display-SemiBold.ttf"
FRAUNCES_REGULAR = FONT_DIR / "Fraunces-Display-Regular.ttf"
SOURCE_SEMIBOLD = FONT_DIR / "SourceSans3-SemiBold.ttf"
SOURCE_REGULAR = FONT_DIR / "SourceSans3-Regular.ttf"
LOGO_MARK = FONT_DIR / "pd_logo_mark.png"

_FONT_CACHE: dict = {}


def _load(path: Path, size: int) -> ImageFont.FreeTypeFont:
    key = (str(path), size)
    cached = _FONT_CACHE.get(key)
    if cached is not None:
        return cached
    if path.exists():
        f = ImageFont.truetype(str(path), size=size)
    else:  # pragma: no cover - defensive fallback only
        f = ImageFont.load_default(size=size)
    _FONT_CACHE[key] = f
    return f


def fraunces(size: int, semibold: bool = True) -> ImageFont.FreeTypeFont:
    return _load(FRAUNCES_SEMIBOLD if semibold else FRAUNCES_REGULAR, size)


def source(size: int, semibold: bool = False) -> ImageFont.FreeTypeFont:
    return _load(SOURCE_SEMIBOLD if semibold else SOURCE_REGULAR, size)


def strip_brand(title: str, route_path: str) -> str:
    if route_path == "/":
        return "Local coordination for AI coding agents"
    return title.removesuffix(" - Port Daddy")


def text_width(draw, text, text_font) -> int:
    box = draw.textbbox((0, 0), text, font=text_font)
    return box[2] - box[0]


def wrap_text(draw, text, text_font, max_width, max_lines):
    words = text.replace("\n", " ").split()
    lines = []
    current = ""

    for word in words:
        candidate = f"{current} {word}".strip()
        if not current or text_width(draw, candidate, text_font) <= max_width:
            current = candidate
            continue
        lines.append(current)
        current = word
        if len(lines) >= max_lines:
            break

    if current and len(lines) < max_lines:
        lines.append(current)

    original = " ".join(words)
    if lines and len(" ".join(lines)) < len(original):
        while lines[-1] and text_width(draw, f"{lines[-1].rstrip(' ,.:;')}…", text_font) > max_width:
            lines[-1] = " ".join(lines[-1].split()[:-1])
        lines[-1] = f"{lines[-1].rstrip(' ,.:;')}…"

    return lines


def draw_multiline(draw, position, lines, text_font, fill, line_height, tracking=0):
    x, y = position
    for index, line in enumerate(lines):
        if tracking:
            cx = x
            for ch in line:
                draw.text((cx, y + index * line_height), ch, font=text_font, fill=fill)
                cx += text_width(draw, ch, text_font) + tracking
        else:
            draw.text((x, y + index * line_height), line, font=text_font, fill=fill)


def title_layout(title: str):
    """Pick a Fraunces size + max lines so headlines stay >=64px and legible."""
    n = len(title)
    if n <= 30:
        return 96, 2, 102
    if n <= 52:
        return 82, 3, 90
    if n <= 84:
        return 70, 3, 78
    return 64, 4, 72


def draw_card(route, public_dir, logo_path):
    canvas = Image.new("RGB", (WIDTH, HEIGHT), CREAM)
    draw = ImageDraw.Draw(canvas)

    margin = 56
    # Raised panel inside a hairline frame for a confident, quiet surface.
    draw.rectangle((margin, margin, WIDTH - margin, HEIGHT - margin), fill=RAISED)
    draw.rectangle((margin, margin, WIDTH - margin, HEIGHT - margin), outline=INK, width=2)

    content_left = margin + 56          # 112
    content_right = WIDTH - margin - 56  # 1032
    content_width = content_right - content_left

    # --- Brand lockup: real mark + wordmark, top-left ---
    logo_top = margin + 44
    logo_size = 64
    if logo_path.exists():
        logo = Image.open(logo_path).convert("RGBA").resize(
            (logo_size, logo_size), Image.Resampling.LANCZOS
        )
        canvas.paste(logo, (content_left, logo_top), logo)
    word_x = content_left + logo_size + 22
    draw.text((word_x, logo_top + 4), "Port", font=fraunces(40, semibold=True), fill=INK)
    port_w = text_width(draw, "Port", fraunces(40, semibold=True))
    draw.text((word_x + port_w + 12, logo_top + 4), "Daddy", font=fraunces(40, semibold=True), fill=COBALT)
    draw.text(
        (word_x, logo_top + 50),
        "Local agent coordination",
        font=source(19, semibold=False),
        fill=INK_SOFT,
    )

    # --- Eyebrow: section label, cobalt, tracked-out, with a leading rule ---
    eyebrow_y = 244
    label = (route.get("sectionLabel") or route.get("section") or "Port Daddy").upper()
    draw.rectangle((content_left, eyebrow_y + 9, content_left + 40, eyebrow_y + 12), fill=COBALT)
    draw_multiline(
        draw,
        (content_left + 56, eyebrow_y),
        [label],
        source(20, semibold=True),
        COBALT,
        0,
        tracking=2,
    )

    # Footer sits at a fixed height; everything above must fit in the budget.
    footer_y = HEIGHT - margin - 58
    title_top = eyebrow_y + 48

    # --- Headline (Fraunces) ---
    # Choose the largest size whose wrapped lines fit between title_top and the
    # description zone, so the headline never crashes into the footer.
    title = strip_brand(route["title"], route["route"])
    desc = route.get("description") or ""
    desc_font = source(24, semibold=False)
    desc_line_h = 33
    desc_gap = 22  # space between headline and description block

    # Reserve room for up to 2 description lines (or 0 if no description).
    desc_lines_planned = wrap_text(draw, desc, desc_font, content_width, 2) if desc else []
    desc_block_h = (len(desc_lines_planned) * desc_line_h + desc_gap) if desc_lines_planned else 0
    title_zone_bottom = footer_y - 28 - desc_block_h

    size, max_lines, line_height = title_layout(title)
    tfont = fraunces(size, semibold=True)
    title_lines = wrap_text(draw, title, tfont, content_width, max_lines)
    # Shrink if the chosen size overflows the available vertical zone.
    while (title_top + len(title_lines) * line_height > title_zone_bottom) and size > 52:
        size -= 6
        line_height = int(size * 1.06)
        tfont = fraunces(size, semibold=True)
        title_lines = wrap_text(draw, title, tfont, content_width, max_lines + 1)

    draw_multiline(draw, (content_left, title_top), title_lines, tfont, INK, line_height)
    title_bottom = title_top + len(title_lines) * line_height

    # --- Subtitle / description (Source Sans 3) ---
    if desc_lines_planned:
        draw_multiline(
            draw,
            (content_left, title_bottom + desc_gap),
            desc_lines_planned,
            desc_font,
            INK_SOFT,
            desc_line_h,
        )

    # --- Footer: cobalt URL chip + teal tagline, above the bottom frame edge ---
    draw.line((content_left, footer_y, content_right, footer_y), fill=HAIRLINE, width=2)
    chip_font = source(20, semibold=True)
    url = "portdaddy.dev"
    url_w = text_width(draw, url, chip_font)
    draw.rectangle((content_left, footer_y + 18, content_left + url_w + 36, footer_y + 56), fill=COBALT)
    draw.text((content_left + 18, footer_y + 25), url, font=chip_font, fill=RAISED)
    draw.ellipse(
        (content_left + url_w + 64, footer_y + 33, content_left + url_w + 74, footer_y + 43),
        fill=TEAL,
    )
    draw.text(
        (content_left + url_w + 88, footer_y + 26),
        "Sessions, claims, notes, channels, recoverable handoffs.",
        font=source(20, semibold=False),
        fill=INK_SOFT,
    )

    return canvas


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: render-og-cards.py <input-json>")

    payload = json.loads(Path(sys.argv[1]).read_text())
    public_dir = Path(payload["publicDir"])
    output_dir = Path(payload["outputDir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    logo_path = Path(payload.get("logoPath") or LOGO_MARK)

    rendered = 0
    for route in payload["routes"]:
        image = draw_card(route, public_dir, logo_path)
        output_path = public_dir / route["image"].lstrip("/")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(output_path, "JPEG", quality=84, optimize=True, progressive=True)
        rendered += 1

    print(f"Rendered {rendered} route card image(s).")


if __name__ == "__main__":
    main()
