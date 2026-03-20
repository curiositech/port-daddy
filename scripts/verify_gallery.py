from playwright.sync_api import sync_playwright
import time

def verify_website():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()
        
        url = 'http://0.0.0.0:3144'
        print(f"Connecting to {url}...")
        
        try:
            page.goto(url)
            page.wait_for_load_state('networkidle')
            
            # Check for the Evidence badge
            evidence_badge = page.get_by_text("The Evidence")
            if evidence_badge.is_visible():
                print("✅ Found 'The Evidence' badge.")
            else:
                print("❌ 'The Evidence' badge NOT found.")
            
            # Check for the new scenario titles
            scenarios = ["The Mayday Rollback", "The Ghost Salvage", "Stigmergic Auction"]
            for title in scenarios:
                if page.get_by_text(title).is_visible():
                    print(f"✅ Found scenario: {title}")
                else:
                    print(f"❌ Scenario title '{title}' NOT found.")
            
            # Take a screenshot of the demo section
            demo_section = page.locator("#demo")
            if demo_section.is_visible():
                demo_section.screenshot(path="screenshot-gallery-verification.png")
                print("✅ Screenshot saved: screenshot-gallery-verification.png")
            else:
                print("❌ Demo section (#demo) not found, taking full page screenshot.")
                page.screenshot(path="screenshot-full-failed.png")

        except Exception as e:
            print(f"❌ Error during verification: {e}")
        
        browser.close()

if __name__ == "__main__":
    verify_website()
