#!/usr/bin/env python3
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

WIDTH = 1200
HEIGHT = 630
PAPER = (245, 241, 230)
INK = (16, 24, 32)
MUTED = (49, 66, 82)
BLUE = (15, 38, 57)
LIME = (155, 182, 47)


def font(size, bold=False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default(size=size)


def crop_cover(image, size):
    target_w, target_h = size
    image = image.convert("RGB")
    scale = max(target_w / image.width, target_h / image.height)
    resized = image.resize((math.ceil(image.width * scale), math.ceil(image.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - target_w) // 2
    top = (resized.height - target_h) // 2
    return resized.crop((left, top, left + target_w, top + target_h))


def strip_brand(title, route_path):
    if route_path == "/":
        return "Local coordination for AI coding agents"
    return title.removesuffix(" - Port Daddy")


def text_width(draw, text, text_font):
    box = draw.textbbox((0, 0), text, font=text_font)
    return box[2] - box[0]


def split_long_word(draw, word, text_font, max_width):
    if text_width(draw, word, text_font) <= max_width:
        return [word]

    chunks = []
    current = ""
    for character in word:
        candidate = f"{current}{character}"
        if current and text_width(draw, candidate, text_font) > max_width:
            chunks.append(current)
            current = character
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def wrap_text(draw, text, text_font, max_width):
    words = text.replace("\n", " ").split()
    lines = []
    current = ""

    for word in words:
        for chunk in split_long_word(draw, word, text_font, max_width):
            candidate = f"{current} {chunk}".strip()
            if not current or text_width(draw, candidate, text_font) <= max_width:
                current = candidate
                continue
            lines.append(current)
            current = chunk

    if current:
        lines.append(current)

    return lines


def draw_multiline(draw, position, lines, text_font, fill, line_height):
    x, y = position
    for index, line in enumerate(lines):
        draw.text((x, y + index * line_height), line, font=text_font, fill=fill)


def block_height(lines, line_height):
    return max(0, len(lines) - 1) * line_height + line_height


def layout_text_blocks(draw, title, description):
    max_width = 520
    title_y = 198
    text_bottom = 526

    for title_size in range(52, 27, -2):
        title_font = font(title_size, bold=True)
        title_line_height = round(title_size * 1.08) + 5
        title_lines = wrap_text(draw, title, title_font, max_width)
        title_height = block_height(title_lines, title_line_height)
        if title_height > 210 or len(title_lines) > 5:
            continue

        gap = 26 if len(title_lines) <= 3 else 18
        description_y = title_y + title_height + gap
        available_description_height = text_bottom - description_y
        if available_description_height < 58:
            continue

        for description_size in range(22, 13, -1):
            description_font = font(description_size, bold=True)
            description_line_height = round(description_size * 1.16) + 5
            description_lines = wrap_text(draw, description, description_font, max_width)
            description_height = block_height(description_lines, description_line_height)
            if description_height <= available_description_height:
                return {
                    "title_font": title_font,
                    "title_lines": title_lines,
                    "title_line_height": title_line_height,
                    "description_y": description_y,
                    "description_font": description_font,
                    "description_lines": description_lines,
                    "description_line_height": description_line_height,
                }

    title_font = font(28, bold=True)
    title_line_height = 35
    title_lines = wrap_text(draw, title, title_font, max_width)
    title_height = block_height(title_lines, title_line_height)
    description_y = min(title_y + title_height + 16, 430)
    description_font = font(14, bold=True)
    return {
        "title_font": title_font,
        "title_lines": title_lines,
        "title_line_height": title_line_height,
        "description_y": description_y,
        "description_font": description_font,
        "description_lines": wrap_text(draw, description, description_font, max_width),
        "description_line_height": 21,
    }


def blend_over(base, overlay, alpha):
    return Image.blend(base, overlay, alpha)


def draw_card(route, public_dir, background_path, logo_path):
    canvas = Image.new("RGB", (WIDTH, HEIGHT), PAPER)
    draw = ImageDraw.Draw(canvas)

    background = crop_cover(Image.open(background_path), (WIDTH, HEIGHT)).filter(ImageFilter.GaussianBlur(1.4))
    background = ImageEnhance.Color(background).enhance(0.72)
    canvas = blend_over(canvas, background, 0.25)
    wash = Image.new("RGB", (WIDTH, HEIGHT), PAPER)
    canvas = blend_over(canvas, wash, 0.70)
    draw = ImageDraw.Draw(canvas)

    for index in range(16):
        x = 48 + index * 72
        draw.line((x, 0, x, HEIGHT), fill=(201, 202, 189), width=1)
    for index in range(9):
        y = 52 + index * 64
        draw.line((0, y, WIDTH, y), fill=(201, 202, 189), width=1)

    draw.line([(72, 500), (190, 472), (264, 474), (362, 506), (548, 548), (684, 512), (888, 426), (1128, 462)], fill=(189, 194, 181), width=3)
    draw.line([(112, 132), (318, 132), (352, 164), (548, 164)], fill=(189, 194, 181), width=3)
    draw.line([(112, 526), (410, 526), (452, 492), (622, 492)], fill=(189, 194, 181), width=3)

    source_path = Path(public_dir) / route["sourceImage"].lstrip("/")
    source = crop_cover(Image.open(source_path), (510, 356))
    canvas.paste(source, (618, 78))
    draw.rectangle((618, 78, 1128, 434), outline=INK, width=2)
    draw.rectangle((642, 102, 1104, 410), outline=LIME, width=2)
    draw.rectangle((708, 458, 1128, 494), fill=INK)
    draw.rectangle((618, 458, 690, 494), fill=LIME)
    draw.ellipse((653, 469, 667, 483), fill=INK)
    for index, alpha_fill in enumerate([(245, 241, 230), (200, 199, 186), (154, 154, 145)]):
        x = 729 + index * 30
        draw.ellipse((x, 469, x + 14, 483), fill=alpha_fill)

    logo = Image.open(logo_path).convert("RGBA").resize((48, 48), Image.Resampling.LANCZOS)
    canvas.paste(logo, (72, 62), logo)
    draw.text((136, 58), "Port Daddy", font=font(29, bold=True), fill=INK)
    draw.text((136, 95), "Local agent coordination, visible and recoverable.", font=font(17, bold=True), fill=MUTED)

    draw.line((72, 145, 552, 145), fill=INK, width=3)
    draw.text((72, 159), route.get("sectionLabel") or route["section"], font=font(18, bold=True), fill=(96, 114, 25))

    title = strip_brand(route["title"], route["route"])
    text_layout = layout_text_blocks(draw, title, route["description"])
    draw_multiline(
        draw,
        (72, 198),
        text_layout["title_lines"],
        text_layout["title_font"],
        INK,
        text_layout["title_line_height"],
    )
    draw_multiline(
        draw,
        (76, text_layout["description_y"]),
        text_layout["description_lines"],
        text_layout["description_font"],
        (38, 52, 66),
        text_layout["description_line_height"],
    )

    draw.rectangle((72, 548, 256, 582), fill=INK)
    draw.text((88, 555), "portdaddy.dev", font=font(15, bold=True), fill=PAPER)
    draw.line((278, 565, 620, 565), fill=INK, width=2)
    draw.text((638, 552), "Agents share notes, claims, locks, messages, and handoffs.", font=font(17, bold=True), fill=INK)
    draw.rectangle((24, 24, 1176, 606), outline=INK, width=2)

    return canvas


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: render-og-cards.py <input-json>")

    payload = json.loads(Path(sys.argv[1]).read_text())
    public_dir = Path(payload["publicDir"])
    output_dir = Path(payload["outputDir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    background_path = Path(payload["backgroundPath"])
    logo_path = Path(payload["logoPath"])

    for route in payload["routes"]:
        image = draw_card(route, public_dir, background_path, logo_path)
        output_path = public_dir / route["image"].lstrip("/")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(output_path, "JPEG", quality=82, optimize=True, progressive=True)

    print(f"Rendered {len(payload['routes'])} route card image(s).")


if __name__ == "__main__":
    main()
