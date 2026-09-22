#!/usr/bin/env python3
"""Extract actual facing spreads for Book interstitials.

Reads the converged aux records, checks facing text and clean art pages, and
renders the PDF pages without altering the underlying generated artwork.
This is a layout witness, not a print-resolution or artistic-quality gate.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import unicodedata

import fitz

PLATES = Path(__file__).resolve().parents[2] / 'website-v2/public/whitepaper/plates/interstitial'


def check_plate_text(page, key, art_rect, metadata):
    """Permit only declared overlay text, wholly inside its lower panel."""
    overlay = metadata.get('overlay')
    actual = page.get_text()
    if not overlay:
        if actual.strip():
            raise ValueError(f'{key}: body text or marginalia leaked onto the art page')
        return
    def normalized(text):
        text = unicodedata.normalize('NFKC', text)
        text = re.sub(r'[-\u2010\u2011\u00ad]\s*\n', '', text)
        return ' '.join(text.split())
    expected = overlay['title'] + ' ' + overlay['body']
    if normalized(actual) != normalized(expected):
        raise ValueError(f'{key}: missing, changed, or unexpected overlay text')
    panel = fitz.Rect(art_rect.x0, art_rect.y1 - overlay['panel_height_inches'] * 72,
                      art_rect.x1, art_rect.y1)
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            for span in line['spans']:
                if not panel.contains(fitz.Rect(span['bbox'])):
                    raise ValueError(f'{key}: text escapes solid panel')
                if span['size'] < 10 or span['color'] != 0xFFFFFF:
                    raise ValueError(f'{key}: overlay text loses size or white contrast')


def plate_spreads(pdf):
    metadata = json.loads((PLATES / 'PROVENANCE.json').read_text())['plates']
    records = re.findall(r'\\pdreflectionrecord\{([^}]+)\}\{(\d+)\}',
                         pdf.with_suffix('.aux').read_text())
    if not records or len({key for key, _ in records}) != len(records):
        raise ValueError('Missing or duplicate reflection records')
    result = []
    with fitz.open(pdf) as book:
        for key, folio in records:
            matches = [p.number for p in book
                       if (p.get_label() or str(p.number + 1)) == folio]
            if len(matches) != 1:
                raise ValueError(f'{key}: ambiguous page label {folio}')
            index = matches[0]
            page = book[index]
            if int(folio) % 2 != (index + 1) % 2:
                raise ValueError(f'{key}: numbered and physical parity disagree')
            facing = index - 1 if int(folio) % 2 else index + 1
            images = page.get_image_info()
            if len(images) != 1:
                raise ValueError(f'{key}: expected exactly one artwork')
            rect = fitz.Rect(images[0]['bbox'])
            check_plate_text(page, key, rect, metadata[key])
            if not page.rect.contains(rect) or abs(rect.width - 432) > 1 or abs(rect.height - 648) > 1:
                raise ValueError(f'{key}: art leaves its six-by-nine-inch frame')
            if not 0 <= facing < len(book) or not book[facing].get_text().strip():
                raise ValueError(f'{key}: no facing argument')
            if index and not book[index - 1].get_text().strip():
                raise ValueError(f'{key}: blank/wordless parity filler before plate')
            result.append(dict(key=key, folio=int(folio), pdf_page=index + 1,
                               side='right' if int(folio) % 2 else 'left',
                               facing_pdf_page=facing + 1,
                               facing_folio=book[facing].get_label() or str(facing + 1),
                               native_pixels=[images[0]['width'], images[0]['height']],
                               effective_ppi=round(images[0]['width'] / (rect.width / 72), 1),
                               facing_text=book[facing].get_text()))
    return result


def render(pdf, out):
    records = plate_spreads(pdf)
    out.mkdir(parents=True, exist_ok=True)
    with fitz.open(pdf) as book, fitz.open() as excerpt:
        for record in records:
            index = record['pdf_page'] - 1
            start = min(index, record['facing_pdf_page'] - 1)
            excerpt.insert_pdf(book, from_page=start, to_page=start + 1)
            with fitz.open() as spread:
                left = book[start].rect
                right = book[start + 1].rect
                page = spread.new_page(width=left.width + right.width, height=left.height)
                page.show_pdf_page(left, book, start)
                page.show_pdf_page(fitz.Rect(left.width, 0, left.width + right.width, right.height),
                                   book, start + 1)
                page.get_pixmap(matrix=fitz.Matrix(1.4, 1.4), alpha=False).save(
                    out / f"{record['key']}-spread.png")
        excerpt.save(out / 'reflection-spreads.pdf', deflate=True)
    report = dict(source=str(pdf.resolve()),
                  sha256=hashlib.sha256(pdf.read_bytes()).hexdigest(),
                  print_status='Layout proof; native plate resolution is below 300 ppi.',
                  plates=records)
    (out / 'reflection-review.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({r['key']: [r['folio'], r['facing_folio']] for r in records}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('out', type=Path)
    args = parser.parse_args()
    render(args.pdf, args.out)
