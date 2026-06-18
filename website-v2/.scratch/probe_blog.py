import time
from playwright.sync_api import sync_playwright

URL = "https://portdaddy.dev/blog/"

with sync_playwright() as p:
    for engine_name in ["webkit", "chromium"]:
        engine = getattr(p, engine_name)
        browser = engine.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        errors, failed, console = [], [], []
        page.on("pageerror", lambda err: errors.append(str(err)[:400]))
        page.on("requestfailed", lambda r: failed.append(f"{r.failure} {r.url[:140]}"))
        page.on("console", lambda m: console.append(f"{m.type}: {m.text[:300]}") if m.type in ("error", "warning") else None)
        reqs = []
        page.on("response", lambda r: reqs.append((r.url, r.status, r.headers.get("content-length", "?"))))
        t0 = time.time()
        dcl = idle = -1
        try:
            page.goto(URL, wait_until="domcontentloaded", timeout=30000)
            dcl = time.time() - t0
            page.wait_for_load_state("networkidle", timeout=30000)
            idle = time.time() - t0
        except Exception as ex:
            errors.append(f"GOTO/IDLE TIMEOUT: {ex}")
        body_len = page.evaluate("document.body.innerText.length")
        cards = page.evaluate("document.querySelectorAll('article, [class*=card], [class*=Card], a[href*=\"/blog/\"]').length")
        title = page.title()
        print(f"=== {engine_name} ===")
        print(f"  DCL={dcl:.2f}s networkidle={idle:.2f}s")
        print(f"  title={title!r} bodyTextLen={body_len} blogLinks/cards={cards}")
        js = [(u, c) for (u, s, c) in reqs if u.endswith('.js')]
        js_big = sorted(js, key=lambda x: -(int(x[1]) if str(x[1]).isdigit() else 0))[:6]
        print("  biggest JS:")
        for u, c in js_big:
            kb = (int(c) / 1024) if str(c).isdigit() else 0
            print(f"    {kb:8.1f} KB  {u.split('/')[-1][:70]}")
        if errors:
            print("  PAGE ERRORS:")
            for e in errors[:8]:
                print("    ", e)
        if failed:
            print("  REQUEST FAILED:")
            for f in failed[:8]:
                print("    ", f)
        if console:
            print("  CONSOLE err/warn:")
            for c in console[:10]:
                print("    ", c)
        browser.close()
