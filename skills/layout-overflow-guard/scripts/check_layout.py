#!/usr/bin/env python3
"""
layout-overflow-guard — purely mechanical text-collision + overflow detector.

Renders an HTML file (or URL) headlessly and, using tight glyph-level bounding
boxes from Range.getClientRects(), reports:

  1. COLLISION   — two text runs (from different elements) whose minimal
                   axis-aligned bounding boxes intersect. Visible text should
                   never overlap other visible text.
  2. OVERFLOW    — an element whose content is wider/taller than its box
                   (scrollWidth/Height > clientWidth/Height) and is clipped or
                   ellipsis-truncated, i.e. text is being cut off.
  3. TEXT-ESCAPE — a text run whose box extends past its nearest block
                   ancestor's content box (text spilling outside its container).
  4. PAGE-SCROLL — the document scrolls horizontally (body wider than viewport).

No LLM, no vision — pure DOM geometry. Exit code is non-zero if any violation
is found, so it drops straight into a test/CI gate.

Usage:
  check_layout.py <file-or-url> [--widths 1100,860,720,390] [--themes light,dark]
                  [--selector CSS] [--json OUT.json] [--min-overlap 2.0]

The user's global rule: always headless=True. This script obeys it.
"""
import argparse
import json
import os
import sys

# The in-page collector. Returns tight text-run boxes + overflow/escape facts.
# Kept as a single evaluate() so all geometry is measured in one layout pass.
COLLECT_JS = r"""
(minOverlap) => {
  const OUT = { boxes: [], overflow: [], escape: [], pageScroll: null };

  const cssPath = (el) => {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 5) {
      let s = el.tagName.toLowerCase();
      if (el.id) { s += '#' + el.id; parts.unshift(s); break; }
      const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
      parts.unshift(s);
      el = el.parentElement;
    }
    return parts.join(' > ');
  };

  const isVisible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const nearestBlock = (el) => {
    while (el && el.nodeType === 1) {
      const cs = getComputedStyle(el);
      if (['block','flex','grid','list-item','table','table-cell'].includes(cs.display)) return el;
      el = el.parentElement;
    }
    return document.body;
  };

  // --- tight text-run boxes via Range rects ---
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node, idx = 0;
  const boxes = OUT.boxes;
  while ((node = walker.nextNode())) {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const parent = node.parentElement;
    if (!parent || !isVisible(parent)) continue;
    const cs = getComputedStyle(parent);
    if (cs.pointerEvents === 'none' && parseFloat(cs.opacity || '1') < 0.15) continue;

    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = range.getClientRects();
    if (!rects.length) continue;
    // Push one tight box PER LINE FRAGMENT. Never union a wrapped inline's
    // rects into a single AABB: that box would enclose inter-line whitespace
    // and falsely "collide" with legitimate neighbours on the intervening
    // line. Per-fragment boxes are the true minimal glyph boxes.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rects) {
      if (r.width <= 0.5 || r.height <= 0.5) continue;
      boxes.push({
        i: idx++, text: text.slice(0, 70), path: cssPath(parent),
        x: r.left, y: r.top, w: r.width, h: r.height, _parent: parent,
      });
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top);
      x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    if (!isFinite(x0)) continue;

    // --- text escaping its container's content box ---
    const block = nearestBlock(parent);
    const br = block.getBoundingClientRect();
    const bs = getComputedStyle(block);
    const padL = parseFloat(bs.paddingLeft) || 0, padR = parseFloat(bs.paddingRight) || 0;
    const padT = parseFloat(bs.paddingTop) || 0, padB = parseFloat(bs.paddingBottom) || 0;
    const clip = (bs.overflow + bs.overflowX + bs.overflowY);
    const contained = clip.includes('hidden') || clip.includes('clip') || clip.includes('auto') || clip.includes('scroll');
    const tol = 1.0;
    const overRight = x1 - (br.right - padR);
    const overBottom = y1 - (br.bottom - padB);
    const overLeft = (br.left + padL) - x0;
    if (contained && (overRight > tol || overBottom > tol || overLeft > tol)) {
      OUT.escape.push({
        text: text.slice(0, 60), path: cssPath(block),
        overRight: Math.round(overRight), overBottom: Math.round(overBottom), overLeft: Math.round(overLeft),
      });
    }
  }

  // --- element-level overflow / truncation ---
  for (const el of document.body.querySelectorAll('*')) {
    if (!isVisible(el)) continue;
    const cs = getComputedStyle(el);
    const clipX = cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.textOverflow === 'ellipsis';
    const clipY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
    const dx = el.scrollWidth - el.clientWidth;
    const dy = el.scrollHeight - el.clientHeight;
    if ((clipX && dx > 1) || (clipY && dy > 1)) {
      OUT.overflow.push({
        path: cssPath(el), tag: el.tagName.toLowerCase(),
        clippedX: clipX && dx > 1 ? Math.round(dx) : 0,
        clippedY: clipY && dy > 1 ? Math.round(dy) : 0,
        sample: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      });
    }
  }

  // --- page horizontal scroll ---
  const de = document.documentElement;
  if (de.scrollWidth - de.clientWidth > 1) {
    OUT.pageScroll = { extra: Math.round(de.scrollWidth - de.clientWidth), scrollWidth: de.scrollWidth, viewport: de.clientWidth };
  }

  // --- pairwise text-run collisions (tight boxes, different elements) ---
  const collisions = [];
  const B = boxes;
  for (let a = 0; a < B.length; a++) {
    for (let b = a + 1; b < B.length; b++) {
      const A = B[a], C = B[b];
      if (A._parent === C._parent) continue;                 // same element run
      if (A._parent.contains(C._parent) || C._parent.contains(A._parent)) continue; // nested text
      const ix = Math.min(A.x + A.w, C.x + C.w) - Math.max(A.x, C.x);
      const iy = Math.min(A.y + A.h, C.y + C.h) - Math.max(A.y, C.y);
      if (ix > minOverlap && iy > minOverlap) {
        collisions.push({
          a: { text: A.text, path: A.path }, b: { text: C.text, path: C.path },
          overlapW: Math.round(ix), overlapH: Math.round(iy),
        });
      }
    }
  }
  // strip DOM refs before returning
  OUT.boxes = boxes.map(({ _parent, ...rest }) => rest);
  OUT.collisions = collisions;
  return OUT;
}
"""


