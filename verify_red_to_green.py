"""Headless verification of the Red-to-Green demo on /pd-tube/playground."""
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:3144/pd-tube/playground"
OUT = "/Users/erichowens/coding/tmp/pd-humanize"


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1320, "height": 1600})
        page = ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(URL, wait_until="networkidle")

        # Demo 02 heading present?
        assert page.get_by_text("Demo 02 · Red-to-Green").count() > 0, "Demo 02 intro missing"

        # Failing state: status bar red text present.
        page.wait_for_selector("text=1 failing · suite red")
        page.screenshot(path=f"{OUT}/rg_01_failing.png", full_page=True)
        print("OK: failing (red) state rendered")

        # Click Run tests.
        btn = page.get_by_role("button", name="Run tests")
        assert btn.count() > 0, "Run tests button missing"
        btn.click()

        # Wait for the green pass state (real round-trip via mock daemon).
        page.wait_for_selector("text=0 failing · suite green", timeout=15000)
        print("OK: green (pass) state appeared after reply")

        # Diff: the real reply diff line should show.
        page.wait_for_selector("text=return price * (1 - rate)", timeout=5000)
        print("OK: suggested diff rendered (real reply)")

        # Diagnosis prose from the real reply (not the sample badge).
        sample_badge = page.get_by_text("Sample shape").count()
        print(f"OK: sample badge count after reply = {sample_badge} (expect 0)")
        assert sample_badge == 0, "still showing sample shape after a real reply"

        page.wait_for_timeout(900)  # let the wipe finish
        # Scroll the demo into view for a focused shot.
        page.get_by_text("Demo 02 · Red-to-Green").scroll_into_view_if_needed()
        page.screenshot(path=f"{OUT}/rg_02_passing.png", full_page=True)
        print("OK: passing screenshot captured")

        # Reduced motion run: instant green, no wipe class crash.
        page2 = ctx.new_page()
        page2.emulate_media(reduced_motion="reduce")
        page2.goto(URL, wait_until="networkidle")
        page2.get_by_role("button", name="Run tests").click()
        page2.wait_for_selector("text=0 failing · suite green", timeout=15000)
        print("OK: reduced-motion run reaches green state")

        if errors:
            print("CONSOLE/PAGE ERRORS:")
            for e in errors:
                print("  -", e)
            # Filter known-noise (e.g. favicon). Fail on real React errors.
            real = [e for e in errors if "favicon" not in e.lower()]
            if real:
                browser.close()
                sys.exit(1)

        browser.close()
        print("ALL CHECKS PASSED")


if __name__ == "__main__":
    run()
