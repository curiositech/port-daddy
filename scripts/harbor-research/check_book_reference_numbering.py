#!/usr/bin/env python3
"""Read-only Book numbering gate. Standard library only; never executes TeX.

python check-book-reference-numbering.py --before-aux OLD.aux \
    --after-aux NEW.aux --expected-report expected-theorem-renumbering.json

Exit 0: exact permitted numbering. Exit 1: regression. Exit 2: invalid input.
Page numbers, caption/title text and @cref formatting are deliberately excluded.
Use the complete mega-volume aux, not a root containing auxiliary includes.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

KINDS = {'theorem', 'definition', 'property', 'lemma', 'proposition',
         'corollary', 'conjecture', 'equation', 'table', 'figure',
         'pdworkedexample', 'example', 'remark', 'protocol'}

def group(text, pos):
    while pos < len(text) and text[pos].isspace():
        pos += 1
    if pos >= len(text) or text[pos] != '{':
        raise ValueError('Malformed auxiliary brace group')
    start, depth = pos + 1, 1
    pos += 1
    while depth and pos < len(text):
        if text[pos] == '\\':
            pos += 2
            continue
        depth += (text[pos] == '{') - (text[pos] == '}')
        pos += 1
    if depth:
        raise ValueError('Unterminated auxiliary brace group')
    return text[start:pos-1], pos

def parse(data):
    labels = {}
    text = data.decode('utf-8')
    if re.search(r'^\s*\\@input\{', text, re.M):
        raise ValueError('Auxiliary includes require a complete flattened aux input')
    for line in text.splitlines():
        if not line.startswith('\\newlabel{'):
            continue
        name, pos = group(line, len('\\newlabel'))
        payload, _ = group(line, pos)
        if name in labels:
            raise ValueError('Duplicate auxiliary label: ' + name)
        fields, pos = [], 0
        while pos < len(payload.rstrip()):
            field, pos = group(payload, pos)
            fields.append(field)
        labels[name] = fields
    if not labels:
        raise ValueError('No labels found')
    return labels

def kind(fields):
    return fields[3].split('.')[0] if len(fields) >= 4 else ''

def numbered(name, fields):
    return (not name.endswith('@cref') and
            (kind(fields) in KINDS or bool(re.search(r'(?:^|:)(?:thm|def|prop|eq|tab|fig|lem|cor):', name))))

def bump(value):
    stem, dot, tail = value.rpartition('.')
    if not dot or not tail.isdigit():
        raise ValueError('Cannot increment numbered value: ' + value)
    return stem + '.' + str(int(tail) + 1)

def audit(before_data, after_data, report):
    digest = hashlib.sha256(before_data).hexdigest()
    if digest != report['old_aux_sha256']:
        raise ValueError('Baseline SHA256 differs from approved expected report')
    if report.get('unresolved'):
        raise ValueError('Expected report has unresolved labels')
    before, after = parse(before_data), parse(after_data)
    expected = report['expected']
    migrations = report.get('explicit_label_migrations', {})
    approved_migrations = {'ls:hyp:spec-variance': ('4.4.3.2', 'equation.4.4', '4.4.3', 'pdworkedexample.4.4.3')}
    if set(migrations) != set(approved_migrations):
        raise ValueError('Migration allowlist differs from approved label')
    for name, approved in approved_migrations.items():
        row = migrations[name]
        if tuple(row[k] for k in ('number', 'anchor', 'expected_number', 'expected_anchor')) != approved:
            raise ValueError('Migration values differ from approved exact transition: ' + name)
        old = before.get(name, [])
        if len(old) < 4 or (old[0], old[3]) != approved[:2]:
            raise ValueError('Migration baseline values disagree: ' + name)
    old_theorems = {n for n, f in before.items() if kind(f) == 'theorem' and not n.endswith('@cref')}
    if set(expected) != old_theorems:
        raise ValueError('Expected map does not cover exactly all old theorem anchors')
    removed = set(report['allowed_removed_labels'])
    if removed != {'he:tab:he-float-plan-settlement'} or not removed <= before.keys():
        raise ValueError('Removal allowance differs from approved label')
    ins = report['figure_insertion']
    if ins['label'] != 'fh:fig:fh-visible-topology' or ins['before_label'] != 'fh:fig:fh-cycle-vs-cut':
        raise ValueError('Unexpected insertion identity')
    pivot = before[ins['before_label']]
    if [ins['number'], ins['anchor']] != [pivot[0], pivot[3]]:
        raise ValueError('Insertion must occupy the old cycle-vs-cut number')
    shifts = set(ins['shift_labels'])
    actual_shifts = {n for n, f in before.items() if n.startswith('fh:') and kind(f) == 'figure'
                     and f[0].startswith('8.') and f[0][2:].isdigit()
                     and int(f[0][2:]) >= int(ins['number'].split('.')[-1])}
    if shifts != actual_shifts:
        raise ValueError('Figure allowlist does not exactly match subsequent FH figures')
    failures, checked = [], 0
    for name, old in before.items():
        if name.endswith('@cref'):
            continue
        if name in removed:
            if name in after or name + '@cref' in after:
                failures.append({'label': name, 'error': 'explicitly removed label remains'})
            continue
        if not numbered(name, old):
            continue
        checked += 1
        number = old[0]
        anchor = old[3] if len(old) >= 4 else None
        if name in expected:
            row = expected[name]
            if [number, anchor] != [row['number'], row['anchor']]:
                raise ValueError('Expected report old values disagree: ' + name)
            number, anchor = row['expected_number'], row['expected_anchor']
        elif name in migrations:
            number, anchor = migrations[name]['expected_number'], migrations[name]['expected_anchor']
        elif name in shifts:
            number, anchor = bump(number), bump(anchor)
        new = after.get(name)
        # Only semantic numbered anchors are stable: Item/Nameref incidental
        # anchors may move without changing the public label number.
        check_anchor = kind(old) in KINDS
        if not new or new[0] != number or (check_anchor and (len(new) < 4 or new[3] != anchor)):
            failures.append({'label': name, 'expected_number': number,
                             'expected_anchor': anchor if check_anchor else '(not constrained)',
                             'actual': new})
    if ins['label'] in before:
        raise ValueError('Insertion label already exists in baseline')
    new = after.get(ins['label'], [])
    if len(new) < 4 or [new[0], new[3]] != [ins['number'], ins['anchor']]:
        failures.append({'label': ins['label'], 'error': 'missing or incorrectly numbered insertion', 'actual': new})
    for name in after.keys() - before.keys():
        if name != ins['label'] and numbered(name, after[name]):
            failures.append({'label': name, 'error': 'unapproved new numbered label'})
    return {'ok': not failures, 'baseline_sha256': digest, 'checked_existing_numbered_labels': checked,
            'theorem_labels': len(expected), 'changed_theorem_labels': sum(r['number'] != r['expected_number'] for r in expected.values()),
            'shifted_FH_figures': len(shifts), 'explicit_removals': sorted(removed),
            'explicit_migrations': sorted(migrations), 'failures': failures,
            'boundary': 'Numbers and semantic anchors only; not page placement, title text, cref formatting, or unlabeled counters.'}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ('before-aux', 'after-aux', 'expected-report'):
        parser.add_argument('--' + arg, type=Path, required=True)
    args = parser.parse_args()
    try:
        result = audit(args.before_aux.read_bytes(), args.after_aux.read_bytes(), json.loads(args.expected_report.read_text()))
    except (OSError, ValueError, KeyError, IndexError, TypeError) as exc:
        print(json.dumps({'ok': False, 'input_error': str(exc)}, indent=2))
        return 2
    print(json.dumps(result, indent=2))
    return 0 if result['ok'] else 1

if __name__ == '__main__':
    sys.exit(main())