def run_config(page, width, theme, selector, min_overlap):
    page.set_viewport_size({"width": width, "height": 900})
    page.emulate_media(color_scheme=theme)
    # stamp the theme like the real viewer toggle does, so token overrides fire
    page.evaluate("(t) => document.documentElement.setAttribute('data-theme', t)", theme)
    page.wait_for_timeout(250)  # let fonts/layout settle
    data = page.evaluate(COLLECT_JS, min_overlap)
    violations = []
    for c in data.get("collisions", []):
        violations.append(
            f"COLLISION  '{c['a']['text']}' ({c['a']['path']})\n"
            f"           overlaps '{c['b']['text']}' ({c['b']['path']})  by {c['overlapW']}x{c['overlapH']}px"
        )
    for o in data.get("overflow", []):
        axis = []
        if o["clippedX"]:
            axis.append(f"{o['clippedX']}px wide")
        if o["clippedY"]:
            axis.append(f"{o['clippedY']}px tall")
        violations.append(f"OVERFLOW   {o['path']} clips content ({', '.join(axis)}): '{o['sample']}'")
    for e in data.get("escape", []):
        dirs = []
        if e["overRight"] > 1:
            dirs.append(f"right +{e['overRight']}")
        if e["overBottom"] > 1:
            dirs.append(f"bottom +{e['overBottom']}")
        if e["overLeft"] > 1:
            dirs.append(f"left +{e['overLeft']}")
        violations.append(f"TEXT-ESCAPE '{e['text']}' spills its container ({', '.join(dirs)}px) @ {e['path']}")
    if data.get("pageScroll"):
        ps = data["pageScroll"]
        violations.append(f"PAGE-SCROLL body scrolls horizontally by {ps['extra']}px (content {ps['scrollWidth']} > viewport {ps['viewport']})")
    return violations, data


def main():
    ap = argparse.ArgumentParser(description="Mechanical text-collision + overflow checker.")
    ap.add_argument("target", help="HTML file path or URL")
    ap.add_argument("--widths", default="1100,860,720,390", help="comma-separated viewport widths")
    ap.add_argument("--themes", default="light,dark", help="comma-separated: light,dark")
    ap.add_argument("--selector", default=None, help="(reserved) restrict to a CSS subtree")
    ap.add_argument("--min-overlap", type=float, default=2.0, help="min px overlap (both axes) to flag a collision")
    ap.add_argument("--json", default=None, help="write full geometry report to this path")
    args = ap.parse_args()

    target = args.target
    if "://" not in target:
        target = "file://" + os.path.abspath(target)
    widths = [int(w) for w in args.widths.split(",") if w.strip()]
    themes = [t.strip() for t in args.themes.split(",") if t.strip()]

    from playwright.sync_api import sync_playwright

    report = {}
    total = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)  # global rule: always headless
        page = browser.new_context(device_scale_factor=1).new_page()
        page.goto(target, wait_until="networkidle")
        for theme in themes:
            for width in widths:
                key = f"{theme}@{width}"
                violations, data = run_config(page, width, theme, args.selector, args.min_overlap)
                report[key] = {"violations": violations, "counts": {
                    "collisions": len(data.get("collisions", [])),
                    "overflow": len(data.get("overflow", [])),
                    "escape": len(data.get("escape", [])),
                    "pageScroll": 1 if data.get("pageScroll") else 0,
                }}
                total += len(violations)
                mark = "OK  " if not violations else "FAIL"
                print(f"[{mark}] {key:>14}  ({len(violations)} issue{'s' if len(violations) != 1 else ''})")
                for v in violations:
                    print("        " + v.replace("\n", "\n        "))
        browser.close()

    if args.json:
        with open(args.json, "w") as f:
            json.dump(report, f, indent=2)

    print(f"\n{'PASS: no overflow or collisions.' if total == 0 else f'FAIL: {total} layout violation(s).'}")
    sys.exit(0 if total == 0 else 1)


if __name__ == "__main__":
    main()
