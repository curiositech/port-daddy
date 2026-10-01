#!/usr/bin/env python3
"""book_figure_qa.py -- judge Book figures the way the Book prints them.

For every fragment: compile it inside the Book's own preamble (7 x 10 in,
4.5 in column) in each edition, in the hue of the chapter that inputs it; run
harbor-chartwork's figcheck on the result; crop the render to its ink; and lay
every figure out on one contact sheet, one row per figure, one column per
edition.  A figure is judged on that sheet, never on source.

Usage:
  book_figure_qa.py FRAGMENT.tex [...]          # named fragments
  book_figure_qa.py --chapter spawn-to-person   # every fragment a chapter inputs
  book_figure_qa.py --all                       # every fragment the Book inputs
Options:
  --editions swiss,maritime,technical   (default: all three; swiss is canonical)
  --out DIR     build root (default: .cache/figure-qa, ignored by git)
  --jobs N      parallel compiles (default 4)
  --width-in W  widest ink allowed (default 4.5, the column; 6.0 = full width)

Automated checks are clear when it compiles, figcheck T1-T5 and T8 are
clean, beauty_lint has no fail (B1 < 1 pt moat, B3 < .5 pt gap, B9 hyphen),
and the ink is no wider than --width-in. beauty_lint warnings (B1-B10) are
printed and drawn on the sheet: read each one and fix it or say why not.  Exit 0 only when every row
clears these checks in every edition. This is NOT a design approval: meaning,
readability and actual Book-page placement require separate review. The legacy
JSON `pass` field means automated checks only. Needs tectonic, PyMuPDF and Pillow.
"""
import argparse, json, os, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

def _repo():
    """The port-daddy checkout to judge: the git toplevel of the working
    directory when it holds the Book, else the repo this script lives in (so
    the skill also works when installed under ~/.claude/skills)."""
    try:
        top = Path(subprocess.run(['git', 'rev-parse', '--show-toplevel'],
                                  capture_output=True, text=True, check=True).stdout.strip())
        if (top / 'whitepaper/textbook.json').exists():
            return top
    except (subprocess.CalledProcessError, FileNotFoundError):
        # Expected in non-git environments (or when git is unavailable):
        # fall back to the script-relative repo root below.
        pass
    return Path(__file__).resolve().parents[3]


REPO = _repo()
COMPILE = REPO / 'skills/harbor-chartwork/scripts/compile_fragment.sh'
FIGCHECK = REPO / 'skills/harbor-chartwork/scripts/figcheck.py'
TEXTBOOK = REPO / 'whitepaper/textbook.json'
BOOK_FIGS = REPO / 'website-v2/public/whitepaper/figures'
HARD = {'T1', 'T2', 'T3', 'T4', 'T5', 'T8'}


def chapters():
    d = json.loads(TEXTBOOK.read_text())
    hue = {c: p['color'] for p in d['parts'] for c in p['chapters']}
    out = []
    for c in d['chapters']:
        src = REPO / c['source']
        frags = []
        for m in re.finditer(r'\\input\{figures/([^}]+)\}', src.read_text()):
            stem = m.group(1).removesuffix('.tex')
            if stem.startswith('pd-'):
                continue
            p = src.parent / 'figures' / f'{stem}.tex'
            if not p.exists():
                p = BOOK_FIGS / f'{stem}.tex'
            frags.append(p)
        out.append((c['id'], hue[c['id']], frags))
    return out


def hue_for(frag, chs):
    for cid, hue, frags in chs:
        if frag.resolve() in [f.resolve() for f in frags]:
            return cid, hue
    return None, 'pdcobalt'


def ink_width_in(pdf):
    import fitz
    pg = fitz.open(pdf)[0]
    r = fitz.Rect()
    for d in pg.get_drawings():
        # page furniture: full-width rules, and sub-point specks (the
        # technical edition leaves one at the page corner)
        if d['rect'].width < pg.rect.width * .98 and max(d['rect'].width, d['rect'].height) >= 1:
            r |= d['rect']
    for b in pg.get_text('blocks'):
        # the caption is set to the column; only the picture can overhang
        r |= fitz.Rect(b[:4]) if not str(b[4]).lstrip().startswith(('Figure', 'Table')) else fitz.Rect()
    return (r.width / 72.0 if not r.is_empty else 0.0), r


