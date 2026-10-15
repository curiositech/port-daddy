#!/usr/bin/env python3
"""Save the editorial ledger and a portable offline ZIP; no remote publication."""
import argparse, hashlib, json, shutil, zipfile
from pathlib import Path

REVIEWS = {
 'figures-early.json':'root/figures-early.json',
 'figures-later.json':'ui/figures-later.json',
 'tables.json':'judge/tables.json',
 'supplemental.json':'judge/supplemental.json',
 'art.json':'inventory/art.json',
}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--atlas', type=Path, default=Path('.scratch/visual-atlas'))
    parser.add_argument('--ledger', type=Path, default=Path('docs/harbor-research/visual-atlas'))
    args=parser.parse_args(); root=Path.cwd().resolve(); atlas=args.atlas.resolve(); ledger=args.ledger.resolve()
    validation=json.loads((atlas/'verification/atlas-validation.json').read_text())
    if validation['status']!='PASS': raise SystemExit('Refusing to snapshot a failed atlas validation')
    ledger.mkdir(parents=True,exist_ok=True); (ledger/'reviews').mkdir(exist_ok=True)
    def write_json(source,dest):
        # Preserve repository-relative evidence so the ledger can move with a checkout.
        text=source.read_text().replace(str(root)+'/', '')
        json.loads(text); dest.write_text(text)
    write_json(atlas/'inventory/atlas.json',ledger/'inventory.json')
    write_json(atlas/'inventory/visual-screening.json',ledger/'screening.json')
    write_json(atlas/'inventory/coverage-proof.json',ledger/'coverage.json')
    write_json(atlas/'verification/atlas-validation.json',ledger/'validation.json')
    write_json(atlas/'verification/reproduction-result.json',ledger/'reproduction.json')
    for name,source in REVIEWS.items(): write_json(atlas/'reviews'/source,ledger/'reviews'/name)
    for name in ('final-qa-result.json','final-layout-report.json'):
        path=atlas/'ui'/name
        if path.exists(): write_json(path,ledger/name)
    summary=json.loads((atlas/'site/review-summary.json').read_text())
    manifest={'schemaVersion':1,'pdfSha256':validation['pdfSha256'],
              'purpose':'Frozen editorial judgments and source census; operator overrides are separate exported JSON.',
              'reviewSummary':summary,'files':[]}
    for path in sorted(ledger.rglob('*.json')):
        if path.name=='manifest.json': continue
        manifest['files'].append({'path':str(path.relative_to(ledger)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    (ledger/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    zip_path=atlas/'book-visual-atlas.zip'; files=[]
    for directory in ('site','inventory/crops','inventory/contexts','inventory/sources'):
        for path in sorted((atlas/directory).rglob('*')):
            if path.is_file(): files.append((path,'book-visual-atlas/'+str(path.relative_to(atlas))))
    for path in sorted(ledger.rglob('*')):
        if path.is_file(): files.append((path,'book-visual-atlas/ledger/'+str(path.relative_to(ledger))))
    for name in ('visual-atlas-rubric.md','visual-atlas-family-proposal.md'):
        files.append((root/'docs/harbor-research'/name,'book-visual-atlas/'+name))
    with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for path,name in files: archive.write(path,name)
        archive.writestr('book-visual-atlas/index.html','<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=site/index.html"><title>Book visual atlas</title><a href="site/index.html">Open the visual atlas</a>\n')
    receipt={'zip':str(zip_path.relative_to(root)),'bytes':zip_path.stat().st_size,
             'sha256':hashlib.sha256(zip_path.read_bytes()).hexdigest(),'entries':len(files)+1,
             'pdfSha256':validation['pdfSha256'],'note':'The ZIP includes rendered crops, page contexts, reviews, source snapshots and the ledger; the original full Book PDF is identified by hash and is not duplicated.'}
    (atlas/'package-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))

if __name__=='__main__':main()
