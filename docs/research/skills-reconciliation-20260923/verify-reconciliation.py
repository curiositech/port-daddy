#!/usr/bin/env python3
"""Read-only coverage check; run after reconciliation, not while workers edit.

Checks exact file names and bytes, not semantic equivalence. Changed content
must be explained by the per-skill inventories and research reports.
"""
import argparse
import hashlib
import json
from pathlib import Path

JUNK_NAMES = {'.DS_Store', '_raw_response.md'}
JUNK_DIRS = {'__pycache__', '.git', 'node_modules', '.venv', '.pytest_cache'}

def files(root):
    return {p.relative_to(root).as_posix(): p for p in root.rglob('*')
            if p.is_file() and p.name not in JUNK_NAMES
            and not any(part in JUNK_DIRS for part in p.relative_to(root).parts)
            and p.suffix != '.pyc'}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    parser.add_argument('--fallback', type=Path, action='append', default=[])
    args = parser.parse_args()
    rows = []
    for entry in sorted(args.source.iterdir()):
        candidates = [entry] + [base / entry.name for base in args.fallback]
        source = next((p.resolve() for p in candidates if p.is_dir() and (p/'SKILL.md').is_file()), None)
        dest = args.destination / entry.name
        row = {'name': entry.name, 'source': str(source) if source else None,
               'destinationIsDirectory': dest.is_dir(), 'destinationIsSymlink': dest.is_symlink(),
               'skillPresent': (dest/'SKILL.md').is_file()}
        if source and dest.is_dir():
            sf, df = files(source), files(dest)
            row.update(sourceFiles=len(sf), destinationFiles=len(df),
                       missingSourcePaths=sorted(set(sf)-set(df)),
                       changedSourcePaths=sorted(n for n in set(sf)&set(df) if digest(sf[n]) != digest(df[n])),
                       destinationOnlyPaths=sorted(set(df)-set(sf)))
        rows.append(row)
    problems = [r['name'] for r in rows if not r['source'] or not r['skillPresent'] or r['destinationIsSymlink'] or r.get('missingSourcePaths')]
    print(json.dumps({'entryCount':len(rows), 'structuralProblemNames':problems, 'entries':rows}, indent=2))
    return int(bool(problems))

if __name__ == '__main__':
    raise SystemExit(main())
