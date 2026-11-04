#!/usr/bin/env python3
"""Build a navigation-preserving facing-page reading copy of a PDF.

Sources checked against installed PyMuPDF 1.26.7 and primary documentation:
https://pymupdf.readthedocs.io/en/latest/page.html#Page.transformation_matrix
https://pymupdf.readthedocs.io/en/latest/document.html#Document.resolve_names

get_links GOTO coordinates are top-left MuPDF coordinates. resolve_names (and
LINK_NAMED targets) are bottom-left PDF coordinates: transform them explicitly.
This bounded utility accepts unrotated, uncropped pages and XYZ destinations;
it refuses other geometry, annotations, or navigation instead of losing them.
"""
import argparse
import collections
import difflib
import hashlib
import json
import re
import tempfile
from pathlib import Path

import fitz

TOL = .025


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_hash(path):
    return digest(Path(path).read_bytes())


def require(test, message):
    if not test:
        raise ValueError(message)


def numbers(value):
    return [float(x) for x in value]


def close(a, b):
    return len(a) == len(b) and all(abs(x-y) <= TOL for x, y in zip(a, b))


def pdf_key_bytes(name):
    require(all(ord(c) >= 32 for c in name), 'Control character in destination name')
    return name.encode('latin1') if all(ord(c) <= 255 for c in name) else b'\xfe\xff' + name.encode('utf-16be')


def direct_xyz_destination(doc, item):
    """Read XYZ targets directly: some readers report every direct-link zoom as 0."""
    xref = item.get('xref')
    require(isinstance(xref, int) and xref > 0, f'Missing navigation object: {item}')
    kind, raw = doc.xref_get_key(xref, 'A/D')
    if kind == 'null':
        kind, raw = doc.xref_get_key(xref, 'Dest')
    number = r'[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)'
    target = re.fullmatch(r'\[\s*(\d+)\s+0\s+R\s*/XYZ\s+(' + number +
                          r')\s+(' + number + r')\s+(' + number + r'|null)\s*\]', raw)
    require(kind == 'array' and target is not None,
            f'Unsupported direct destination (requires numeric XYZ position): {raw}')
    pno = item['page']
    require(0 <= pno < len(doc) and int(target[1]) == doc.page_xref(pno),
            f'Destination page reference disagrees: {item}')
    point = fitz.Point(float(target[2]), float(target[3])) * doc[pno].transformation_matrix
    zoom = 0.0 if target[4] == 'null' else float(target[4])
    return pno, point, zoom


def canonical_destination(doc, item, names):
    kind = item.get('kind', fitz.LINK_NONE)
    if kind == fitz.LINK_NONE:
        return {'kind': 'none'}
    if kind == fitz.LINK_URI:
        return {'kind': 'uri', 'uri': item['uri']}
    if kind == fitz.LINK_NAMED or (kind == fitz.LINK_GOTO and item.get('page', -1) < 0):
        name = item.get('nameddest', item.get('to'))
        require(isinstance(name, str) and name in names,
                f'Unsupported or unresolved named destination/action: {item}')
        target = names[name]
        require(target.get('page', -1) >= 0 and 'to' in target and 'dest' not in target,
                f'Unsupported named destination (requires XYZ): {name}: {target}')
        pno = target['page']
        point = fitz.Point(target['to']) * doc[pno].transformation_matrix
        zoom = target.get('zoom', 0)
    elif kind == fitz.LINK_GOTO:
        pno, point, zoom = direct_xyz_destination(doc, item)
    else:
        raise ValueError(f'Unsupported navigation kind {kind}: {item}')
    require(0 <= pno < len(doc), f'Invalid target page: {pno}')
    require(all(abs(v) < 1e8 for v in point), f'Nonfinite destination: {item}')
    return {'kind': 'goto', 'page': pno, 'to': numbers(point), 'zoom': float(zoom)}


def remap_destination(target, placements):
    target = dict(target)
    if target['kind'] == 'goto':
        place = placements[target['page']]
        target['page'] = place['spread']
        target['to'] = [target['to'][0] + place['rect'][0], target['to'][1]]
    return target


def equal_destination(expected, actual):
    if expected['kind'] != actual['kind']:
        return False
    if expected['kind'] == 'none':
        return True
    if expected['kind'] == 'uri':
        return expected['uri'] == actual['uri']
    return (expected['page'] == actual['page'] and close(expected['to'], actual['to'])
            and abs(expected['zoom'] - actual['zoom']) <= TOL)


