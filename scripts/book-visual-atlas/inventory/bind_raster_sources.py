"""Match both exact JPEG decoder pixels and unpremultiplied PNG color planes."""
import hashlib,json
from pathlib import Path
import fitz
from PIL import Image
b=Path('.scratch/visual-atlas/inventory');a=json.loads((b/'atlas.json').read_text());matches={}
for p in sorted(Path('website-v2/public/whitepaper/plates').rglob('*')):
    if p.suffix.lower()not in ('.jpg','.jpeg','.png','.webp'):continue
    variants=[]
    try:variants.append((fitz.Pixmap(str(p)).digest.hex(),'exact decoded image MD5 (PyMuPDF)'))
    except Exception:pass
    try:variants.append((hashlib.md5(Image.open(p).convert('RGB').tobytes()).hexdigest(),'exact unpremultiplied RGB MD5 (Pillow; separate alpha excluded)'))
    except Exception:pass
    for key,method in variants:
        value=dict(path=str(p),sha256=hashlib.sha256(p.read_bytes()).hexdigest(),method=method)
        if not any(x['path']==str(p)for x in matches.get(key,[])):matches.setdefault(key,[]).append(value)
aliases={}
for folder in ['website-v2/public/whitepaper','whitepaper']:
    for path in sorted(Path(folder).rglob('*')):
        if path.suffix.lower()in ('.jpg','.jpeg','.png','.webp'):
            aliases.setdefault(hashlib.sha256(path.read_bytes()).hexdigest(),[]).append(str(path))
for i in a['items']:
    if i['kind']!='raster-art':continue
    found=matches.get(i['assetIdentity'].split(':')[1],[]);i['sourceAssets']=[{k:v for k,v in s.items()if k!='method'}for s in found]
    if found:
        for primary in found:
            for path in aliases.get(primary['sha256'],[]):
                if not any(s['path']==path for s in i['sourceAssets']):i['sourceAssets'].append(dict(path=path,sha256=primary['sha256']))
        i['assetMatchMethod']=found[0]['method'];i['dataProvenance']['status']='Exact decoded source image identity matched; data lineage and independent rights clearance remain separate.'
        p=Path(found[0]['path']);side=p.with_suffix('.json');collection=p.parent/'PROVENANCE.json'
        if side.exists():i['assetProvenance']=dict(path=str(side),sha256=hashlib.sha256(side.read_bytes()).hexdigest(),receipt=json.loads(side.read_text()))
        elif collection.exists():
            data=json.loads(collection.read_text());receipt=data.get('plates',{}).get(p.stem)
            i['assetProvenance']=dict(path=str(collection),sha256=hashlib.sha256(collection.read_bytes()).hexdigest(),receipt=receipt,collectionMetadata={k:v for k,v in data.items()if k!='plates'},status='asset-specific collection entry'if receipt else'collection source located; asset-specific entry unresolved')
    else:
        i['assetMatchMethod']='unresolved';i['dataProvenance']['status']='No exact source image identity matched'
    if i['id']=='v00424':i.update(type='scene-pictogram',rankingEligibility='exclude',screening=dict(reason='Tiny repeated scene icon; navigation ornament, not independent artwork.'))
a['coverage']['sourceAssetsMatched']=sum(bool(i['sourceAssets'])for i in a['items']if i['kind']=='raster-art');assert a['coverage']['sourceAssetsMatched']==91
(b/'atlas.json').write_text(json.dumps(a,indent=2)+'\n');print('91of92exact raster assets bound; receipts and scene exclusion preserved')
