from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=2)
    pg = ctx.new_page()

    pg.goto("https://portdaddy.dev/blog/", wait_until="networkidle", timeout=30000)
    pg.wait_for_timeout(1200)
    pg.screenshot(path=".scratch/live-blog-index.png", full_page=True)
    print("index titles:", pg.evaluate("Array.from(document.querySelectorAll('h2,h3')).slice(0,6).map(e=>e.innerText.trim()).filter(Boolean)"))

    pg.goto("https://portdaddy.dev/blog/attention-is-the-first-command", wait_until="networkidle", timeout=30000)
    pg.wait_for_timeout(1200)
    pg.screenshot(path=".scratch/live-blog-post.png", full_page=False)
    print("post h1:", pg.evaluate("document.querySelector('h1')?.innerText"))
    b.close()
