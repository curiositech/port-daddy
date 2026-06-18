#!/usr/bin/env python3
"""Headless Playwright screenshots for the logo-roster PR.

Captures /brand (the gallery), the home hero, and the figure carousel — in
light AND dark — so every new visual surface has a PR screenshot.
"""
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:5234"
OUT = Path.home() / "coding/tmp/pd-logo-roster-shots"
OUT.mkdir(parents=True, exist_ok=True)


def set_theme(page, theme: str):
    # The app reads localStorage 'pd-theme' on boot (see index.html FOWT script).
    page.evaluate(f"() => localStorage.setItem('pd-theme', '{theme}')")


def shot(page, path, full=False, clip=None):
    page.screenshot(path=str(path), full_page=full, clip=clip)
    print(f"  {path.name}")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for theme in ("light", "dark"):
            ctx = browser.new_context(
                viewport={"width": 1440, "height": 900},
                device_scale_factor=2,
            )
            page = ctx.new_page()
            # Prime theme via localStorage, then load for real.
            page.goto(BASE, wait_until="domcontentloaded")
            set_theme(page, theme)

            # /brand gallery
            page.goto(f"{BASE}/brand", wait_until="networkidle")
            page.wait_for_timeout(900)
            shot(page, OUT / f"brand-gallery-{theme}.png", full=True)

            # Home hero (top of /)
            page.goto(BASE, wait_until="networkidle")
            page.wait_for_timeout(900)
            shot(page, OUT / f"hero-{theme}.png", clip={"x": 0, "y": 0, "width": 1440, "height": 900})

            # Figure carousel — scroll it into view, capture a few auto-advanced slides.
            carousel = page.query_selector('[aria-roledescription="carousel"]')
            if carousel:
                carousel.scroll_into_view_if_needed()
                page.wait_for_timeout(600)
                for i in range(3):
                    box = carousel.bounding_box()
                    if box:
                        # pad the clip a little so the caption/controls are included
                        shot(
                            page,
                            OUT / f"carousel-{theme}-slide{i+1}.png",
                            clip={
                                "x": max(box["x"] - 8, 0),
                                "y": max(box["y"] - 8, 0),
                                "width": min(box["width"] + 16, 1440),
                                "height": box["height"] + 16,
                            },
                        )
                    # advance: click the next arrow if present, else wait for auto
                    nxt = page.query_selector('[aria-label="Next figure"], [aria-label*="Next"]')
                    if nxt:
                        nxt.click()
                        page.wait_for_timeout(700)
                    else:
                        page.wait_for_timeout(5400)
            else:
                print(f"  (no carousel found on / for {theme})")
            ctx.close()
        browser.close()
    print("done.")


if __name__ == "__main__":
    main()
