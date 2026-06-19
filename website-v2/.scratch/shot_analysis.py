from playwright.sync_api import sync_playwright

def grab(pg, path, full=True):
    pg.wait_for_timeout(1000)
    pg.screenshot(path=path, full_page=full)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)

    # --- Mobile (iPhone-ish) ---
    m = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True)
    mp = m.new_page()
    mp.goto("https://portdaddy.dev/blog/", wait_until="networkidle", timeout=30000)
    grab(mp, ".scratch/an-mobile-index.png", full=True)
    # measure: how far down is the first post card / how much chrome before content
    metrics = mp.evaluate("""() => {
        const firstCard = document.querySelector('a[href*="/blog/"]');
        const r = firstCard ? firstCard.getBoundingClientRect() : null;
        return {
            scrollH: document.body.scrollHeight,
            viewportH: window.innerHeight,
            firstCardTop: r ? Math.round(r.top + window.scrollY) : null,
            postLinkCount: document.querySelectorAll('a[href*="/blog/"]').length,
            h1: document.querySelector('h1')?.innerText,
        };
    }""")
    print("MOBILE index metrics:", metrics)
    mp.goto("https://portdaddy.dev/blog/the-cli-is-for-the-robots", wait_until="networkidle", timeout=30000)
    grab(mp, ".scratch/an-mobile-post.png", full=False)
    body_font = mp.evaluate("""() => {
        const p = document.querySelector('article p, main p, p');
        const cs = p ? getComputedStyle(p) : null;
        return cs ? {fontSize: cs.fontSize, lineHeight: cs.lineHeight, color: cs.color, maxWidthParent: getComputedStyle(p.parentElement).maxWidth} : null;
    }""")
    print("MOBILE post body type:", body_font)

    # --- Desktop post full page (reading experience) ---
    d = b.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=2)
    dp = d.new_page()
    dp.goto("https://portdaddy.dev/blog/the-cli-is-for-the-robots", wait_until="networkidle", timeout=30000)
    grab(dp, ".scratch/an-desktop-post.png", full=True)
    dmetrics = dp.evaluate("""() => {
        const p = document.querySelector('article p, main p, p');
        const cs = p ? getComputedStyle(p) : null;
        return {
            bodyFont: cs ? cs.fontSize : null,
            lineHeight: cs ? cs.lineHeight : null,
            measureCh: p ? Math.round(p.getBoundingClientRect().width) : null,
            hasShare: !!document.querySelector('[class*=share],[aria-label*=share i]'),
            hasToc: !!document.querySelector('[class*=toc i],nav[aria-label*=content i]'),
            imgCount: document.querySelectorAll('article img, main img').length,
        };
    }""")
    print("DESKTOP post metrics:", dmetrics)
    b.close()