def crop(pdf, png, dpi=150):
    import fitz
    pg = fitz.open(pdf)[0]
    r = fitz.Rect()
    for d in pg.get_drawings():
        # page furniture: full-width rules, and sub-point specks (the
        # technical edition leaves one at the page corner)
        if d['rect'].width < pg.rect.width * .98 and max(d['rect'].width, d['rect'].height) >= 1:
            r |= d['rect']
    for b in pg.get_text('blocks'):
        r |= fitz.Rect(b[:4])
    r = ((r if not r.is_empty else pg.rect) + (-6, -6, 6, 6)) & pg.rect
    pg.get_pixmap(dpi=dpi, clip=r).save(png)


def run_one(frag, edition, hue, out, width_in):
    stem = frag.stem
    d = out / edition / stem
    d.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, PD_EDITION=edition, PD_CHAPTER_HUE=hue)
    env.setdefault('TMPDIR', str(out / 'tmp'))
    Path(env['TMPDIR']).mkdir(parents=True, exist_ok=True)
    r = subprocess.run([str(COMPILE), str(frag), '--preamble', 'book', '--out', str(d)],
                       env=env, capture_output=True, text=True, cwd=REPO)
    res = {'figure': stem, 'edition': edition, 'hue': hue, 'compiled': r.returncode == 0,
           'design_review': 'unreviewed'}
    pdf = d / f'{stem}.pdf'
    if r.returncode != 0 or not pdf.exists():
        res['error'] = (r.stderr or r.stdout).strip().splitlines()[-1:] 
        res['pass'] = False
        return res
    fj = d / 'figcheck.json'
    subprocess.run([sys.executable, str(FIGCHECK), str(pdf), '--textwidth-cm', '11.43',
                    '--json', str(fj)], capture_output=True, text=True)
    fails = []
    try:
        data = json.loads(fj.read_text())
        items = data.get('checks') or data.get('results') or data
        items = items.items() if isinstance(items, dict) else [(x.get('id'), x) for x in items]
        for k, v in items:
            st = v.get('status') if isinstance(v, dict) else v
            if str(st).lower() == 'fail' and k in HARD:
                fails.append(k)
    except Exception as e:  # figcheck output unreadable is a failure, not a pass
        fails.append(f'figcheck:{e}')
    w, _ = ink_width_in(pdf)
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import beauty_lint
        b = beauty_lint.lint(pdf)
        (d / 'beauty.json').write_text(json.dumps(b, indent=1))
        res['beauty_fail'] = sorted({f['id'] for f in b['findings'] if f['level'] == 'fail'})
        res['beauty_warn'] = sorted({f['id'] for f in b['findings'] if f['level'] == 'warn'})
    except Exception as e:  # a broken lint is reported, never silently passed
        res['beauty_fail'] = [f'beauty_lint:{e}']
        res['beauty_warn'] = []
    res['figcheck_fail'] = sorted(fails)
    res['ink_width_in'] = round(w, 2)
    res['too_wide'] = w > width_in + 0.02
    png = d / f'{stem}.png'
    crop(pdf, png)
    res['png'] = str(png)
    res['pass'] = not fails and not res['too_wide'] and not res['beauty_fail']
    return res


def mechanical_label(result):
    """Never infer reader approval from compilation or geometric lint."""
    if not result:
        return 'Missing render; design unreviewed'
    if result.get('pass'):
        checks = 'Checks clear' if not result.get('beauty_warn') else 'Checks: warnings'
    else:
        checks = 'Checks: failed'
    return checks + '; design unreviewed'