def build(source, output, receipt_path, *, force=False, details_path=None):
    source, output, receipt_path = map(lambda p: Path(p).resolve(), (source, output, receipt_path))
    require(len({source, output, receipt_path}) == 3, 'Source, output and receipt must differ')
    require(force or not output.exists(), f'Refusing to overwrite {output}; use --force')
    if details_path is not None:
        details_path = Path(details_path).resolve()
        require(details_path not in (source, output, receipt_path), 'Details path must be separate')
    original_bytes = source.read_bytes()
    receipt = {'status': 'running', 'source': str(source), 'source_sha256': digest(original_bytes),
               'output': str(output), 'pymupdf': fitz.VersionBind,
               'builder_sha256': file_hash(__file__),
               'coordinate_tolerance_pt': TOL, 'unsupported_items': [],
               'pairing': 'blank/cover, then physical pages2/3,4/5,...; trailing blank when required',
               'scale': 1, 'geometry_scope': 'unrotated pages, CropBox=MediaBox, origin(0,0)',
               'navigation_scope': 'URI, direct internal goto, XYZ named destinations, outline hierarchy/styles/targets; other navigation fails closed',
               'page_indices': 'zero-based in checks; human-facing physical page pairing is one-based'}
    with tempfile.NamedTemporaryFile(prefix=output.stem + '.', suffix='.pending.pdf',
                                     dir=output.parent, delete=False) as pending:
        temp_output = Path(pending.name)
    try:
        src = fitz.open(stream=original_bytes, filetype='pdf')
        require(not src.is_encrypted and len(src) > 0, 'Encrypted or empty source')
        names = src.resolve_names()
        links, toc = [], src.get_toc(simple=False)
        for pno, page in enumerate(src):
            require(page.rotation == 0, f'Unsupported rotated page {pno+1}')
            require(close(numbers(page.rect), numbers(page.mediabox)) and
                    close(numbers(page.rect), numbers(page.cropbox)),
                    f'Unsupported cropped/nonzero-origin page {pno+1}')
            annotations = page.annot_xrefs()
            require(all(a[1] == fitz.PDF_ANNOT_LINK for a in annotations),
                    f'Unsupported non-link annotations on page {pno+1}: {annotations}')
            current = page.get_links()
            require(len(current) == len(annotations),
                    f'Unparsed link annotation on page {pno+1}: {len(current)}/{len(annotations)}')
            for link in current:
                require(link['kind'] != fitz.LINK_NONE, f'Unresolved link on page {pno+1}')
                canonical_destination(src, link, names)
                # Additional actions would otherwise disappear during link reconstruction.
                require(src.xref_get_key(link['xref'], 'A/Next')[0] == 'null',
                        f'Unsupported chained link action on page {pno+1}')
                require(src.xref_get_key(link['xref'], 'AA')[0] == 'null',
                        f'Unsupported additional link action on page {pno+1}')
                links.append((pno, link))
        for name, target in names.items():
            canonical_destination(src, {'kind': fitz.LINK_NAMED, 'nameddest': name}, names)
        for entry in toc:
            d = entry[3]
            canonical_destination(src, d, names)
            if d.get('kind', 0) == fitz.LINK_NONE:
                require(all(src.xref_get_key(d['xref'], key)[0] == 'null' for key in ('A','Dest')),
                        f'Unsupported outline action: {entry[1]}')
        out = fitz.open()
        placements, halves = {}, []
        for spread in range((len(src)+2)//2):
            indices = [2*spread-1, 2*spread]
            widths = [src[i].rect.width if 0 <= i < len(src) else None for i in indices]
            widths = [widths[0] or widths[1], widths[1] or widths[0]]
            height = max(src[i].rect.height for i in indices if 0 <= i < len(src))
            page = out.new_page(width=sum(widths), height=height)
            for side, i in enumerate(indices):
                x = 0 if side == 0 else widths[0]
                valid = 0 <= i < len(src)
                r = fitz.Rect(x, 0, x+widths[side], src[i].rect.height if valid else height)
                half = {'spread': spread, 'side': 'left' if side == 0 else 'right',
                        'source_page': i if valid else None, 'rect': numbers(r)}
                halves.append(half)
                if valid:
                    placements[i] = half
                    if src[i].get_contents():
                        page.show_pdf_page(r, src, i, keep_proportion=True)
        # Preserve destination names as a name tree, remapped to output PDF coordinates.
        name_tokens, expected_names = [], {}
        for name in sorted(names, key=pdf_key_bytes):
            expected = remap_destination(canonical_destination(src,
                       {'kind':fitz.LINK_NAMED,'nameddest':name}, names), placements)
            expected_names[name] = expected
            page = out[expected['page']]
            point = fitz.Point(expected['to']) * ~page.transformation_matrix
            name_tokens.append(f'{fitz.get_pdf_str(name)} [{page.xref} 0 R /XYZ {point.x:.8f} {point.y:.8f} {expected["zoom"]:.8f}]')
        if name_tokens:
            out.xref_set_key(out.pdf_catalog(), 'Names', '<</Dests <</Names [' + ' '.join(name_tokens) + ']>>>>')
        expected_links = collections.defaultdict(list)
        for pno, original in links:
            place = placements[pno]
            r = fitz.Rect(original['from']) + (place['rect'][0],0,place['rect'][0],0)
            target = remap_destination(canonical_destination(src, original, names), placements)
            item = {'from': r, 'xref': 0}
            name = original.get('nameddest')
            if name:
                item.update(kind=fitz.LINK_GOTO, page=-1, to=name)
            elif target['kind'] == 'uri':
                item.update(kind=fitz.LINK_URI, uri=target['uri'])
            else:
                item.update(kind=fitz.LINK_GOTO, page=target['page'], to=fitz.Point(target['to']), zoom=target['zoom'])
            out[place['spread']].insert_link(item)
            expected_links[place['spread']].append({'source_page':pno, 'source_xref':original['xref'],
                                                    'from':numbers(r), 'target':target, 'named_destination':name})
        remapped_toc, expected_toc = [], []
        for level, title, oldpage, original in toc:
            target = remap_destination(canonical_destination(src, original, names), placements)
            detail = {key:original[key] for key in ('color','bold','italic','collapse') if key in original}
            if target['kind'] == 'goto':
                detail.update(kind=fitz.LINK_GOTO, page=target['page'], to=fitz.Point(target['to']), zoom=target['zoom'])
                newpage = target['page']+1
            elif target['kind'] == 'uri':
                detail.update(kind=fitz.LINK_URI, uri=target['uri']); newpage=-1
            else:
                detail.update(kind=fitz.LINK_NONE); newpage=-1
            remapped_toc.append([level,title,newpage,detail])
            expected_toc.append({'level':level,'title':title,'target':target,
                                 'style': {key:original[key] for key in ('color','bold','italic','collapse') if key in original},
                                 'outline_count': src.xref_get_key(original['xref'], 'Count')})
        if remapped_toc:
            out.set_toc(remapped_toc, collapse=0)
            # set_toc recalculates ancestor counts while constructing the tree,
            # overwriting requested states. The hierarchy is unchanged: preserve
            # its exact counts only after the complete outline exists.
            for original, copied in zip(toc, out.get_toc(simple=False)):
                kind, value = src.xref_get_key(original[3]['xref'], 'Count')
                require(kind in ('int', 'null'), f'Unsupported bookmark Count: {value}')
                out.xref_set_key(copied[3]['xref'], 'Count', value)
            source_outline = int(src.xref_get_key(src.pdf_catalog(), 'Outlines')[1].split()[0])
            output_outline = int(out.xref_get_key(out.pdf_catalog(), 'Outlines')[1].split()[0])
            root_count = src.xref_get_key(source_outline, 'Count')
            require(root_count[0] in ('int', 'null'), f'Unsupported outline root Count: {root_count}')
            out.xref_set_key(output_outline, 'Count', root_count[1])
        out.set_metadata(src.metadata)
        out.set_page_labels([{'startpage':s, 'prefix':', '.join(src[i].get_label() or str(i+1)
                            for i in (2*s-1,2*s) if 0 <= i < len(src))} for s in range(len(out))])
        out.xref_set_key(out.pdf_catalog(), 'PageLayout', '/SinglePage')
        out.xref_set_key(out.pdf_catalog(), 'PageMode', '/UseOutlines' if toc else '/UseNone')
        out.save(temp_output, garbage=4, deflate=True, no_new_id=True)
        out.close()
        checked = fitz.open(temp_output)
        verified_names = checked.resolve_names()
        require(set(verified_names) == set(names), 'Destination-name set changed')
        receipt['named_destination_checks'] = []
        for name, expected in expected_names.items():
            actual = canonical_destination(checked, {'kind':fitz.LINK_NAMED,'nameddest':name}, verified_names)
            require(equal_destination(expected, actual), f'Remapped named target differs: {name}')
            receipt['named_destination_checks'].append({'name':name,'target':actual,'pass':True})
        receipt['half_text_checks'] = []
        receipt['plain_text_extraction_differences'] = []
        receipt['text_comparison_method'] = ('Exact ordered PDF character stream with TEXT_INHIBIT_SPACES, '
            'plus every character origin and bounding box remapped at unit scale. Plain get_text text '
            'is also compared byte-for-byte; parser-inferred line/space differences are reported separately.')
        def page_chars(page, rect):
            flags = (fitz.TEXTFLAGS_RAWDICT & ~fitz.TEXT_PRESERVE_IMAGES) | fitz.TEXT_INHIBIT_SPACES
            return [c for b in page.get_text('rawdict', flags=flags, clip=rect)['blocks'] if 'lines' in b
                    for line in b['lines'] for span in line['spans'] for c in span['chars']]
        for half in halves:
            page = checked[half['spread']]
            actual = page.get_text('text', clip=fitz.Rect(half['rect']), sort=False)
            i = half['source_page']
            expected = src[i].get_text('text', clip=src[i].rect, sort=False) if i is not None else ''
            source_chars = page_chars(src[i], src[i].rect) if i is not None else []
            output_chars = page_chars(page, fitz.Rect(half['rect']))
            source_stream = ''.join(c['c'] for c in source_chars)
            output_stream = ''.join(c['c'] for c in output_chars)
            require(source_stream == output_stream,
                    f'Exact character-stream mismatch: source page {i}, spread {half["spread"]}, {half["side"]}')
            maximum_error = 0.0
            for a, b in zip(source_chars, output_chars):
                x = half['rect'][0]
                expected_origin = [a['origin'][0]+x, a['origin'][1]]
                expected_box = [a['bbox'][0]+x, a['bbox'][1], a['bbox'][2]+x, a['bbox'][3]]
                require(close(expected_origin,b['origin']) and close(expected_box,b['bbox']),
                        f'Character geometry changed: source page {i}')
                maximum_error = max(maximum_error, *(abs(u-v) for u,v in zip(expected_box,b['bbox'])),
                                    *(abs(u-v) for u,v in zip(expected_origin,b['origin'])))
            if actual != expected:
                receipt['plain_text_extraction_differences'].append(dict(half,
                    diff=''.join(difflib.unified_diff(expected.splitlines(True),actual.splitlines(True))),
                    interpretation='Raw PDF characters and all positions agree; inferred extraction layout differs.'))
            receipt['half_text_checks'].append(dict(half, source_text_sha256=digest(expected.encode()),
                  output_text_sha256=digest(actual.encode()), plain_text_exact_equal=(actual==expected),
                  source_character_stream_sha256=digest(source_stream.encode()),
                  output_character_stream_sha256=digest(output_stream.encode()),
                  character_stream_exact_equal=True, character_count=len(source_chars),
                  every_character_position_checked=True, maximum_coordinate_error_pt=maximum_error))
        receipt['link_checks'] = []
        for pno, page in enumerate(checked):
            actual = page.get_links(); expected = expected_links[pno]
            require(len(actual) == len(expected), f'Link count changed on spread {pno+1}')
            for want, got in zip(expected, actual):
                require(close(want['from'], numbers(got['from'])), f'Link hotspot mismatch on spread {pno+1}')
                target = canonical_destination(checked, got, verified_names)
                require(equal_destination(want['target'], target), f'Link target mismatch on spread {pno+1}')
                require(got.get('nameddest') == want['named_destination'], f'Named-link identity changed on spread {pno+1}')
                receipt['link_checks'].append(dict(want, spread=pno, target=target, pass_=True))
        actual_toc = checked.get_toc(simple=False)
        require(len(actual_toc) == len(expected_toc), 'Bookmark count changed')
        receipt['bookmark_checks'] = []
        if actual_toc:
            checked_outline = int(checked.xref_get_key(checked.pdf_catalog(), 'Outlines')[1].split()[0])
            require(checked.xref_get_key(checked_outline, 'Count') == root_count,
                    'Outline root count changed')
        for want, got in zip(expected_toc, actual_toc):
            require(want['level'] == got[0] and want['title'] == got[1], 'Bookmark hierarchy/title changed')
            target = canonical_destination(checked, got[3], verified_names)
            require(equal_destination(want['target'],target), f'Bookmark target changed: {want["title"]}')
            for key, value in want['style'].items():
                require(got[3].get(key) == value, f'Bookmark style changed: {want["title"]}: {key}')
            require(checked.xref_get_key(got[3]['xref'], 'Count') == want['outline_count'],
                    f'Bookmark descendant count/state changed: {want["title"]}')
            receipt['bookmark_checks'].append(dict(want, target=target, pass_=True))
        require(file_hash(source) == receipt['source_sha256'], 'Source changed during build')
        receipt.update(status='pass', source_pages=len(src), spread_pages=len(checked),
                       source_page_sizes_pt=[numbers(page.rect) for page in src],
                       output_page_sizes_pt=[numbers(page.rect) for page in checked],
                       source_links=len(links), output_links=len(receipt['link_checks']),
                       source_bookmarks=len(toc), output_bookmarks=len(actual_toc),
                       source_named_destinations=len(names), output_named_destinations=len(verified_names),
                       output_sha256=file_hash(temp_output))
        checked.close(); src.close()
        manifest = publication_receipt(receipt, source, temp_output, output)
        # Prepare both files before promotion. The website gate rejects a mismatched pair.
        with tempfile.NamedTemporaryFile(mode='w', prefix=receipt_path.stem + '.',
                                         suffix='.pending.json', dir=receipt_path.parent,
                                         delete=False) as pending_receipt:
            json.dump(manifest, pending_receipt, indent=2, ensure_ascii=False)
            pending_receipt.write('\n')
            manifest_temp = Path(pending_receipt.name)
        try:
            temp_output.replace(output)
            manifest_temp.replace(receipt_path)
        finally:
            manifest_temp.unlink(missing_ok=True)
    except Exception as exc:
        receipt.update(status='failed', error=str(exc))
        receipt['unsupported_items'].append(str(exc))
        raise
    finally:
        temp_output.unlink(missing_ok=True)
        if details_path is not None:
            details_path.write_text(json.dumps(receipt, indent=2, ensure_ascii=False)+'\n')
    return manifest



def publication_receipt(receipt, source, staged_output, output):
    """Small portable freshness receipt; detailed checks stay out of public assets."""
    halves = receipt['half_text_checks']
    return {
        'schema_version': 1,
        'status': receipt['status'],
        'source': {'file': source.name, 'sha256': receipt['source_sha256'],
                   'bytes': source.stat().st_size, 'pages': receipt['source_pages']},
        'output': {'file': output.name, 'sha256': receipt['output_sha256'],
                   'bytes': staged_output.stat().st_size, 'pages': receipt['spread_pages']},
        'builder': {'file': Path(__file__).name, 'sha256': receipt['builder_sha256'],
                    'pymupdf': receipt['pymupdf']},
        'verification': {
            'glyphs': sum(half['character_count'] for half in halves),
            'links': receipt['output_links'],
            'bookmarks': receipt['output_bookmarks'],
            'named_destinations': receipt['output_named_destinations'],
            'blank_halves': sum(half['source_page'] is None for half in halves),
            'coordinate_tolerance_pt': TOL,
            'maximum_coordinate_error_pt': max(half['maximum_coordinate_error_pt'] for half in halves),
            'exact_character_streams': True,
            'every_character_position_checked': True,
            'bookmark_states_checked': True,
        },
        'pairing': receipt['pairing'],
        'scale': receipt['scale'],
        'geometry_scope': receipt['geometry_scope'],
        'navigation_scope': receipt['navigation_scope'],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--receipt', required=True, type=Path,
                        help='Public compact source/output hash and fidelity receipt')
    parser.add_argument('--details', type=Path,
                        help='Optional detailed diagnostic receipt (contains local paths)')
    parser.add_argument('--force', action='store_true', help='Replace an existing output after verification')
    args = parser.parse_args()
    result = build(args.source, args.output, args.receipt, force=args.force, details_path=args.details)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
