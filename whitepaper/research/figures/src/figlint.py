#!/usr/bin/env python3
"""
figlint — mechanical quality gate for the Rail-B figure corpus.

The exposition skill demands figures a reader can actually read. This lint
catches the mechanical half of "horseshit figures" before a human ever looks:

  F1 tiny text        any visible Text below MIN_PT points
  F2 clipped text     any visible Text whose drawn extent leaves the canvas
  F3 label collision  two visible Texts in one axes overlapping > OVERLAP_FRAC
                      of the smaller one's area
  F4 italic overuse   > ITALIC_FRAC of a figure's visible text is italic
                      (italics are for emphasis, not a default voice)
  F5 dead canvas      > DEAD_FRAC of the canvas is a single blank margin band
                      (crude: max fraction of rows/cols with no artist extent)

Semantic quality (does the relation-map map relations?) stays a human job.

Usage: python3 figlint.py [rN_figures.py ...]   (default: r*_figures.py here)
Exit nonzero if any figure violates F1-F3 (F4/F5 warn only).
"""
import glob
import os
import runpy
import sys
from pathlib import Path

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402

MIN_PT = 8.0
OVERLAP_FRAC = 0.35
ITALIC_FRAC = 0.5
DEAD_FRAC = 0.30

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[3]
_orig_savefig = Figure.savefig
_reports = []


def _visible_texts(fig):
    out = []
    for t in fig.findobj(matplotlib.text.Text):
        s = t.get_text()
        if t.get_visible() and s and s.strip():
            out.append(t)
    return out


def _extent(t, renderer):
    try:
        return t.get_window_extent(renderer=renderer)
    except Exception:
        return None


def _check(fig, path, tight):
    fig.canvas.draw()
    renderer = fig.canvas.get_renderer()
    W, H = fig.canvas.get_width_height()
    name = os.path.basename(path)
    problems, warns = [], []

    # With bbox_inches='tight' the SAVED canvas is the tight bbox (plus pad),
    # so out-of-figure text is included, not clipped. Measure against the
    # effective saved canvas, whichever save mode is in use.
    if tight:
        tb = fig.get_tightbbox(renderer)
        cx0, cy0 = tb.x0 * fig.dpi - 6, tb.y0 * fig.dpi - 6
        cx1, cy1 = tb.x1 * fig.dpi + 6, tb.y1 * fig.dpi + 6
    else:
        cx0, cy0, cx1, cy1 = 0, 0, W, H

    texts = _visible_texts(fig)
    exts = []
    for t in texts:
        e = _extent(t, renderer)
        if e is None or e.width == 0:
            continue
        exts.append((t, e))
        if t.get_fontsize() < MIN_PT:
            problems.append(
                f"F1 tiny text {t.get_fontsize():.1f}pt: {t.get_text()[:40]!r}")
        pad = 2  # px tolerance
        if (e.x0 < cx0 - pad or e.y0 < cy0 - pad
                or e.x1 > cx1 + pad or e.y1 > cy1 + pad):
            problems.append(
                f"F2 clipped at saved-canvas edge: {t.get_text()[:40]!r} "
                f"(bbox {e.x0:.0f},{e.y0:.0f}..{e.x1:.0f},{e.y1:.0f})")

    # F3: pairwise overlap within the same parent axes (skip legend internals)
    by_axes = {}
    for t, e in exts:
        ax = t.axes
        if ax is None or t.get_figure() is None:
            continue
        if t.get_transform() is None:
            continue
        # ignore texts that belong to a legend (legend handles its own layout)
        if any(t in leg.get_texts() for leg in fig.legends) or (
                ax and ax.get_legend() and t in ax.get_legend().get_texts()):
            continue
        by_axes.setdefault(id(ax), []).append((t, e))
    for items in by_axes.values():
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                (t1, e1), (t2, e2) = items[i], items[j]
                ix = max(0, min(e1.x1, e2.x1) - max(e1.x0, e2.x0))
                iy = max(0, min(e1.y1, e2.y1) - max(e1.y0, e2.y0))
                inter = ix * iy
                small = min(e1.width * e1.height, e2.width * e2.height)
                if small > 0 and inter / small > OVERLAP_FRAC:
                    problems.append(
                        f"F3 label collision ({inter/small:.0%}): "
                        f"{t1.get_text()[:28]!r} vs {t2.get_text()[:28]!r}")

    if texts:
        italics = sum(1 for t in texts if t.get_fontstyle() == 'italic')
        if italics / len(texts) > ITALIC_FRAC:
            warns.append(
                f"F4 italic overuse: {italics}/{len(texts)} visible texts italic")

    # F5: dead margin bands — fraction of canvas height/width outside the
    # union of all artist extents.
    if exts:
        x0 = min(e.x0 for _, e in exts)
        x1 = max(e.x1 for _, e in exts)
        y0 = min(e.y0 for _, e in exts)
        y1 = max(e.y1 for _, e in exts)
        for frac, band in ((1 - (x1 - x0) / W, 'horizontal'),
                           (1 - (y1 - y0) / H, 'vertical')):
            if frac > DEAD_FRAC:
                warns.append(f"F5 dead canvas: {frac:.0%} {band} margin")

    _reports.append((name, problems, warns))


def _patched(self, fname, *a, **k):
    _check(self, str(fname), tight=(k.get('bbox_inches') == 'tight'))
    return _orig_savefig(self, fname, *a, **k)


def main(argv):
    scripts = argv or sorted(
        p for p in glob.glob(os.path.join(HERE, 'r*_figures.py')))
    Figure.savefig = _patched
    for script in scripts:
        plt.close('all')
        cwd = os.getcwd()
        try:
            os.chdir(REPO_ROOT)
            runpy.run_path(script, run_name='__main__')
        finally:
            os.chdir(cwd)
    Figure.savefig = _orig_savefig

    fail = False
    for name, problems, warns in _reports:
        status = 'FAIL' if problems else ('warn' if warns else 'ok')
        print(f"[{status}] {name}")
        for p in problems:
            print(f"    {p}")
            fail = True
        for w in warns:
            print(f"    ({w})")
    print(f"\n{len(_reports)} figure(s) checked; "
          f"{sum(1 for _, p, _ in _reports if p)} failing.")
    return 1 if fail else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
