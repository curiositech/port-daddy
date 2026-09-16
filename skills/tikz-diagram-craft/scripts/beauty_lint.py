#!/usr/bin/env python3
"""beauty_lint.py -- measure the near-misses a careful reader sees and
figcheck does not.

figcheck (harbor-chartwork) fails the outright defects: text under 7 pt,
overlaps, a line through text, ink off the page. A figure can pass all of
those and still look careless: a word jammed against its box, a label
hugging a rule, two labels a hair apart, five stroke weights where the
ladder has three, six hues, a label 1 pt off the column it should share.
This script measures those on the compiled fragment PDF (page 1, the
picture above its caption) and reports each with the number.

  B1  moat         text inside a stroked box with < 2.5 pt to an edge    warn (< 1 pt: fail)
  B2  crowding     a word within 1.5 pt of a stroke it does not sit in    warn
  B3  text gap     two words from different lines < 2 pt apart            warn (< .5 pt or overprinting: fail)
  B4  weights      more than 5 distinct stroke weights                    warn
  B5  hues         more than 4 chromatic hue families                     warn
  B6  type sizes   more than one text size (math scripts aside)          warn
  B7  alignment    left edges / centres / baselines 0.3-2.5 pt apart      warn
  B8  height       picture taller than 5.2 in                             warn
  B9  hyphenation  a label line ending in a hyphen                        fail
  B10 provenance   caption without a closing [bracket]                    warn

Usage: beauty_lint.py FIG.pdf [--json OUT]    exit 1 only on a fail.
"""
import argparse, colorsys, json, math, re, sys
from itertools import combinations
from pathlib import Path

import pymupdf

PT_IN = 72.0


def _pic_region(page):
    """The picture: everything above the caption ("Figure N:"), or the page."""
    cap_top = None
    cap_text = ''
    for b in page.get_text('blocks'):
        t = str(b[4]).strip()
        if re.match(r'^Figure\s+[\dA-Z.]+[:.]', t):
            if cap_top is None or b[1] < cap_top:
                cap_top, cap_text = b[1], t
    # the caption can span several blocks: gather the text below its top
    if cap_top is not None:
        cap_text = ' '.join(str(b[4]).strip() for b in sorted(page.get_text('blocks'), key=lambda b: b[1])
                            if b[1] >= cap_top - 1)
    bottom = cap_top - 1 if cap_top is not None else page.rect.y1
    return pymupdf.Rect(page.rect.x0, page.rect.y0, page.rect.x1, bottom), cap_text


def _words(page, region):
    out = []
    d = page.get_text('dict')
    for blk in d['blocks']:
        for ln in blk.get('lines', []):
            for sp in ln['spans']:
                if not sp['text'].strip():
                    continue
                r = pymupdf.Rect(sp['bbox'])
                if r.y1 <= region.y1 + .5 and region.intersects(r):
                    # tighten to the ink: drop the descender/ascender padding
                    out.append({'text': sp['text'].strip(), 'rect': r, 'size': round(sp['size'], 1),
                                'origin': sp['origin'], 'line': id(ln), 'font': sp.get('font', ''),
                                'rotated': abs(ln.get('dir', (1, 0))[1]) > .01})
    return out


