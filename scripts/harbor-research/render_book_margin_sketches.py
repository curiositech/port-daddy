#!/usr/bin/env python3
"""Extract registered margin exhibits from their actual Book pages.

The output is a review aid, not another typesetting of the exhibits. Coordinates
come from the matching converged log, with explicit TeX-pt to PDF-pt conversion.
"""
import argparse
import json
from pathlib import Path
import re

import fitz
from audit_book_layout import margin_records
from page_overflow import column, MARGIN_SEP, MARGIN_W


def render(pdf, out, ids=()):
    aux = pdf.with_suffix('.aux').read_text()
    _, placements, issues = margin_records(pdf.with_suffix('.log').read_text())
    if issues:
        raise ValueError(f'Margin geometry is not clear: {issues}')
    records = re.findall(r'\\pdmarginexhibitrecord\{([^}]+)\}\{(\d+)\}', aux)
    if ids:
        records = [(name, ident) for name, ident in records if name in ids]
        if {name for name, _ in records} != set(ids):
            raise ValueError('Requested exhibit is missing from the PDF inventory')
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    with fitz.open(pdf) as book:
        for name, ident in records:
            found = [p for p in placements if p['id'] == int(ident)]
            if len(found) != 1:
                raise ValueError(f'{name}: expected one placement')
            placed = found[0]
            pages = [p for p in book if (p.get_label() or str(p.number + 1)) == placed['folio']]
            if len(pages) != 1:
                raise ValueError(f'{name}: ambiguous folio {placed["folio"]}')
            page = pages[0]
            x0, x1, side = column(page, page.number + 1)
            left = x1 + MARGIN_SEP if side == 'R' else x0 - MARGIN_SEP - MARGIN_W
            top = placed['top'] * 72 / 72.27
            height = placed['height'] * 72 / 72.27
            clip = fitz.Rect(left - 3, top - 3, left + MARGIN_W + 3, top + height + 3)
            target = out / name
            with fitz.open() as detail:
                canvas = detail.new_page(width=clip.width, height=clip.height)
                canvas.show_pdf_page(canvas.rect, book, page.number, clip=clip)
                detail.save(target.with_suffix('.pdf'))
                canvas.get_pixmap(dpi=216, alpha=False).save(target.with_suffix('.png'))
            rows.append(dict(id=name, pdf_page=page.number + 1, folio=placed['folio'],
                             clip=list(clip), png=str(target.with_suffix('.png'))))
        with fitz.open() as sheet:
            for offset in range(0, len(rows), 8):
                batch = rows[offset:offset + 8]
                canvas = sheet.new_page(width=600, height=690)
                for slot, row in enumerate(batch):
                    x, y = 12 + 150 * (slot % 4), 18 + 335 * (slot // 4)
                    canvas.insert_text((x, y), row['id'], fontsize=8)
                    clip = fitz.Rect(row['clip'])
                    canvas.show_pdf_page(fitz.Rect(x, y + 10, x + clip.width, y + 10 + clip.height),
                                         book, row['pdf_page'] - 1, clip=clip)
                canvas.get_pixmap(dpi=144, alpha=False).save(out / f'sheet-{offset // 8 + 1:02d}.png')
            sheet.save(out / 'margin-sketch-review.pdf')
    (out / 'inventory.json').write_text(json.dumps(rows, indent=2) + '\n')
    print(json.dumps(rows, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--ids', nargs='*', default=[])
    args = parser.parse_args()
    render(args.pdf, args.out, args.ids)
