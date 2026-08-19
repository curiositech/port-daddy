from playwright.sync_api import sync_playwright
import json, sys

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://localhost:3177/porthole.local.html')
    page.wait_for_load_state('networkidle')

    # let it autoplay ~3s of real time at 1x
    page.wait_for_timeout(3200)
    mid = page.evaluate("""() => ({
      time: document.getElementById('time').textContent,
      nLines: document.getElementById('term').children.length })""")

    # seek to end via scrubber click
    page.evaluate("""() => {
      const s = document.getElementById('seek'); const r = s.getBoundingClientRect();
      s.dispatchEvent(new MouseEvent('click', {clientX: r.left + r.width*0.999, clientY: r.top+3, bubbles: true}));
    }""")
    page.wait_for_timeout(600)
    end = page.evaluate("""() => {
      const t = document.getElementById('term');
      const lines = Array.from(t.children).map(e => e.textContent.replace(/\\u200b/g,''));
      return { time: document.getElementById('time').textContent, nLines: lines.length,
        hasStatus: lines.some(l => l.includes('DAEMON CONFIRMED')),
        hasClaim: lines.some(l => l.includes('port 3177') || l.includes('→ port')),
        hasRelease: lines.some(l => l.includes('released porthole-demo')),
        spanCount: t.querySelectorAll('span').length };
    }""")
    page.screenshot(path='shot-quickstart-end.png', full_page=False)

    # switch to long-output cast, seek to end, test scroll + copy affordance visuals
    page.evaluate("""() => { document.querySelectorAll('#tabs button')[1].click(); }""")
    page.wait_for_timeout(400)
    page.evaluate("""() => {
      const s = document.getElementById('seek'); const r = s.getBoundingClientRect();
      s.dispatchEvent(new MouseEvent('click', {clientX: r.left + r.width*0.999, clientY: r.top+3, bubbles: true}));
    }""")
    page.wait_for_timeout(600)
    long_end = page.evaluate("""() => {
      const t = document.getElementById('term');
      return { nLines: t.children.length, scrollH: t.scrollHeight, clientH: t.clientHeight,
        scrollable: t.scrollHeight > t.clientHeight + 40,
        total79: Array.from(t.children).some(e => e.textContent.includes('Total: 79 service(s)')) };
    }""")
    page.screenshot(path='shot-long-end.png')

    print(json.dumps({'errors': errors, 'mid': mid, 'end': end, 'long': long_end}, indent=1))
    browser.close()