def _segments(drawings):
    """Flatten drawings to (p, q, width, color, is_rect_edge, rect) segments."""
    segs = []
    for seq, d in enumerate(drawings):
        if not d.get('color') or min(d['color']) > .97:
            continue  # fill-only shapes have no stroke; a white stroke is not ink
        w = d.get('width') or 0
        for it in d['items']:
            if it[0] == 'l':
                segs.append((it[1], it[2], w, d['color'], None, seq))
            elif it[0] == 'c':
                pts = [it[1], it[2], it[3], it[4]]
                prev = pts[0]
                for k in range(1, 9):  # sample the bezier
                    t = k / 8
                    x = sum(c * pt.x for c, pt in zip([(1-t)**3, 3*t*(1-t)**2, 3*t*t*(1-t), t**3], pts))
                    y = sum(c * pt.y for c, pt in zip([(1-t)**3, 3*t*(1-t)**2, 3*t*t*(1-t), t**3], pts))
                    cur = pymupdf.Point(x, y)
                    segs.append((prev, cur, w, d['color'], None, seq))
                    prev = cur
            elif it[0] == 're':
                r = it[1]
                for p, q in ((r.tl, r.tr), (r.tr, r.br), (r.br, r.bl), (r.bl, r.tl)):
                    segs.append((p, q, w, d['color'], pymupdf.Rect(r), seq))
            elif it[0] == 'qu':
                q = it[1]
                for p, r2 in ((q.ul, q.ur), (q.ur, q.lr), (q.lr, q.ll), (q.ll, q.ul)):
                    segs.append((p, r2, w, d['color'], q.rect, seq))
    return segs


def _seg_rect_dist(p, q, r):
    """Distance from segment pq to rectangle r (0 if they touch)."""
    # sample: exact enough at print scale
    best = 1e9
    n = max(2, int(math.hypot(q.x - p.x, q.y - p.y) / 1.0))
    for k in range(n + 1):
        t = k / n
        x, y = p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t
        dx = max(r.x0 - x, 0, x - r.x1)
        dy = max(r.y0 - y, 0, y - r.y1)
        best = min(best, math.hypot(dx, dy))
        if best == 0:
            break
    return best


def _ink_rect(w):
    """Word bbox shrunk to cap-height ink (spans carry line-height padding).
    Rotated text (a vertical axis title) keeps its own bbox."""
    r = w['rect']
    if w.get('rotated'):
        return pymupdf.Rect(r)
    s = w['size']
    base = w['origin'][1]
    return pymupdf.Rect(r.x0, base - 0.70 * s, r.x1, base + 0.18 * s)


def _hue_family(rgb):
    h, l, s = colorsys.rgb_to_hls(*rgb)
    if s < 0.18 or l > 0.93 or l < 0.08:
        return None  # grey, ink or paper
    return int(round(h * 360 / 20)) % 18  # 20-degree families


