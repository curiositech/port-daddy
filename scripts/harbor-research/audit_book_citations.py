#!/usr/bin/env python3
"""Audit citation coverage and capacity from an assembled Book's own records.

--measurement-only reads a first-pass log/aux. It does NOT certify placement.
The default also requires every margin object to have shipped exactly once.
No count is a hard-coded claim about the current manuscript.
"""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import re

import fitz

from audit_book_layout import margin_records


def audit(stem, measurement_only=False):
    log = stem.with_suffix('.log').read_text()
    aux = stem.with_suffix('.aux').read_text()
    issues = []
    registered, placed, placement_issues = margin_records(log)
    if not measurement_only:
        issues.extend(placement_issues)
        if 'PD-MARGIN-CONVERGENCE: pending' in log:
            issues.append('Margin geometry has not converged; rerun before accepting the PDF.')
    anchors = {int(i): int(page) for i, page in re.findall(
        r'\\zref@newlabel\{pdm-(\d+)\}\{[^\n]*?\\abspage\{(\d+)\}', aux)}
    occurrences = re.findall(
        r'\\pdbookcitationrecord\{(\d+)\}\{([^}]+)\}\{([^}]+)\}', aux)
    summary = re.search(
        r'PD-BOOK-CITE-SUMMARY:\s*occurrences=(\d+),\s*sources=(\d+),\s*registered=(\d+)', log)
    if not summary:
        issues.append('Missing citation summary: incomplete Book build.')
    else:
        expected, seen, sources = map(int, summary.groups())
        if expected != len(occurrences) or len({o[0] for o in occurrences}) != expected:
            issues.append('Missing or duplicate shipped citation occurrence.')
        if seen != sources:
            issues.append('Some registered sources never received a full entry.')
    forms = Counter(re.findall(r'PD-BOOK-SOURCE:\s*key=([^,]+),\s*form=(\w+)', log))
    keys = set(k.strip() for _, group, _ in occurrences for k in group.split(','))
    for key in keys:
        if forms[(key, 'full')] != 1:
            issues.append(f'{key}: expected exactly one full entry, got {forms[(key, "full")]}')
    if summary and len(keys) != int(summary[3]):
        issues.append('Source registry and occurrence key sets differ.')
    page_rows = defaultdict(list)
    for ident, record in registered.items():
        page = anchors.get(int(ident))
        if page is None:
            issues.append(f'Margin object {ident} has no physical-page anchor.')
        else:
            page_rows[page].append(record)
    capacity_match = re.search(r'PD-BOOK-CITE-CAPACITY:\s*([\d.]+)pt', log)
    if not capacity_match:
        issues.append('Missing measured text-height capacity.')
    capacity = float(capacity_match[1]) if capacity_match else None
    pages = []
    for page, rows in sorted(page_rows.items()):
        height = sum(r['height'] for r in rows) + 7 * max(0, len(rows) - 1)
        pages.append(dict(pdf_page=page, height_pt=round(height, 3),
                          excess_pt=round(max(0, height-capacity), 3) if capacity else None,
                          objects=rows))
    overfull = [p for p in pages if p['excess_pt'] and p['excess_pt'] > 0.01]
    if overfull:
        issues.append(f'{len(overfull)} physical pages exceed margin capacity.')
    named_sources = None
    book_pages = None
    if not measurement_only and stem.with_suffix('.pdf').exists():
        with fitz.open(stem.with_suffix('.pdf')) as pdf:
            book_pages = len(pdf)
            names = pdf.resolve_names()
            named_sources = len([n for n in names if n.startswith('pdbook-source-')])
            for key in keys:
                destination = names.get('pdbook-source-'+key)
                if not destination or not 0 <= destination.get('page', -1) < len(pdf):
                    issues.append(f'{key}: no valid full-source PDF destination.')
    return dict(scope='Whole assembled Book; '+('measurement only, not placement acceptance'
                if measurement_only else 'coverage and measured margin placement'),
                book_pages=book_pages, named_source_destinations=named_sources,
                occurrences=len(occurrences), key_occurrences=sum(len(o[1].split(',')) for o in occurrences),
                sources=len(keys), full_entries=sum(n for (k, form), n in forms.items() if form == 'full'),
                repeat_entries=sum(n for (k, form), n in forms.items() if form == 'repeat'),
                shared_occurrences=len(re.findall(r'PD-BOOK-CITE-SHARED:', log)),
                embedded_occurrences=sum(o[2] == 'embedded' for o in occurrences),
                margin_registered=len(registered), margin_placed=len(placed),
                capacity_pt=capacity, overcapacity_pages=overfull, pages=pages, issues=issues)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stem', type=Path, help='Matching PDF/log/aux basename')
    parser.add_argument('--measurement-only', action='store_true')
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    result = audit(args.stem, args.measurement_only)
    args.out.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({k: v for k, v in result.items() if k not in ('pages', 'overcapacity_pages')}, indent=2))
    raise SystemExit(bool(result['issues']))
