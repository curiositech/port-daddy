#!/usr/bin/env python3
"""Match every rendered exercise heading to its AUX folio and PDF destination.

Requires the converged .aux beside the PDF. Missing inventory, no exercises,
ambiguous headings or misplaced destinations fail closed. No folio is hardcoded.
"""
import argparse
from collections import defaultdict
from pathlib import Path
import re
import sys

import fitz


def exercise_navigation(path):
    path = Path(path)
    labels = []
    for line in path.with_suffix('.aux').read_text().splitlines():
        label = re.match(r'\\newlabel\{([^}]+)\}\{\{([^}]+)\}\{([^}]+)\}', line)
        destination = re.search(r'\{(pdexercise\.[^}]+)\}', line)
        if label and destination and not label.group(1).endswith('@cref'):
            key, number, folio = label.groups()
            labels.append(dict(label=key, number=number, folio=folio,
                               destination=destination.group(1)))
    headings = defaultdict(list)
    with fitz.open(path) as document:
        destinations = document.resolve_names()
        for index, page in enumerate(document):
            for block in page.get_text('dict')['blocks']:
                for line in block.get('lines', []):
                    text = ''.join(span['text'] for span in line['spans']).strip()
                    match = re.match(r'^(\d+\.\d+)\s+(Check|Trace|Open)\b', text, re.I)
                    if match:
                        headings[match.group(1)].append(dict(page=index,
                            folio=page.get_label(), text=text, bbox=list(line['bbox'])))
        issues, rows = [], []
        if not labels:
            issues.append('No exercise labels found in the matching AUX inventory')
        if not headings:
            issues.append('No rendered exercise headings found in the PDF')
        numbers = [label['number'] for label in labels]
        if len(numbers) != len(set(numbers)):
            issues.append('Exercise numbers are not unique in the AUX inventory')
        if set(numbers) != set(headings):
            issues.append('Rendered exercise headings and AUX labels are not one-to-one')
        for label in labels:
            number = label['number']
            found = headings.get(number, [])
            if len(found) != 1:
                issues.append(f'{label["label"]}: expected one heading, found {len(found)}')
                continue
            heading = found[0]
            destination = destinations.get(label['destination'])
            if destination is None or destination.get('page', -1) < 0 or 'to' not in destination:
                issues.append(f'{label["label"]}: missing/unresolved PDF destination')
                continue
            dest_page = destination['page']
            point = fitz.Point(destination['to']) * document[dest_page].transformation_matrix
            row = dict(label, heading=heading, destination_page=dest_page,
                       destination_point=list(point))
            rows.append(row)
            if label['folio'] != heading['folio'] or dest_page != heading['page']:
                issues.append(f'{label["label"]} ({number}): AUX p.{label["folio"]}, '
                    f'destination physical {dest_page+1}; heading physical '
                    f'{heading["page"]+1} / p.{heading["folio"]}')
            elif not (heading['bbox'][1]-24 <= point.y <= heading['bbox'][3]+2):
                issues.append(f'{label["label"]} ({number}): destination is not at its heading')
    return dict(labels=labels, headings=dict(headings), rows=rows, issues=issues)



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    args = parser.parse_args()
    try:
        result = exercise_navigation(args.pdf)
    except (OSError, ValueError, RuntimeError) as exc:
        print(f'Exercise navigation: missing or unreadable evidence: {exc}', file=sys.stderr)
        return 1
    print(f"Exercise navigation: {len(result['labels'])} labels, "
          f"{sum(map(len, result['headings'].values()))} rendered headings, "
          f"{len(result['issues'])} issues")
    for issue in result['issues']:
        print(issue)
    return int(bool(result['issues']))


if __name__ == '__main__':
    raise SystemExit(main())
