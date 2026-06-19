from playwright.sync_api import sync_playwright

URL = "http://localhost:3144/pd-tube/playground"
OUT = "/Users/erichowens/coding/tmp/pd-humanize"

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_context(viewport={"width": 1320, "height": 1000}).new_page()
    pg.goto(URL, wait_until="networkidle")
    sec = pg.locator("section", has_text="Demo 02 · Red-to-Green")
    sec.scroll_into_view_if_needed()
    sec.screenshot(path=f"{OUT}/rg_crop_failing.png")
    pg.get_by_role("button", name="Run tests").click()
    pg.wait_for_selector("text=0 failing · suite green", timeout=15000)
    pg.wait_for_timeout(1000)
    sec.screenshot(path=f"{OUT}/rg_crop_passing.png")
    b.close()
    print("cropped")
