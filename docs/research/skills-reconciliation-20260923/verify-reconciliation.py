#!/usr/bin/env python3
"""Read-only coverage check; run after reconciliation, not while workers edit.

Checks explicit source-to-canonical paths and bytes, not semantic equivalence. Changed content
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
    parser.add_argument('--mappings', type=Path, default=Path(__file__).with_name('source-path-mappings.json'))
    args = parser.parse_args()
    mapping = json.loads(args.mappings.read_text()) if args.mappings.exists() else {}
    bundle_map = mapping.get('bundleDestinations', {})
    file_map = mapping.get('sourceFileDestinations', {})
    for path in list(bundle_map.values()) + [v for files_map in file_map.values() for v in files_map.values()]:
        if Path(path).is_absolute() or '..' in Path(path).parts or '\\' in path:
            raise ValueError(f'Unsafe destination mapping: {path}')
    rows = []
    for entry in sorted(args.source.iterdir()):
        candidates = [entry] + [base / entry.name for base in args.fallback]
        source = next((p.resolve() for p in candidates if p.is_dir() and (p/'SKILL.md').is_file()), None)
        destination_name = bundle_map.get(entry.name, entry.name)
        dest = args.destination / destination_name
        row = {'name': entry.name, 'destinationName': destination_name, 'source': str(source) if source else None,
               'destinationIsDirectory': dest.is_dir(), 'destinationIsSymlink': dest.is_symlink(),
               'skillPresent': (dest/'SKILL.md').is_file()}
        if source and dest.is_dir():
            sf, df = files(source), files(dest)
            path_map = file_map.get(entry.name, {})
            stale = sorted(set(path_map) - set(sf))
            if stale:
                raise ValueError(f'Stale source mapping for {entry.name}: {stale}')
            destinations = {n: path_map.get(n, n) for n in sf}
            if len(set(destinations.values())) != len(destinations):
                raise ValueError(f'Colliding destination paths for {entry.name}')
            row.update(sourceFiles=len(sf), destinationFiles=len(df),
                       mappedSourcePaths=path_map,
                       missingSourcePaths=sorted(n for n, target in destinations.items() if target not in df),
                       changedSourcePaths=sorted(n for n, target in destinations.items() if target in df and digest(sf[n]) != digest(df[target])),
                       destinationOnlyPaths=sorted(set(df)-set(destinations.values())))
        rows.append(row)
    problems = [r['name'] for r in rows if not r['source'] or not r['skillPresent'] or r['destinationIsSymlink'] or r.get('missingSourcePaths')]
    print(json.dumps({'entryCount':len(rows), 'structuralProblemNames':problems, 'entries':rows}, indent=2))
    return int(bool(problems))

if __name__ == '__main__':
    raise SystemExit(main())
