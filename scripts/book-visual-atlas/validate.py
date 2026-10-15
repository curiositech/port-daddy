#!/usr/bin/env python3
"""Validate a completed atlas against its frozen inventory and portable evidence."""
import argparse, collections, hashlib, json
from pathlib import Path

DIMENSIONS = ('typography', 'composition', 'color_contrast', 'consistency_economy',
              'purpose_fitness', 'encoding_relations', 'completeness_uncertainty', 'caption_context')

def validate(site):
    site = site.resolve()
    data = json.loads((site / 'atlas-data.json').read_text())
    items = data['items']; ids = {item['id'] for item in items}; errors = []
    if len(ids) != len(items): errors.append('Duplicate item IDs')
    active = [item for item in items if not item.get('excludedFromRanking')]
    assets = set()
    for item in items:
        ident = item['id']; ev = item.get('evaluation', {})
        for key in ('preview', 'sourceText', 'groupPreview'):
            if item.get(key): assets.add(item[key])
        for occ in item.get('occurrences', []):
            if not 1 <= occ['page'] <= data['book']['pages']: errors.append(ident + ': invalid PDF page')
            for key in ('crop', 'context'):
                if occ.get(key): assets.add(occ[key])
        if item.get('parentId') and item['parentId'] not in ids: errors.append(ident + ': missing parent')
        if item.get('excludedFromRanking'):
            if not item.get('exclusionReason'): errors.append(ident + ': unexplained exclusion')
            continue
        for field in ('purpose', 'shows', 'page_role', 'evidence', 'strengths', 'defects',
                      'improvements', 'comparison', 'confidence', 'limitations', 'provenance'):
            if not ev.get(field): errors.append(ident + ': absent review field ' + field)
        if ev.get('status') != 'inspected': errors.append(ident + ': not visually inspected')
        for dim in DIMENSIONS:
            value = ev.get('scores', {}).get(dim)
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not 0 <= value <= 5:
                errors.append(ident + ': invalid score ' + dim)
            if not ev.get('score_rationale', {}).get(dim): errors.append(ident + ': missing rationale ' + dim)
        scores = ev.get('scores', {})
        if all(isinstance(scores.get(k), (int, float)) for k in DIMENSIONS):
            craft = sum(scores[k] for k in DIMENSIONS[:4]) * 5
            information = sum(scores[k] for k in DIMENSIONS[4:]) * 5
            for key, expected in [('craft', craft), ('information', information), ('composite', (craft + information) / 2)]:
                if abs(ev.get(key, -1000) - expected) > 1e-6: errors.append(ident + ': score sum disagrees')
        prov = ev.get('provenance', {})
        for field in ('kind', 'status'):
            if not prov.get(field): errors.append(ident + ': missing provenance ' + field)
        if not (prov.get('verified') or prov.get('verification')): errors.append(ident + ': no stated verification')
        if not (item.get('source') or item.get('sourceAssets') or prov.get('source_paths')) and not (prov.get('questions') or prov.get('gaps')):
            errors.append(ident + ': no source and no stated gap')
        evidence_sha = ev.get('evidence', {}).get('pdf_sha256') or ev.get('evidence', {}).get('pdfSha256')
        if evidence_sha != data['pdfSha256']: errors.append(ident + ': wrong PDF digest')
    for path in assets:
        if not (site / path).is_file(): errors.append('Missing asset ' + path)
    sources = json.loads((site / 'source-manifest.json').read_text())
    for source in sources:
        path = site / source['snapshot']
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != source['sha256']:
            errors.append('Source snapshot missing or changed: ' + source['snapshot'])
    def check_snapshots(value):
        if isinstance(value, dict):
            for child in value.values(): check_snapshots(child)
        elif isinstance(value, list):
            for child in value: check_snapshots(child)
        elif isinstance(value, str) and value.startswith('file://'):
            errors.append('Nonportable local evidence link ' + value)
        elif isinstance(value, str) and value.startswith('source-files/'):
            if not (site / value).is_file(): errors.append('Broken source link ' + value)
    check_snapshots(items)
    for ident in ('v00024', 'v00120', 'v00702'):
        item = next(x for x in items if x['id'] == ident)
        if item['type'] != 'Layer systems': errors.append(ident + ': layer comparison separated')
    coverage = data['coverage']
    if coverage['captionExpected'] != coverage['captionExtracted']: errors.append('Caption count mismatch')
    if coverage['rasterPlacementsExpected'] != coverage['rasterPlacementsExtracted']: errors.append('Raster count mismatch')
    result = dict(status='PASS' if not errors else 'FAIL', pdfSha256=data['pdfSha256'],
                  inventoryRecords=len(items), rankedObjects=len(active),
                  scoredObjects=sum(bool(x.get('evaluation', {}).get('scores')) for x in active),
                  excludedAuditRecords=len(items)-len(active), previewAndContextAssets=len(assets),
                  sourceSnapshots=len(sources), families=dict(sorted(collections.Counter(x['type'] for x in active).items())),
                  provenanceStatuses=dict(collections.Counter(x['evaluation']['provenance']['status'] for x in active)),
                  errors=errors, limits=['This verifies coverage, lineage and review structure, not aesthetic truth, external rights, or theorem correctness.'])
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('site', type=Path); parser.add_argument('--output', type=Path)
    args = parser.parse_args(); result = validate(args.site)
    if args.output: args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result['status'] == 'PASS' else 1)
