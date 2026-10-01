#!/usr/bin/env python3
"""Inventory captioned exhibits and extract their actual, vector Book pages.

This is a review queue, never a design verdict. Caption records include inline
figures, tables and code listings missed by a fragment-only scanner. Uncaptioned art remains outside
this inventory and must be inspected in the full Book.
"""
import argparse
import hashlib
import json
from pathlib import Path

import fitz

from export_book_type_review import tex_groups


def caption_records(aux):
    aliases, captions = {}, {}
    for line in aux.splitlines():
        if line.startswith('\\newlabel{'):
            outer = tex_groups(line)
            if len(outer) < 2 or outer[0].endswith('@cref'):
                continue
            fields = tex_groups(outer[1])
            if len(fields) >= 4:
                aliases.setdefault(fields[3], []).append(outer[0])
        elif line.startswith(('\\@writefile{lof}', '\\@writefile{lot}', '\\@writefile{lol}')):
            outer = tex_groups(line)
            fields = tex_groups(outer[1])
            if len(fields) >= 4 and fields[0] in ('figure', 'table', 'lstlisting'):
                number = tex_groups(fields[1])[0]
                captions[fields[3]] = {
                    'kind': 'listing' if fields[0] == 'lstlisting' else fields[0],
                    'number': number, 'folio': fields[2],
                    'destination': fields[3], 'design_review': 'unreviewed',
                }
    for dest, record in captions.items():
        record['labels'] = aliases.get(dest, [])
    return list(captions.values())


def export(source, inventory, output=None, labels=()):
    protected = {source.resolve(), source.with_suffix('.aux').resolve()}
    if inventory.resolve() in protected or (output and output.resolve() in protected):
        raise ValueError('Review output must not overwrite the Book or its aux file')
    if output and inventory.resolve() == output.resolve():
        raise ValueError('PDF and inventory need different paths')
    records = caption_records(source.with_suffix('.aux').read_text())
    if not records:
        raise ValueError('No caption records: use a converged assembled Book build')
    with fitz.open(source) as book:
        destinations = book.resolve_names()
        for record in records:
            dest = destinations.get(record['destination'])
            if dest is None or dest.get('page', -1) < 0:
                raise ValueError('Missing PDF destination: ' + record['destination'])
            index = dest['page']
            if book[index].get_label() != record['folio']:
                raise ValueError('PDF/aux page mismatch: ' + record['destination'])
            record['pdf_page'] = index + 1
        requested = set(labels)
        selected = [r for r in records if not requested or requested.intersection(r['labels'])]
        found = {label for r in selected for label in r['labels']}
        if requested - found:
            raise ValueError('Missing labels: ' + ', '.join(sorted(requested - found)))
        if output:
            with fitz.open() as review:
                page_map, bookmarks, page_labels = {}, [], []
                for record in sorted(selected, key=lambda r: r['pdf_page']):
                    index = record['pdf_page'] - 1
                    if index not in page_map:
                        review.insert_pdf(book, from_page=index, to_page=index, links=False)
                        page_map[index] = len(review)
                        page_labels.append({'startpage': len(review) - 1, 'prefix': record['folio']})
                    bookmarks.append([1, record['kind'].title() + ' ' + record['number']
                                      + ' — design unreviewed', page_map[index]])
                review.set_toc(bookmarks)
                review.set_page_labels(page_labels)
                review.set_metadata({'title': 'Book visual review — unvalidated candidates',
                                     'creator': book.metadata.get('creator', ''),
                                     'subject': 'Actual Book pages; not design acceptance. Navigation to omitted pages removed.'})
                review.save(output, garbage=4, deflate=True)
                print(f'{len(review)} actual Book pages exported to {output}')
        payload = {
            'book_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'book_pages': len(book), 'font_profile': book.metadata.get('creator', ''),
            'scope': 'All numbered figures, tables and code listings; uncaptioned art is not inventoried.',
            'design_status': 'unvalidated', 'exhibits': records,
        }
    inventory.write_text(json.dumps(payload, indent=2) + '\n')
    print(f'{len(records)} captioned exhibits inventoried; none automatically approved')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('book', type=Path)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--labels', nargs='+', default=[])
    args = parser.parse_args()
    export(args.book, args.inventory, args.output, args.labels)
