"""Reconstruct reviewed source map excerpts, checking frozen source hashes."""
import hashlib,json,shutil
from pathlib import Path
here=Path(__file__).resolve().parent;out=Path('.scratch/visual-atlas/verification');out.mkdir(parents=True,exist_ok=True)
for name,entries in json.loads((here/'source-map-specs.json').read_text()).items():
    for entry in entries:
        sources=[entry[k] for k in ['source','sourceDependency'] if k in entry]+entry.get('sourceDependencies',[])
        for source in sources:
            p=Path(source['path']);assert hashlib.sha256(p.read_bytes()).hexdigest()==source['sha256'],f'Frozen source changed: {p}'
            source['excerpt']=p.read_text()[source['startChar']:source['endChar']]
    (out/(name+'.json')).write_text(json.dumps(entries,indent=2)+'\n')
shutil.copyfile(here/'main-listings.json',out/'five_main_listing_gaps.json')
