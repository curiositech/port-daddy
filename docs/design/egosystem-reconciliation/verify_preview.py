#!/usr/bin/env python3
"""Offline headless fixture checks. Requires Playwright and layout-overflow-guard.

Usage: python3 verify_preview.py --layout-guard /path/to/check_layout.py
Writes reproducible reports and two screenshots next to this script. No server,
network dependency, agent, Port Daddy invocation or publication is involved.
"""
import argparse
import importlib.util
import json
from pathlib import Path
from playwright.sync_api import sync_playwright


METRICS_JS = r"""() => {
  const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
  const luminance = s => {
    const c = rgb(s).slice(0,3).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x+.055)/1.055)**2.4);
    return c[0]*.2126+c[1]*.7152+c[2]*.0722;
  };
  const contrast = (a,b) => (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  const texts = [...document.body.querySelectorAll('*')].filter(el => visible(el) &&
    !['SCRIPT','STYLE','OPTION'].includes(el.tagName) &&
    [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()));
  let minContrast = Infinity;
  for (const el of texts) {
    let ancestor = el, bg;
    while (ancestor) {
      bg = getComputedStyle(ancestor).backgroundColor;
      if (rgb(bg).length === 3 || rgb(bg)[3] === 1) break;
      ancestor = ancestor.parentElement;
    }
    if (ancestor) minContrast = Math.min(minContrast, contrast(luminance(getComputedStyle(el).color), luminance(bg)));
  }
  // Native radio inputs use their associated, fully clickable labels as targets.
  const targets = [...document.querySelectorAll('button,select,summary,a,.option')].filter(visible);
  const targetMin = Math.min(...targets.map(el => Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height)));
  return {
    minContrast, targetMin,
    fontSizes: [...new Set(texts.map(el => getComputedStyle(el).fontSize))].sort(),
    fontWeights: [...new Set(texts.map(el => getComputedStyle(el).fontWeight))].sort(),
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    localDomReadyMs: performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd
  };
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--layout-guard', required=True)
    args = parser.parse_args()
    module_spec = importlib.util.spec_from_file_location('layout_guard', args.layout_guard)
    guard = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(guard)
    root = Path(__file__).resolve().parent
    report = {
        'method': 'Headless Chromium, local file fixtures; no human usability or screen-reader claim',
        'states': [], 'networkRequests': [], 'pageErrors': [],
        'keyboardChecks': [], 'screenshots': ['preview-desktop.png', 'preview-mobile-dark.png'],
    }
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        report['browser'] = browser.version
        context = browser.new_context(device_scale_factor=1, reduced_motion='reduce')
        page = context.new_page()
        page.on('request', lambda request: report['networkRequests'].append(request.url) if not request.url.startswith('file:') else None)
        page.on('pageerror', lambda error: report['pageErrors'].append(str(error)))
        for theme in ['light', 'dark']:
            for width in [320, 390, 720, 1100]:
                page.set_viewport_size({'width': width, 'height': 900})
                page.emulate_media(color_scheme=theme, reduced_motion='reduce')
                page.goto((root / 'index.html').as_uri(), wait_until='load')
                assert page.locator('html').get_attribute('data-theme') == theme
                assert page.locator('#preview').is_hidden()
                for case in ['analytics', 'replay', 'spend']:
                    page.select_option('#case-select', case)
                    assert page.locator('#preview').is_hidden(), 'Changing case must invalidate old preview'
                    for choice in ['0', '1']:
                        page.locator(f'input[name="path"][value="{choice}"]').check()
                        assert page.locator('#preview').is_hidden(), 'Changing path must invalidate old preview'
                        page.locator('#preview-button').click()
                        assert page.locator('#preview').is_visible()
                        assert page.locator('#consequence-path li').count() == 3
                        assert 'No decision has been accepted.' in page.locator('#preview-status').inner_text()
                        page.locator('#dissent').evaluate('(el) => el.open = true')
                        violations, _ = guard.run_config(page, width, theme, None, 2.0)
                        metrics = page.evaluate(METRICS_JS)
                        assert not violations, f'{theme}/{width}/{case}/{choice}: {violations}'
                        assert metrics['minContrast'] >= 4.5, metrics
                        assert metrics['targetMin'] >= 44, metrics
                        assert len(metrics['fontSizes']) <= 4, metrics
                        assert len(metrics['fontWeights']) <= 3, metrics
                        report['states'].append({'theme': theme, 'width': width, 'case': case, 'path': choice, 'violations': violations, **metrics})
                if theme == 'light' and width == 1100:
                    page.select_option('#case-select', 'analytics')
                    page.locator('input[value="1"]').check()
                    page.locator('#preview-button').click()
                    page.locator('#dissent').evaluate('(el) => el.open = true')
                    page.screenshot(path=str(root / 'preview-desktop.png'), full_page=True)
                if theme == 'dark' and width == 390:
                    page.screenshot(path=str(root / 'preview-mobile-dark.png'), full_page=True)

        # Keyboard operation and enlarged-text reflow are separate from geometry states.
        page.goto((root / 'index.html').as_uri(), wait_until='load')
        page.keyboard.press('Tab')
        assert page.locator('#theme-toggle').evaluate('(el) => el === document.activeElement')
        before = page.locator('html').get_attribute('data-theme')
        page.keyboard.press('Enter')
        assert page.locator('html').get_attribute('data-theme') != before
        page.keyboard.press('Tab')
        assert page.locator('#case-select').evaluate('(el) => el === document.activeElement')
        page.locator('input[value="0"]').focus()
        page.keyboard.press('ArrowRight')
        assert page.locator('input[value="1"]').is_checked()
        page.keyboard.press('Tab')
        assert page.locator('#preview-button').evaluate('(el) => el === document.activeElement')
        page.keyboard.press('Enter')
        assert page.locator('#preview').is_visible()
        page.keyboard.press('Tab')
        assert page.locator('summary').evaluate('(el) => el === document.activeElement')
        page.keyboard.press('Enter')
        assert page.locator('#dissent').get_attribute('open') is not None
        report['keyboardChecks'] = ['tab order', 'theme enter', 'radio arrows', 'preview enter', 'dissent enter']

        page.add_style_tag(content='body,button,select { font-size: 32px; } .small,.eyebrow,dt,.source,.status,.premise strong { font-size: 28px; } h3 { font-size: 32px; } h2 { font-size: 48px; } h1 { font-size: 80px; }')
        violations, _ = guard.run_config(page, 640, 'light', None, 2.0)
        assert not violations, f'Enlarged text: {violations}'
        report['enlargedText'] = {'width': 640, 'bodyPx': 32, 'violations': violations, 'note': 'CSS text enlargement, not an OS accessibility or browser-zoom test'}
        assert not report['networkRequests'], report['networkRequests']
        assert not report['pageErrors'], report['pageErrors']
        browser.close()
    report['pass'] = True
    (root / 'interaction-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'pass': True, 'states': len(report['states']), 'minContrast': min(s['minContrast'] for s in report['states']), 'minimumTargetPx': min(s['targetMin'] for s in report['states']), 'keyboardChecks': report['keyboardChecks'], 'networkRequests': 0, 'pageErrors': 0}, indent=2))


if __name__ == '__main__':
    main()
