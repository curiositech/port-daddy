from playwright.sync_api import sync_playwright
import json

URL = 'http://localhost:3156/porthole.local.html'
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    out = {}
    for name, vw, scheme in [('mobile-dark', {'width':375,'height':812}, 'dark'),
                             ('mobile-light', {'width':375,'height':812}, 'light'),
                             ('desktop-light', {'width':1280,'height':900}, 'light')]:
        page = browser.new_page(viewport=vw, color_scheme=scheme)
        errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
        page.goto(URL); page.wait_for_load_state('networkidle'); page.wait_for_timeout(600)
        page.evaluate("""() => { const s=document.getElementById('seek'); const r=s.getBoundingClientRect();
          s.dispatchEvent(new MouseEvent('click',{clientX:r.left+r.width*0.999,clientY:r.top+3,bubbles:true})); }""")
        page.wait_for_timeout(400)
        m = page.evaluate("""() => {
          const ctl = document.querySelector('.ctl'), cr = ctl.getBoundingClientRect();
          const term = document.getElementById('term');
          const rows = new Set(Array.from(ctl.children).filter(e=>getComputedStyle(e).display!=='none')
            .map(e=>Math.round(e.getBoundingClientRect().top)));
          return { theme: document.documentElement.dataset.theme,
            ctlH: Math.round(cr.height), ctlRows: rows.size,
            titleDimsVisible: getComputedStyle(document.getElementById('titleDims')).display !== 'none',
            speedChipsVisible: getComputedStyle(document.querySelector('.speeds')).display !== 'none',
            cycleVisible: getComputedStyle(document.getElementById('speedCycle')).display !== 'none',
            wrapped: term.classList.contains('wrap'),
            termBg: getComputedStyle(term.parentElement).backgroundColor,
            sampleColor: (()=>{const s=term.querySelector('span'); return s?getComputedStyle(s).color:null})() };
        }""")
        # theme toggle roundtrip on first case
        if name == 'mobile-dark':
            page.click('#themeBtn'); page.wait_for_timeout(200)
            m['afterToggle'] = page.evaluate("document.documentElement.dataset.theme")
            page.click('#themeBtn')
        out[name] = {'errs': errs, **m}
        page.screenshot(path=f'shot3-{name}.png')
        page.close()
    print(json.dumps(out, indent=1))
    browser.close()
