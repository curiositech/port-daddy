from playwright.sync_api import sync_playwright
import os
import time

def capture():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        
        output_dir = "/Users/erichowens/.gemini/tmp/port-daddy/images"
        os.makedirs(output_dir, exist_ok=True)
        
        # Capture Home Page
        print("Capturing Home Page...")
        page.goto('http://localhost:5173')
        page.wait_for_load_state('networkidle')
        time.sleep(2) # Give animations a moment to settle
        page.screenshot(path=f"{output_dir}/preview-home.png", full_page=True)
        
        # Capture Tutorials Page
        print("Capturing Tutorials Page...")
        page.goto('http://localhost:5173/tutorials')
        page.wait_for_load_state('networkidle')
        time.sleep(2)
        page.screenshot(path=f"{output_dir}/preview-tutorials.png", full_page=True)
        
        # Capture a specific tutorial
        print("Capturing Getting Started Tutorial...")
        page.goto('http://localhost:5173/tutorials/getting-started')
        page.wait_for_load_state('networkidle')
        time.sleep(2)
        page.screenshot(path=f"{output_dir}/preview-tutorial-getting-started.png", full_page=True)
        
        browser.close()
        print(f"Screenshots saved to {output_dir}")

if __name__ == "__main__":
    capture()
