#!/usr/bin/env python3
"""Render actual Book pages for whitespace review; never assign design verdicts."""
import argparse
from pathlib import Path
import json

import fitz


def render(book_path, out_dir, pages):
    with fitz.open(book_path) as book:
        if any(page < 1 or page > len(book) for page in pages):
            raise ValueError('Use one-based physical PDF pages within the Book')
        out_dir.mkdir(parents=True, exist_ok=True)
        for offset in range(0, len(pages), 9):
            batch = pages[offset:offset + 9]
            with fitz.open() as sheet:
                canvas = sheet.new_page(width=810, height=1188)
                for slot, page_number in enumerate(batch):
                    x, y = (slot % 3) * 270, (slot // 3) * 396
                    source = book[page_number - 1]
                    canvas.insert_text((x + 9, y + 14),
                                       f'PDF {page_number} / folio {source.get_label()}',
                                       fontsize=10)
                    canvas.show_pdf_page(fitz.Rect(x + 9, y + 22, x + 261, y + 382),
                                         book, page_number - 1)
                target = out_dir / f'sheet-{offset // 9 + 1:02d}.png'
                canvas.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).save(target)
                print(target)
        for page_number in pages:
            book[page_number - 1].get_pixmap(matrix=fitz.Matrix(1.8, 1.8),
                                            alpha=False).save(out_dir / f'page-{page_number}.png')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('book', type=Path)
    parser.add_argument('--audit', type=Path)
    parser.add_argument('--pages', type=int, nargs='*', default=[])
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    selected = args.pages
    if args.audit:
        selected = [item['pdf_page'] for item in json.loads(args.audit.read_text())['whitespace_review']] + selected
    if not selected:
        parser.error('Select --pages or --audit')
    render(args.book, args.out, list(dict.fromkeys(selected)))
