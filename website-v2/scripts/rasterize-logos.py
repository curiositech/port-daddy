#!/usr/bin/env python3
"""Rasterize brand SVG marks to PNG via headless Chromium.

librsvg / cairosvg do NOT resolve `:root { --x }` + `var(--x)` custom
properties used as stroke/fill values, but Chromium (the browser the site
actually ships to) does. We render each SVG inside a transparent page at a
chosen pixel size and screenshot the element.

Used to (re)generate the raster favicons from the *new* cobalt/seafoam/amber
radar mark so they match favicon.svg (the old apple-touch-icon.png /
favicon.png were stale Harbor-Heritage renders).

Run:  python3 scripts/rasterize-logos.py
"""
import base64
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent / "public"
LOGOS = PUBLIC / "logos"

# (svg path, out path, px, transparent?) — transparent=False bakes the SVG's own
# background rect; transparent=True forces an alpha page (for favicons).
JOBS = [
    # PNG favicon: transparent small mark, matches favicon.svg.
    (LOGOS / "portdaddy-mark-small-light.svg", PUBLIC / "favicon.png", 64, True),
    # Apple touch icon + OG-card logo: solid cream tile so it reads as an app
    # icon and composites cleanly onto the cream OG background.
    (LOGOS / "portdaddy-app-tile.svg", PUBLIC / "apple-touch-icon.png", 180, False),
]


def render(page, svg_path: Path, out_path: Path, px: int, transparent: bool):
    svg = svg_path.read_text()
    b64 = base64.b64encode(svg.encode()).decode()
    bg = "transparent" if transparent else "#ffffff"
    html = f"""<!doctype html><html><head><style>
      html,body{{margin:0;padding:0;background:{bg}}}
      #wrap{{width:{px}px;height:{px}px}}
      #wrap img{{width:100%;height:100%;display:block}}
    </style></head><body><div id="wrap">
      <img src="data:image/svg+xml;base64,{b64}"/>
    </div></body></html>"""
    page.set_content(html)
    page.wait_for_timeout(120)
    el = page.query_selector("#wrap")
    el.screenshot(path=str(out_path), omit_background=transparent)
    print(f"  {out_path.relative_to(PUBLIC.parent)}  ({px}px)")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(device_scale_factor=2)
        for svg_path, out_path, px, transparent in JOBS:
            if not svg_path.exists():
                print(f"  MISSING {svg_path}", file=sys.stderr)
                continue
            render(page, svg_path, out_path, px, transparent)
        browser.close()
    print("done.")


if __name__ == "__main__":
    main()
