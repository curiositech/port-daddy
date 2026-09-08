from playwright.sync_api import sync_playwright
import json

URL = 'http://localhost:3156/porthole.local.html'
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    page = b.new_page(viewport={'width': 1280, 'height': 900})
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_load_state('networkidle'); page.wait_for_timeout(500)
    # regression: quickstart still complete
    page.evaluate("""() => { const s=document.getElementById('seek'); const r=s.getBoundingClientRect();
      s.dispatchEvent(new MouseEvent('click',{clientX:r.left+r.width*0.999,clientY:r.top+3,bubbles:true})); }""")
    page.wait_for_timeout(300)
    reg = page.evaluate("""() => { const t=document.getElementById('term');
      const lines=Array.from(t.children).map(e=>e.textContent);
      return {n:t.children.length, release:lines.some(l=>l.includes('released porthole-demo'))}; }""")
    # TUI tab
    page.evaluate("document.querySelectorAll('#tabs button')[2].click()")
    page.wait_for_timeout(300)
    # mid-playback frame (vim open, ~4s in)
    page.evaluate("""() => { const s=document.getElementById('seek'); const r=s.getBoundingClientRect();
      s.dispatchEvent(new MouseEvent('click',{clientX:r.left+r.width*0.35,clientY:r.top+3,bubbles:true})); }""")
    page.wait_for_timeout(300)
    page.screenshot(path='shot5-tui-mid.png')
    mid = page.evaluate("""() => { const t=document.getElementById('term');
      const lines=Array.from(t.children).map(e=>e.textContent);
      return {n:t.children.length, hasBang:lines.some(l=>l.includes('#!/usr/bin/env bash')),
        garbage:lines.some(l=>l.includes('zz') && !l.includes('drive')),
        wrapped:t.classList.contains('wrap')}; }""")
    # end state
    page.evaluate("""() => { const s=document.getElementById('seek'); const r=s.getBoundingClientRect();
      s.dispatchEvent(new MouseEvent('click',{clientX:r.left+r.width*0.999,clientY:r.top+3,bubbles:true})); }""")
    page.wait_for_timeout(300)
    end = page.evaluate("""() => { const t=document.getElementById('term');
      const lines=Array.from(t.children).map(e=>e.textContent);
      return {n:t.children.length, backInShell:lines.some(l=>l.includes('back in the shell'))}; }""")
    page.screenshot(path='shot5-tui-end.png')
    print(json.dumps({'errs':errs, 'quickstartRegression':reg, 'tuiMid':mid, 'tuiEnd':end}, indent=1))
    b.close()
