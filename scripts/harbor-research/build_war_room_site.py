#!/usr/bin/env python3
"""Export an allowlisted public research view. Never publish transcript bodies.

Run again after final campaign receipts change. --source-base must identify the
published repository tree (prefer an immutable commit). Omit it while unpublished.
"""
import argparse
import hashlib
import json
import zipfile
from collections import Counter
from pathlib import Path
from urllib.parse import quote, urlparse

ROOT = Path(__file__).resolve().parents[2]
CAMPAIGN = ROOT / 'docs/harbor-research/campaigns/2026-11-06'
OUTPUT = ROOT / 'website-v2/public/research/war-room'


def read(relative):
    return json.loads((ROOT / relative).read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-base', default='', help='Published GitHub blob base, including immutable commit')
    args = parser.parse_args()
    if args.source_base:
        parsed = urlparse(args.source_base)
        if parsed.scheme != 'https' or parsed.netloc != 'github.com' or not parsed.path.startswith('/curiositech/port-daddy/blob/'):
            parser.error('source-base must be the HTTPS GitHub blob tree for curiositech/port-daddy')
    ledger = read('docs/harbor-research/omni-ledger.json')
    records = {r['id']: r for r in ledger['records']}
    intake = records['REVIEW-INTAKE-20261106']['review_intake']
    scout = records['LITERATURE-SCOUT-20261106']['literature_scout']
    red = json.loads((CAMPAIGN / 'red/attacks.json').read_text())
    retest = json.loads((CAMPAIGN / 'red-retest/verdict.json').read_text())
    blue = json.loads((CAMPAIGN / 'blue/verification-summary.json').read_text())
    isolation = json.loads((CAMPAIGN / 'isolation/verdict.json').read_text())
    transcripts = json.loads((CAMPAIGN / 'transcripts/manifest.json').read_text())
    if len(red['attacks']) != 3 or len(blue['harnesses']) != 5 or not all(h['successful'] for h in blue['harnesses']):
        raise SystemExit('Campaign changed: review static proof summary before regenerating')
    if sum(h['covers_satisfied'] for h in blue['harnesses']) != 17 or len(isolation['results']) != 3 or not all(r['pass'] for r in isolation['results']):
        raise SystemExit('Campaign changed: review static cover/probe summary before regenerating')
    repairs = {
        'R1-RED-001': 'Instantiate the roles in parallel with private parameters. Concrete traces now witness red publication, defense publication and defense learning; seeded plaintext leaks produce attacks.',
        'R1-RED-002': 'Give the publisher and receiver their own defense-key parameters. One joint trace witnesses both roles participating in the same execution.',
        'R1-RED-003': 'Bind a domain-separated seal signature to the manifest identity and ciphertext. The lead verifies the seal before release; correspondences check seal, release and learning order.',
    }
    sources = [
        ('Red attack report', 'docs/harbor-research/campaigns/2026-11-06/red/report.md'),
        ('White response', 'docs/harbor-research/campaigns/2026-11-06/white/report.md'),
        ('Independent red retest', 'docs/harbor-research/campaigns/2026-11-06/red-retest/report.md'),
        ('Blue verification report', 'docs/harbor-research/campaigns/2026-11-06/blue/REPORT.md'),
        ('Fixed guest probe report', 'docs/harbor-research/campaigns/2026-11-06/isolation/REPORT.md'),
        ('Primary-literature review', 'docs/harbor-research/campaigns/2026-11-06/primary-literature.md'),
        ('Source advice and coverage ledger', 'docs/harbor-research/OMNI-LEDGER.md'),
        ('Literature-scout crosswalk', 'docs/harbor-research/exposition/literature-scout-20261106/README.md'),
        ('Literature-scout source manifest', 'docs/harbor-research/exposition/literature-scout-20261106/source-manifest.json'),
        ('Current mathematical review of all 14 scout directions', 'docs/harbor-research/exposition/literature-scout-20261106/math-review.md'),
        ('Constructed scout counterexamples', 'docs/harbor-research/research/scout-claim-counterexamples.md'),
        ('Source-intake manifest', 'docs/harbor-research/exposition/review-intake-20261106/source-manifest.json'),
        ('Transcript capture contract', 'docs/harbor-research/campaigns/2026-11-06/transcripts/README.md'),
        ('Transcript inventory', 'docs/harbor-research/campaigns/2026-11-06/transcripts/manifest.json'),
    ]
    guest_python = None
    guest_verdict_path = CAMPAIGN / 'guest-python/verdict.json'
    guest_manifest_path = CAMPAIGN / 'guest-python/manifest.json'
    if guest_verdict_path.is_file() and guest_manifest_path.is_file():
        guest = json.loads(guest_verdict_path.read_text())
        if guest['verdict'] != 'PASS' or not all(guest['checks'].values()) or guest['vm_exit_code'] != 0:
            raise SystemExit('Guest Python result changed: review the card summary before publishing')
        guest_manifest_bytes = guest_manifest_path.read_bytes()
        guest_manifest = json.loads(guest_manifest_bytes)
        if hashlib.sha256(guest_manifest_bytes).hexdigest() != guest['manifest_sha256']:
            raise SystemExit('Guest Python manifest hash mismatch')
        guest_python = {key: guest[key] for key in ('scope', 'verdict', 'research_results', 'checks', 'manifest_sha256', 'vm_exit_code')}
        guest_python.update({key: guest_manifest[key] for key in ('python_version', 'python_binary_sha256', 'payload_sha256', 'expected_exit_codes', 'boundary_profile')})
        guest_python['host_agent_privacy_enforced'] = False
        guest_python['provenance_limit'] = 'Fixed guest serial claims are compared to staged inputs; observed package hashes do not independently authenticate upstream packages. APK signatures and APKINDEX checksums were not verified.'
        for label, name in (('Fixed Python guest execution report', 'REPORT.md'), ('Fixed Python guest verdict', 'verdict.json'), ('Fixed Python guest source manifest', 'manifest.json')):
            source = CAMPAIGN / 'guest-python' / name
            if source.is_file():
                sources.append((label, str(source.relative_to(ROOT))))
    audit_path = ROOT / 'docs/harbor-research/exposition/literature-scout-20261106/source-verification.json'
    source_audit = None
    if audit_path.is_file():
        audit = json.loads(audit_path.read_text())
        source_audit = {'status': audit['audit_status'], 'coverage_claim': audit['coverage_claim'], 'citations': len(audit['sources']), 'statuses': dict(Counter(item['status'] for item in audit['sources'])), 'direction_checks': len(audit.get('direction_checks', []))}
        sources.append(('Literature source-verification inventory', str(audit_path.relative_to(ROOT))))
    audit_report = 'docs/harbor-research/exposition/literature-scout-20261106/literature-audit.md'
    if (ROOT / audit_report).is_file():
        sources.append(('Literature audit and claim boundaries', audit_report))
    artifacts = []
    for label, path in sources:
        target = ROOT / path
        if not target.is_file():
            raise SystemExit(f'Missing curated source: {path}')
        artifacts.append({'label': label, 'path': path, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'url': args.source_base.rstrip('/') + '/' + quote(path) if args.source_base else None})
    coverage = []
    for item in intake['items']:
        coverage.append({key: item[key] for key in ('id', 'summary', 'classification', 'targets', 'status') } | {'document': item['source']['document'], 'line': item['source']['line_start'], 'section': item['section']})
    with zipfile.ZipFile(ROOT / scout['archive']) as archive:
        scout_bytes = archive.read('literature-scout.md')
    scout_hash = hashlib.sha256(scout_bytes).hexdigest()
    scout_lines = scout_bytes.decode('utf-8').splitlines()
    for item in scout['items']:
        source = item['source']
        if source['document_sha256'] != scout_hash:
            raise SystemExit('Scout source hash mismatch')
        summary = '\n'.join(scout_lines[source['line_start'] - 1:source['line_end']])
        coverage.append({'id': item['id'], 'summary': summary, 'classification': item['classification'], 'targets': item['targets'], 'status': item['disposition'], 'document': 'scout', 'line': source['line_start'], 'section': ', '.join(item['directions']), 'prior_source_units': item['prior_source_units'], 'source_note': item['source_note']})
    if len({row['id'] for row in coverage}) != len(coverage):
        raise SystemExit('Duplicate source-unit IDs')
    combined_coverage = dict(intake['coverage'])
    combined_coverage['scout'] = {'total_lines': scout['coverage']['lines'], 'nonblank_lines': scout['coverage']['nonblank_units'], 'covered_nonblank_lines': len(scout['items'])}
    if len(coverage) != scout['coverage']['combined_nonblank_units']:
        raise SystemExit('Combined source-coverage mismatch')
    findings = []
    for attack in red['attacks']:
        findings.append({key: attack[key] for key in ('id', 'title', 'severity', 'claim', 'observation', 'qualification')} | {'response': repairs[attack['id']], 'verdict': retest['findings'].get(attack['id'], 'open')})
    data = {
        'schema': 'harbor-public-war-room/v1', 'campaign': '2026-11-06',
        'scope': retest['scope'], 'findings': findings,
        'retest': {key: retest[key] for key in ('status', 'independent_new_mutants', 'new_mutant_observations', 'canonical_model_sha256', 'direct_proverif_runs')},
        'blue': {key: blue[key] for key in ('harnesses', 'logic_only_verdict', 'source_scope', 'executions')},
        'isolation': isolation, 'guestPython': guest_python,
        'intake': {'status': records['REVIEW-INTAKE-20261106']['status'], 'coverage': combined_coverage, 'items': coverage},
        'documents': {'v5': 'Prescriptions v5', 'v4': 'Review v4', 'scout': 'Literature scout'},
        'scout': {'coverage': scout['coverage'], 'status': records['LITERATURE-SCOUT-20261106']['status'], 'falsifiers': scout['independent_constructed_falsifiers'], 'mathematical_adjudication': scout.get('mathematical_adjudication'), 'source_audit': source_audit, 'directions': [{key: d[key] for key in ('id', 'existing_tasks', 'disposition', 'hypothesis', 'acceptance', 'falsifier', 'next_action', 'source_claim_status')} for d in scout['directions']]},
        'math': [{key: f[key] for key in ('id', 'classification', 'result', 'next')} for f in records['REVIEW-MATH-20261106']['findings']],
        'nextP6': {key: records['NEXT-P6'][key] for key in ('title', 'status', 'result', 'next', 'assumptions')},
        'transcripts': {'scope': transcripts['scope'], 'projection': transcripts['projection'], 'sources_count': len(transcripts['sources']), 'publication': 'Visible-event projections are saved separately. Raw conversation logs and transcript bodies are not included in this viewer.'},
        'sources': artifacts,
    }
    output = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + '\n'
    if '/Users/' in output or 'pdr_' in output:
        raise SystemExit('Local path or credential marker in public export; review before publishing')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / 'campaign-data.json').write_text(output)
    manifest = {'schema': 'harbor-public-viewer-manifest/v1', 'files': []}
    for name in ('index.html', 'styles.css', 'viewer.js', 'campaign-data.json', 'walkthrough.webm', 'walkthrough-poster.png', 'viewer-qa.json'):
        path = OUTPUT / name
        if path.is_file():
            body = path.read_bytes()
            manifest['files'].append({'file': name, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()})
    (OUTPUT / 'viewer-manifest.json').write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    print(json.dumps({'advice_units': len(coverage), 'findings': len(findings), 'source_links': 'published' if args.source_base else 'pending', 'output_sha256': hashlib.sha256(output.encode()).hexdigest()}))


if __name__ == '__main__':
    main()
