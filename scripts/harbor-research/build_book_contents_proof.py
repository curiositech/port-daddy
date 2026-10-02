#!/usr/bin/env python3
"""Check and extract the illustrated contents from the assembled Book.

This does not typeset a second document. Every proof page comes from the
supplied whole-book PDF, and its hash is recorded beside the proof.
"""
import argparse
import hashlib
import json
from pathlib import Path

import fitz


def build_proof(book_path, output, edition):
    root = Path(__file__).resolve().parents[2]
    manifest = json.loads((root / 'whitepaper/textbook.json').read_text())
    plate_root = root / 'website-v2/public/whitepaper/plates'
    if edition != 'maritime':
        plate_root /= edition
    output.mkdir(parents=True, exist_ok=True)
    book = fitz.open(book_path)
    contents = [n for n, page in enumerate(book)
                if page.get_text().lstrip().startswith('Contents\n')]
    if not contents:
        raise AssertionError('No contents pages found in the assembled Book')
    images = {n: book[n].get_image_info(hashes=True, xrefs=True) for n in contents}
    records = []
    for chapter in manifest['chapters']:
        key = chapter['prefix']
        art_key = chapter['number'] if edition == 'technical' else key
        plate = plate_root / f'chapter-{art_key}.jpg'
        digest = fitz.Pixmap(str(plate)).digest
        hits = [(n, image) for n in contents for image in images[n]
                if image['digest'] == digest]
        if len(hits) != 1:
            raise AssertionError(f'{key}: expected one chapter plate in contents, found {len(hits)}')
        n, image = hits[0]
        rect = fitz.Rect(image['bbox'])
        if not book[n].rect.contains(rect):
            raise AssertionError(f'{key}: plate outside page')
        links = [link for link in book[n].get_links()
                 if fitz.Rect(link['from']).contains(rect + (1, 1, -1, -1))]
        destinations = [link['page'] for link in links
                        if link.get('page', -1) >= 0 and link['page'] not in contents]
        if len(destinations) != 1:
            raise AssertionError(f'{key}: missing or ambiguous chapter destination')
        target_text = book[destinations[0]].get_text()
        if f"Chapter {chapter['number']} of" not in target_text:
            raise AssertionError(f'{key}: image links to the wrong chapter')
        records.append(dict(chapter=chapter['number'], key=key,
                            pdf_page=n+1, page_label=book[n].get_label(),
                            rect=list(rect), destination_pdf_page=destinations[0]+1,
                            plate_sha256=hashlib.sha256(plate.read_bytes()).hexdigest()))
    proof = fitz.open()
    for n in contents:
        proof.insert_pdf(book, from_page=n, to_page=n)
    proof.save(output / 'book-illustrated-contents-proof.pdf')
    for n in sorted({record['pdf_page']-1 for record in records}):
        book[n].get_pixmap(matrix=fitz.Matrix(1.6, 1.6)).save(output / f'contents-page-{n+1:03}.png')
    result = dict(book=str(book_path.resolve()),
                  book_sha256=hashlib.sha256(book_path.read_bytes()).hexdigest(),
                  book_pages=len(book), edition=edition,
                  contents_pdf_pages=[n+1 for n in contents], chapters=records,
                  checks=['one matching plate per chapter', 'inside page', 'correct chapter link'],
                  limitation='Geometry and links are checked; visual acceptance still requires opening the rendered pages.')
    (output / 'book-illustrated-contents-proof.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('book', type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--edition', choices=['swiss', 'technical', 'maritime'], default='swiss')
    args = parser.parse_args()
    build_proof(args.book, args.out, args.edition)
