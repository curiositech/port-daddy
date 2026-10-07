#!/usr/bin/env python3
"""Inventory *every* shipped margin object and main-column whitespace band.

Margin safety is a hard check. Whitespace is a review queue, not an automatic
design verdict: part/chapter plates intentionally use different page grammar.
"""
import argparse
import json
import re
from pathlib import Path

import fitz
from page_overflow import column, TEXT_FOOT


def margin_records(log):
    registered = {}
    for match in re.finditer(r"PD-MARGIN-REGISTER:\s*id=(\d+),\s*kind=(\w+),\s*line=(\d+),\s*height=([\d.]+)pt", log):
        ident, kind, line, height = match.groups()
        registered[ident] = dict(id=int(ident), kind=kind, source_line=int(line), height=float(height))
    placed = []
    for match in re.finditer(r"PD-MARGIN-PLACED:\s*id=(\d+),\s*page=([^,]+),\s*top=([\d.-]+)pt,\s*height=([\d.]+)pt", log):
        ident, page, top, height = match.groups()
        placed.append(dict(registered.get(ident, dict(id=int(ident))),
                           folio=page.strip(), top=float(top), height=float(height)))
    issues = []
    if not registered:
        issues.append(dict(issue='missing margin-object inventory; a matching converged Book log is required'))
    seen = {}
    for r in placed:
        seen[r['id']] = seen.get(r['id'], 0) + 1
        if r['top'] < 0.85*72.27-1 or r['top']+r['height'] > TEXT_FOOT*72.27/72+1:
            issues.append(dict(id=r['id'], folio=r['folio'], issue='outside text-height bounds'))
    for ident in registered:
        if seen.get(int(ident), 0) != 1:
            issues.append(dict(id=int(ident), issue='missing or duplicate shipped margin object'))
    by_page = {}
    for r in placed:
        by_page.setdefault(r['folio'], []).append(r)
    for page, records in by_page.items():
        records.sort(key=lambda r: r['top'])
        for a, b in zip(records, records[1:]):
            if b['top'] < a['top'] + a['height'] + 6.9:
                issues.append(dict(folio=page, ids=[a['id'], b['id']], issue='margin collision'))
    return registered, placed, issues


def empty_bands(page, number, minimum=100):
    left, right, _ = column(page, number)
    top, bottom = 0.85*72, TEXT_FOOT
    intervals = []
    def add(rect):
        if rect.x1 <= left+3 or rect.x0 >= right-3 or rect.y1 <= top or rect.y0 >= bottom:
            return
        intervals.append((max(top, rect.y0), min(bottom, rect.y1)))
    for block in page.get_text('dict')['blocks']:
        if block['type'] == 0:
            for line in block['lines']:
                add(fitz.Rect(line['bbox']))
        elif block['type'] == 1:
            add(fitz.Rect(block['bbox']))
    for path in page.get_drawings():
        # Use each element, not an entire disconnected path's bounding box.
        for item in path['items']:
            if item[0] == 're':
                r = fitz.Rect(item[1])
                if path.get('fill') is not None or r.height < 100:
                    add(r)
                else:
                    add(fitz.Rect(r.x0, r.y0-.3, r.x1, r.y0+.3))
                    add(fitz.Rect(r.x0, r.y1-.3, r.x1, r.y1+.3))
            elif item[0] == 'l':
                a, b = item[1:3]
                add(fitz.Rect(min(a.x,b.x)-.3, min(a.y,b.y)-.3,
                              max(a.x,b.x)+.3, max(a.y,b.y)+.3))
            elif item[0] in ('c','qu'):
                add(path['rect'])
    cursor = top
    gaps = []
    for start, end in sorted(intervals):
        if start-cursor >= minimum:
            gaps.append(dict(top=round(cursor,1), bottom=round(start,1), points=round(start-cursor,1),
                             position='above' if cursor == top else 'between'))
        cursor = max(cursor, end)
    if bottom-cursor >= minimum:
        gaps.append(dict(top=round(cursor,1), bottom=round(bottom,1), points=round(bottom-cursor,1), position='below'))
    return gaps


def audit(pdf, log=None, geometry_only=False):
    if geometry_only:
        registered, placed, issues = {}, [], []
    else:
        registered, placed, issues = margin_records((log or pdf.with_suffix('.log')).read_text())
    pages = []
    with fitz.open(pdf) as book:
        for n, page in enumerate(book, 1):
            gaps = empty_bands(page, n)
            if gaps:
                pages.append(dict(pdf_page=n, folio=page.get_label(), gaps=gaps,
                                  text_sample=page.get_text()[:200]))
        return dict(book_pages=len(book), margin_registered=len(registered),
                    margin_placed=len(placed), margin_issues=issues,
                    whitespace_review=pages,
                    scope='All pages and all registered margin objects; whitespace requires visual review.')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('pdf', type=Path)
    ap.add_argument('--log', type=Path)
    ap.add_argument('--out', type=Path)
    ap.add_argument('--geometry-only', action='store_true', help='Whitespace review of an older PDF without margin instrumentation')
    args = ap.parse_args()
    result = audit(args.pdf, args.log, args.geometry_only)
    output = args.out or args.pdf.with_suffix('.layout-audit.json')
    output.write_text(json.dumps(result, indent=2)+'\n')
    print(f"{result['book_pages']} pages; {result['margin_placed']}/{result['margin_registered']} margin objects; "
          f"{len(result['margin_issues'])} margin issues; {len(result['whitespace_review'])} pages in whitespace review")
    raise SystemExit(bool(result['margin_issues']))
