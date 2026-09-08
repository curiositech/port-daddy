"""Capture actual browser renders of clearly labelled, offline settings fixtures."""
import asyncio
import json
import sys
from pathlib import Path
from playwright.async_api import async_playwright


async def main():
    artifacts = Path(sys.argv[1]).resolve()
    checks = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            record_video_dir=str(artifacts / "motion"),
            record_video_size={"width": 1280, "height": 900},
        )
        page = await context.new_page()
        for theme in ["light", "dark"]:
            await page.emulate_media(color_scheme=theme, reduced_motion="reduce")
            for width in [1280, 390]:
                await page.set_viewport_size({"width": width, "height": 900})
                for fixture in ["account", "admin", "stopped", "unavailable"]:
                    await page.goto((artifacts / f"{fixture}.html").as_uri())
                    await page.evaluate("document.fonts.ready")
                    button = page.locator("button:not([disabled])")
                    if await button.count():
                        await button.first.focus()
                        await button.first.hover()
                    await page.screenshot(path=str(artifacts / f"{fixture}-{theme}-{width}.png"), full_page=True)
                    # Doubling font size tests text scaling without concealing overflow.
                    await page.evaluate("""() => {
                      document.querySelectorAll('body *').forEach(el => {
                        el.dataset.originalFontSize = getComputedStyle(el).fontSize;
                      });
                      document.querySelectorAll('body *').forEach(el => {
                        el.style.fontSize = `${parseFloat(el.dataset.originalFontSize) * 2}px`;
                      });
                    }""")
                    overflow = await page.evaluate("document.documentElement.scrollWidth > innerWidth")
                    checks.append({"fixture": fixture, "theme": theme, "width": width, "textScale": 2, "horizontalOverflow": overflow})
                    assert not overflow, checks[-1]
                    await page.mouse.wheel(0, 500)
        await context.close()
        await browser.close()
    (artifacts / "text-scale.json").write_text(json.dumps(checks, indent=2) + "\n")
    print(f"Captured 16 real fixture renders and a browser video; {len(checks)} text-scaling checks passed")


asyncio.run(main())
