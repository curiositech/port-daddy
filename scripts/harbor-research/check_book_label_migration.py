#!/usr/bin/env python3
"""Read-only, portable exact auxiliary migration gate (standard library only).

--before-aux BASELINE.aux --after-aux CANDIDATE.aux --expected-report migration.json
No TeX execution, source rewriting, or permissive family-wide allowances.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

def group(text, pos):
    while pos < len(text) and text[pos].isspace():
        pos += 1
    if pos >= len(text) or text[pos] != '{':
        raise ValueError('Malformed auxiliary group')
    start, depth = pos+1, 1
    pos += 1
    while pos < len(text) and depth:
        if text[pos] == '\\':
            pos += 2
            continue
        depth += (text[pos] == '{') - (text[pos] == '}')
        pos += 1
    if depth:
        raise ValueError('Unterminated auxiliary group')
    return text[start:pos-1], pos

def parse(data):
    text = data.decode('utf-8')
    if re.search(r'^\s*\\@input\{', text, re.M):
        raise ValueError('Supply a complete aux, not an aux with includes')
    labels = {}
    for line in text.splitlines():
        if not line.startswith('\\newlabel{'):
            continue
        name, pos = group(line,len('\\newlabel'))
        payload, _ = group(line,pos)
        if name in labels:
            raise ValueError('Duplicate label: '+name)
        fields, pos = [], 0
        while pos < len(payload.rstrip()):
            value, pos = group(payload,pos)
            fields.append(value)
        labels[name] = fields
    if not labels:
        raise ValueError('Aux contains no labels')
    return labels

def signature(name, fields):
    if name.endswith('@cref'):
        if len(fields) < 2:
            raise ValueError('Incomplete cleveref record: '+name)
        return {'cref':fields[0]}
    if len(fields) < 4:
        raise ValueError('Incomplete hyperref record: '+name)
    return {'number':fields[0], 'anchor':fields[3]}

def signatures(data):
    return {name:signature(name,fields) for name,fields in parse(data).items()}

def section_star_contents(data):
    """Ordered unnumbered contents identities; pages may reflow, anchors may not."""
    records = []
    for line in data.decode('utf-8').splitlines():
        line = line.lstrip()
        if not re.match(r'\\@writefile(?=\s*\{)', line):
            continue
        stream, pos = group(line, len('\\@writefile'))
        payload, _ = group(line, pos)
        payload = payload.lstrip()
        if not re.match(r'\\contentsline(?=\s*\{)', payload):
            continue
        fields, pos = [], len('\\contentsline')
        for _ in range(4):
            value, pos = group(payload, pos)
            fields.append(value)
        kind, title, page, anchor = fields
        if anchor.startswith('section*'):
            if not re.fullmatch(r'section\*\.\d+', anchor):
                raise ValueError('Malformed section-star contents anchor: '+anchor)
            records.append(dict(stream=stream, kind=kind, title=title, anchor=anchor))
    return records

def expected_section_star_contents(data, retitles_path=None):
    """Optional explicit title-only corrections; every other field stays exact.

    Older per-figure proofs may predate an editorial correction. The caller
    must supply reviewed before/after titles keyed by exact anchor; no global
    title normalization, missing-anchor tolerance, or implicit environment read.
    """
    records=section_star_contents(data)
    if retitles_path is None:
        return records
    changes=json.loads(Path(retitles_path).read_text())
    if not isinstance(changes,list):
        raise ValueError('Retitles must be a list')
    seen=set()
    for change in changes:
        if (not isinstance(change,dict) or set(change)!={'anchor','before','after'}
                or not all(isinstance(v,str) and v for v in change.values())
                or change['anchor'] in seen or change['before']==change['after']):
            raise ValueError('Malformed or duplicate title correction')
        seen.add(change['anchor'])
        matches=[r for r in records if r['anchor']==change['anchor']]
        if len(matches)!=1 or matches[0]['title']!=change['before']:
            raise ValueError('Title correction does not match its exact baseline')
        matches[0]['title']=change['after']
    return records

def section_star_expectations(report):
    """Absence is legacy mode; explicit malformed or partial data is an error."""
    if not isinstance(report, dict):
        raise ValueError('Expected report must be an object')
    keys = ('section_star_contents_before', 'section_star_contents_after')
    present = [key in report for key in keys]
    if not any(present):
        return None
    if not all(present):
        raise ValueError('Both section_star_contents before/after fields are required')
    for key in keys:
        records = report[key]
        if not isinstance(records, list):
            raise ValueError(key+' must be a list')
        for record in records:
            if (not isinstance(record, dict) or
                set(record) != {'stream', 'kind', 'title', 'anchor'} or
                not all(isinstance(value, str) for value in record.values()) or
                not record['stream'] or not record['kind'] or
                not re.fullmatch(r'section\*\.\d+', record['anchor'])):
                raise ValueError('Malformed record in '+key)
    return tuple(report[key] for key in keys)

def audit(before, after, report):
    section_expectations = section_star_expectations(report)
    if hashlib.sha256(before).hexdigest() != report['baseline_aux_sha256']:
        raise ValueError('Baseline SHA256 mismatch')
    if report.get('unresolved'):
        raise ValueError('Expected report has unresolved source records')
    old = signatures(before)
    if old != report['before']:
        raise ValueError('Expected report baseline signatures do not match baseline aux')
    expected = report['after']
    if set(expected)-set(old) != set(report['inserted_records']):
        raise ValueError('Report insertion set disagrees')
    if set(old)-set(expected):
        raise ValueError('This migration authorizes no removals')
    actual = signatures(after)
    failures = []
    for name in sorted(set(expected)|set(actual)):
        if expected.get(name) != actual.get(name):
            failures.append({'label':name, 'expected':expected.get(name), 'actual':actual.get(name)})
    if section_expectations is not None:
        section_before, section_after = section_expectations
        if section_star_contents(before) != section_before:
            raise ValueError('Expected report baseline section-star contents do not match baseline aux')
        actual_sections = section_star_contents(after)
        for index in range(max(len(section_after), len(actual_sections))):
            wanted = section_after[index] if index < len(section_after) else None
            got = actual_sections[index] if index < len(actual_sections) else None
            if wanted != got:
                failures.append({'section_star_contents_index':index,
                                 'expected':wanted, 'actual':got})
    return {'ok':not failures, 'baseline_aux_sha256':report['baseline_aux_sha256'],
            'existing_public_labels':sum(not n.endswith('@cref') for n in old),
            'expected_changed_public_labels':len(report['shifts']),
            'expected_inserted_public_labels':len(report['insertions']),
            'checked_records_including_cref':len(expected), 'failures':failures,
            'boundary':'Exact label set, printed numbers, hyperref anchors and cleveref identity/sort records; label pages and titles may change. Explicit section-star contents preserve ordered identities and titles, with page reflow allowed. No build or runtime checks.'}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for arg in ('before-aux','after-aux','expected-report'):
        p.add_argument('--'+arg,type=Path,required=True)
    a=p.parse_args()
    try:
        result=audit(a.before_aux.read_bytes(),a.after_aux.read_bytes(),json.loads(a.expected_report.read_text()))
    except (OSError,ValueError,KeyError,TypeError,IndexError) as exc:
        print(json.dumps({'ok':False,'input_error':str(exc)},indent=2))
        return 2
    print(json.dumps(result,indent=2))
    return 0 if result['ok'] else 1

if __name__=='__main__':
    sys.exit(main())
