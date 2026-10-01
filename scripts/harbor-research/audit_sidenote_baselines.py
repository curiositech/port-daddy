#!/usr/bin/env python3
"""Reject detached prose sidenotes, independently of page-capacity checks.

The allocator records the final first baseline minus the shipped owner
baseline, in TeX points. Positive means below the owner. This does not certify
the choice of owner sentence, prose quality, or figure-caption adjacency.
"""
import argparse
import json
from pathlib import Path
import re


RECORD = re.compile(
    r"PD-MARGIN-BASELINE:\s*id=(\d+),\s*page=([^,]+),\s*offset=(-?[\d.]+)pt"
)


def audit(log: str, tolerance: float = 1.0) -> dict:
    records = [dict(id=int(i), page=p.strip(), offset_pt=float(d))
               for i, p, d in RECORD.findall(log)]
    displaced = [r for r in records if abs(r['offset_pt']) > tolerance]
    issues = []
    if not records:
        issues.append('No prose-baseline measurements; cannot certify adjacency.')
    if 'PD-MARGIN-CONVERGENCE: complete' not in log or 'PD-MARGIN-CONVERGENCE: pending' in log:
        issues.append('Geometry has not converged.')
    if displaced:
        issues.append(f'{len(displaced)} prose notes displaced by more than {tolerance:g}pt.')
    return dict(prose_notes=len(records), tolerance_pt=tolerance,
                largest_offset_pt=max((abs(r['offset_pt']) for r in records), default=None),
                displaced=displaced, issues=issues)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('log', type=Path)
    parser.add_argument('--tolerance', type=float, default=1.0)
    args = parser.parse_args()
    report = audit(args.log.read_text(), args.tolerance)
    print(json.dumps(report, indent=2))
    raise SystemExit(bool(report['issues']))
