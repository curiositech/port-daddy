import pathlib
from playwright.sync_api import sync_playwright

url = pathlib.Path(".scratch/type-specimen.html").resolve().as_uri()
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_context(viewport={"width": 1480, "height": 1000}, device_scale_factor=2).new_page()
    pg.goto(url, wait_until="networkidle", timeout=30000)
    pg.wait_for_timeout(2500)  # let webfonts paint
    pg.screenshot(path=".scratch/type-specimen.png", full_page=True)
    print("ok")
    b.close()
