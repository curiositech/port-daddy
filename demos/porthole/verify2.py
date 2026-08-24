from playwright.sync_api import sync_playwright
import json

URL = 'http://localhost:3156/porthole.local.html'
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    out = {}
    for name, vw in [('mobile', {'width': 375, 'height': 812}), ('desktop', {'width': 1280, 'height': 900})]:
        page = browser.new_page(viewport=vw)
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.goto(URL); page.wait_for_load_state('networkidle'); page.wait_for_timeout(800)
        # height stability: measure term height now and after seek-to-end
        h0 = page.evaluate("document.getElementById('term').getBoundingClientRect().height")
        page.evaluate("""() => { const s=document.getElementById('seek'); const r=s.getBoundingClientRect();
          s.dispatchEvent(new MouseEvent('click',{clientX:r.left+r.width*0.999,clientY:r.top+3,bubbles:true})); }""")
        page.wait_for_timeout(400)
        h1 = page.evaluate("document.getElementById('term').getBoundingClientRect().height")
        m = page.evaluate("""() => {
          const term=document.getElementById('term'), ctl=document.querySelector('.ctl');
          const btns=Object.fromEntries(['play','restart','wrapBtn','copyAll'].map(id=>{
            const b=document.getElementById(id), r=b.getBoundingClientRect();
            return [id, {visible: r.width>0 && r.right<=innerWidth && r.left>=0, right: Math.round(r.right)}];}));
          return { wrapped: term.classList.contains('wrap'),
            bodyHScroll: document.documentElement.scrollWidth > innerWidth + 1,
            time: document.getElementById('time').textContent,
            timeClipped: (()=>{const t=document.querySelector('.ctl .time'), r=t.getBoundingClientRect(); return r.right>innerWidth;})(),
            btns, nLines: term.children.length };
        }""")
        out[name] = {'errs': errs, 'h_before': round(h0), 'h_after_end': round(h1), **m}
        page.screenshot(path=f'shot2-{name}.png')
        page.close()
    print(json.dumps(out, indent=1))
    browser.close()