def lint(pdf, max_height_in=5.2):
    doc = pymupdf.open(pdf)
    page = doc[0]
    region, cap = _pic_region(page)
    words = _words(page, region)
    # a horizontal or vertical rule has a zero-area rect, which never
    # "intersects" anything, so pad before testing
    drawings = [d for d in page.get_drawings()
                if (pymupdf.Rect(d['rect']) + (-.5, -.5, .5, .5)).intersects(region)
                and d['rect'].width < page.rect.width * .98
                and max(d['rect'].width, d['rect'].height) >= 1]
    # knockouts: white fill-only rectangles (pd tag); a word inside one may
    # sit on a rule by design, so only its clearance, not contact, is judged
    # any filled shape painted after a stroke hides it where it covers a word
    fills = [(i, pymupdf.Rect(d['rect'])) for i, d in enumerate(drawings) if d.get('fill')]
    segs = _segments(drawings)
    F = []

    def add(fid, level, msg, **kw):
        F.append({'id': fid, 'level': level, 'message': msg, **kw})

    # B1 moat, B2 crowding
    for w in words:
        ir = _ink_rect(w)
        covering = [i for i, fr in fills if (fr + (-.5, -.5, .5, .5)).contains(ir)]
        for (p, q, width, _c, box, seq) in segs:
            if box is not None and box.contains(ir):
                # own box: measure the moat to this edge
                d = _seg_rect_dist(p, q, ir) - width / 2
                if d < 2.5:
                    add('B1', 'fail' if d < 1.0 else 'warn',
                        f"'{w['text']}' sits {d:.1f} pt from its box edge (moat 2.5 pt)", gap_pt=round(d, 2))
                    break
                continue
            if any(i > seq for i in covering):
                continue  # knocked out: a fill painted over this stroke covers the word
            d = _seg_rect_dist(p, q, ir) - width / 2
            if d < 1.5:
                add('B2', 'warn', f"'{w['text']}' is {max(d, 0):.1f} pt from a stroke (1.5 pt clear)"
                    + (' (touching)' if d <= 0 else ''), gap_pt=round(max(d, 0), 2))
                break
    # B3 text gap between different lines
    def _math(w):
        return 'math' in w.get('font', '').lower()
    for a, b in combinations(words, 2):
        ra, rb = _ink_rect(a), _ink_rect(b)
        inter = ra & rb
        # a symbol and its own sub- or superscript sit tight by TeX's design
        # (a subscript tucked under a capital's arm); math pairs are judged
        # only when they collide by more than ordinary math kerning
        if (_math(a) or _math(b)) and abs(a['origin'][0] - b['origin'][0]) < 12 \
                and (inter.is_empty or (inter.width < 1.5 and inter.height < 5.5)):
            continue
        if a['line'] == b['line']:
            if a.get('rotated'):
                continue
            # spans of one text line never overlap in set type; if they do,
            # two labels were placed on top of each other and merged
            if not inter.is_empty and inter.width > .6 and inter.height > .6:
                add('B3', 'fail', f"'{a['text']}' overprints '{b['text']}' "
                    f"({inter.width:.1f} x {inter.height:.1f} pt)", gap_pt=0)
            continue
        if not inter.is_empty and inter.width > .3 and inter.height > .3:
            # figcheck T3 only fails above 5 % area; any overprint of two
            # labels' ink is visible, so it fails here
            add('B3', 'fail', f"'{a['text']}' overprints '{b['text']}' "
                f"({inter.width:.1f} x {inter.height:.1f} pt)", gap_pt=0)
            continue
        dx = max(rb.x0 - ra.x1, ra.x0 - rb.x1, 0)
        dy = max(rb.y0 - ra.y1, ra.y0 - rb.y1, 0)
        g = math.hypot(dx, dy)
        if g < 2.0 and (dx == 0 or dy == 0):
            add('B3', 'fail' if g < .5 else 'warn',
                f"'{a['text']}' and '{b['text']}' are {g:.1f} pt apart (2 pt clear)", gap_pt=round(g, 2))
    # B4 weights
    # table rules (long, straight, horizontal) are the booktabs register, not
    # the figure's weight ladder
    span = max((pymupdf.Rect(d['rect']).width for d in drawings), default=0)
    def _is_table_rule(d):
        r = pymupdf.Rect(d['rect'])
        return r.height < .01 and span and r.width > .6 * span and all(it[0] == 'l' for it in d['items'])
    widths = sorted({round(d.get('width') or 0, 2) for d in drawings
                     if d.get('color') and min(d['color']) <= .97
                     and (d.get('width') or 0) > 0.05 and not _is_table_rule(d)})
    merged = []
    for x in widths:
        if not merged or x - merged[-1] > 0.08:
            merged.append(x)
    if len(merged) > 5:
        add('B4', 'warn', f"{len(merged)} stroke weights {merged} (ladder: .5/.9/1.6 plus marks)", weights=merged)
    # B5 hues
    fams = set()
    for d in drawings:
        for c in (d.get('color'), d.get('fill')):
            if c:
                f = _hue_family(c)
                if f is not None:
                    fams.add(f)
    if len(fams) > 4:
        add('B5', 'warn', f"{len(fams)} hue families (2-4 per figure)", families=sorted(fams))
    # B6 type sizes (ignore script sizes below 75 % of the modal size)
    if words:
        sizes = [w['size'] for w in words]
        modal = max(set(sizes), key=sizes.count)
        base = []
        # mono is set to the lowercase (about 10 % smaller) by design: sizes
        # within 12 % of each other are one voice
        for x in sorted({s for s in sizes if s >= modal * .75}):
            if not base or x > base[-1] * 1.12:
                base.append(x)
        if len(base) > 1:
            add('B6', 'warn', f"{len(base)} text sizes {base} (the standard is one size)", sizes=base)
    # B7 near-miss alignment: left edges and baselines of distinct lines
    lines = {}
    for w in words:
        L = lines.setdefault(w['line'], {'x0': w['rect'].x0, 'base': w['origin'][1], 'x1': w['rect'].x1, 'text': w['text']})
        L['x0'] = min(L['x0'], w['rect'].x0); L['x1'] = max(L['x1'], w['rect'].x1)
    Ls = list(lines.values())
    near = []
    # only labels that stack (a column of row heads) or share a row can be
    # "almost aligned"; tick numerals are placed by pgfplots and skipped
    num = re.compile(r'^[\d.,\u2212\-\s\u2009]+$')
    cand = [L for L in Ls if not num.match(L['text'])]
    for a, b in combinations(cand, 2):
        stacked = abs(a['base'] - b['base']) <= 40
        same_row = max(b['x0'] - a['x1'], a['x0'] - b['x1']) <= 60
        if not (stacked or same_row):
            continue
        ca, cb = (a['x0'] + a['x1']) / 2, (b['x0'] + b['x1']) / 2
        centred = abs(ca - cb) < .3
        right = abs(a['x1'] - b['x1']) < .3  # right-aligned labels share x1, not x0
        for key, ok in (('x0', stacked and not centred and not right), ('base', same_row)):
            dlt = abs(a[key] - b[key])
            if ok and 0.3 <= dlt <= 2.5:
                near.append((key, a['text'], b['text'], round(dlt, 2)))
        edge_aligned = abs(a['x0'] - b['x0']) < .3 or abs(a['x1'] - b['x1']) < .3
        if stacked and not edge_aligned and 0.3 <= abs(ca - cb) <= 2.5 and abs(a['base'] - b['base']) > 4:
            near.append(('centre', a['text'], b['text'], round(abs(ca - cb), 2)))
    if near:
        k, a, b, dlt = near[0]
        add('B7', 'warn', f"{len(near)} near-aligned pairs, e.g. {k} of '{a}' and '{b}' differ by {dlt} pt",
            count=len(near), examples=near[:6])
    # B8 height
    ink = pymupdf.Rect()
    for d in drawings:
        ink |= pymupdf.Rect(d['rect'])
    for w in words:
        ink |= w['rect']
    if not ink.is_empty and ink.height / PT_IN > max_height_in:
        add('B8', 'warn', f"picture is {ink.height / PT_IN:.2f} in tall (> {max_height_in} in)")
    # B9 hyphenated label
    for L in Ls:
        # labels only: a long line is running prose (a table cell, a legend
        # paragraph), where hyphenation is ordinary typesetting
        if len(L['text']) <= 32 and re.search(r'[A-Za-z]-$', L['text']):
            add('B9', 'fail', f"label line '{L['text']}' ends in a hyphen")
    # B10 provenance
    if cap and not re.search(r'\[[^\]]+\][.\s]*$', cap.strip()):
        add('B10', 'warn', 'caption does not end with a [provenance] bracket')
    fails = [f for f in F if f['level'] == 'fail']
    return {'figure': Path(pdf).stem, 'findings': F,
            'summary': {'result': 'fail' if fails else ('warn' if F else 'pass'),
                        'fail': len(fails), 'warn': len(F) - len(fails)}}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdf')
    ap.add_argument('--json')
    ap.add_argument('--max-height-in', type=float, default=5.2)
    a = ap.parse_args(argv)
    r = lint(a.pdf, a.max_height_in)
    if a.json:
        Path(a.json).write_text(json.dumps(r, indent=1))
    for f in r['findings']:
        print(f"{f['level'].upper():4} {f['id']:3} {f['message']}")
    print(f"{r['figure']}: {r['summary']['result']} ({r['summary']['fail']} fail, {r['summary']['warn']} warn)")
    return 1 if r['summary']['fail'] else 0


if __name__ == '__main__':
    sys.exit(main())