def sheet(results, editions, path):
    from PIL import Image, ImageDraw, ImageFont
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 22)
    except OSError:
        font = ImageFont.load_default()
    figs = []
    for r in results:
        if r['figure'] not in figs:
            figs.append(r['figure'])
    cw = 720
    by = {(r['figure'], r['edition']): r for r in results}
    rows = []
    for f in figs:
        cells = []
        for e in editions:
            r = by.get((f, e))
            im = None
            if r and r.get('png') and Path(r['png']).exists():
                im = Image.open(r['png']).convert('RGB')
                im.thumbnail((cw, 1100))
            cells.append((r, im))
        h = max([im.height for _, im in cells if im] + [80])
        rows.append((f, cells, h))
    W = len(editions) * (cw + 24) + 24
    H = sum(h + 70 for _, _, h in rows) + 10
    S = Image.new('RGB', (W, H), 'white')
    dr = ImageDraw.Draw(S)
    y = 10
    for f, cells, h in rows:
        for i, (r, im) in enumerate(cells):
            x = 24 + i * (cw + 24)
            tag = mechanical_label(r)
            if r and not r.get('pass'):
                tag += ' ' + ' '.join(
                (r.get('figcheck_fail') or []) + (r.get('beauty_fail') or [])
                + (['wide %.2fin' % r['ink_width_in']] if r.get('too_wide') else [])
                + ([] if r.get('compiled') else ['no compile']))
            if r and r.get('beauty_warn'):
                tag += ' ' + ' '.join(r['beauty_warn'])
            col = (80, 80, 80) if r and r.get('pass') else (180, 30, 30)
            dr.text((x, y + 6), f"{f} [{editions[i]}]", fill='black', font=font)
            dr.text((x, y + 32), tag, fill=col, font=font)
            if im:
                S.paste(im, (x, y + 62))
                dr.rectangle([x - 1, y + 61, x + im.width, y + 62 + im.height], outline=(210, 210, 210))
        y += h + 70
    S.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('fragments', nargs='*')
    ap.add_argument('--chapter')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--editions', default='swiss,maritime,technical')
    ap.add_argument('--out', default=str(REPO / '.cache/figure-qa'))
    ap.add_argument('--jobs', type=int, default=4)
    ap.add_argument('--width-in', type=float, default=4.5)
    ap.add_argument('--sheet', help='contact sheet path (default OUT/sheet.png)')
    ap.add_argument('--hue', help='force the chapter hue (pdcobalt, pdteal, pdviolet, pdgold) for fragments reviewed outside their chapter')
    a = ap.parse_args()
    chs = chapters()
    frags = [Path(f).resolve() for f in a.fragments]
    if a.chapter:
        frags += [f for cid, _, fs in chs if cid == a.chapter for f in fs]
    if a.all:
        frags += [f for _, _, fs in chs for f in fs]
    seen, uniq = set(), []
    for f in frags:
        if f.resolve() not in seen:
            seen.add(f.resolve()); uniq.append(f)
    if not uniq:
        ap.error('no fragments (name some, or --chapter ID, or --all)')
    eds = a.editions.split(',')
    out = Path(a.out).resolve()
    jobs = []
    for f in uniq:
        _, hue = hue_for(f, chs)
        if a.hue:
            hue = a.hue
        for e in eds:
            jobs.append((f, e, hue))
    with ThreadPoolExecutor(a.jobs) as ex:
        results = list(ex.map(lambda j: run_one(j[0], j[1], j[2], out, a.width_in), jobs))
    (out / 'results.json').write_text(json.dumps(results, indent=1))
    sp = Path(a.sheet) if a.sheet else out / 'sheet.png'
    sheet(results, eds, sp)
    bad = [r for r in results if not r['pass']]
    for r in results:
        flag = 'CHECKS CLEAR' if r['pass'] else 'CHECKS FAILED'
        why = ' '.join((r.get('figcheck_fail') or []) + (r.get('beauty_fail') or []) + (['wide=%.2fin' % r['ink_width_in']] if r.get('too_wide') else []) + ([] if r['compiled'] else ['compile: ' + ' '.join(r.get('error', []))]))
        if r.get('beauty_warn'):
            why += '  (beauty warn: ' + ' '.join(r['beauty_warn']) + ')'
        print(f"{flag} {r['edition']:9} {r['figure']:40} {r.get('ink_width_in','-')}in {why}")
    print(f"\n{len(results) - len(bad)}/{len(results)} clear automated failure checks; "
          f"all {len(results)} design reviews remain unreviewed. Sheet: {sp}")
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
