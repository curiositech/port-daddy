#!/usr/bin/env python3
"""Extract an evidence inventory; candidate detection never implies visual approval."""
import argparse, hashlib, json, re, sys
from pathlib import Path
import fitz
from PIL import Image
sys.path.insert(0, str(Path(__file__).parent / 'harbor-research'))
from export_book_visual_review import caption_records
from export_book_type_review import tex_groups
from check_book_caption_margins import exhibit_records

def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def plain(t): return re.sub(r'\\[a-zA-Z@]+\*?(?:\[[^]]*\])?', '',t).replace('{','').replace('}','').strip()
def source_record(p,text,start,end):
    excerpt=text[start:end]
    return dict(path=str(p),lineStart=text.count('\n',0,start)+1,lineEnd=text.count('\n',0,end)+1,sha256=digest(p),excerpt=excerpt)
def enclosing_exhibit(text,pos):
    stack=[];spans=[]
    for m in re.finditer(r'\\(begin|end)\{([^}]+)\}',text):
        if m[1]=='begin':stack.append((m[2],m.start()))
        elif stack and stack[-1][0]==m[2]:
            env,start=stack.pop()
            if start<=pos<m.end() and env in ('figure','figure*','table','table*','xltabular','longtable','lstlisting'):
                spans.append((start,m.end()))
    return min(spans,key=lambda b:b[1]-b[0]) if spans else (max(0,pos-1500),min(len(text),pos+1500))
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--pdf',type=Path,required=True);ap.add_argument('--build',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);a=ap.parse_args()
    out=a.output;out.mkdir(parents=True,exist_ok=True)
    for d in ['crops','contexts','sources']: (out/d).mkdir(exist_ok=True)
    aux=(a.build/'coordination-papers-mega-volume.aux').read_text();caps=caption_records(aux);owners=exhibit_records(aux)
    files=list(Path('website-v2/public/whitepaper').glob('*.tex'))+list(Path('whitepaper').rglob('*.tex'))+list(a.build.glob('*.tex')); sources={p:p.read_text() for p in files};labelmap={}
    for p,t in sources.items():
        for m in re.finditer(r'\\label\{([^}]+)\}|\[([^]\n]+)\]',t):
            key=m[1] or m[2]
            if ':' in key:labelmap[key]=(p,t,m.start())
    doc=fitz.open(a.pdf);names=doc.resolve_names();items=[];covered={};pagefacts=[]
    def emit(kind,title,page,bbox,source=None,caption='',extra=None):
        ident=f'v{len(items)+1:05d}';pg=doc[page-1];rect=fitz.Rect(bbox)&pg.rect
        if rect.is_empty: rect=pg.rect
        crop=rect+(-9,-9,9,9);crop &=pg.rect
        cp=f'crops/{ident}.png';pg.get_pixmap(matrix=fitz.Matrix(1.1,1.1),clip=crop,alpha=False).save(out/cp)
        ctx=f'contexts/page-{page:04d}.png'
        if not (out/ctx).exists():pg.get_pixmap(matrix=fitz.Matrix(.58,.58),alpha=False).save(out/ctx)
        txt=source['excerpt'] if source else pg.get_text(clip=rect)
        sp=f'sources/{ident}.txt';(out/sp).write_text(txt)
        citations=re.findall(r'\\(?:pd)?cite\w*\{([^}]+)\}',txt)
        urls=re.findall(r'https?://[^\s{}]+',txt)
        item=dict(id=ident,kind=kind,type=kind,title=title,relatedFamily=('layer-stack' if re.search(r'layer|L0|L1|L2|L3|L4|stack',title+' '+caption) else None),caption=caption,purpose=caption or None,purposeStatus='caption-derived; editorial verification required' if caption else 'unverified',chapter=next((x[1] for x in reversed(doc.get_toc()) if x[0]<=2 and x[2]<=page),None),occurrences=[dict(page=page,printedPage=pg.get_label(),bbox=list(rect),crop=cp,context=ctx)],source=source,dataProvenance=dict(status='source excerpt captured; data lineage unverified' if source else 'source unresolved',dataKind='unknown',citations=citations,urls=urls,exactTableData=txt if kind=='table' else None),sourceText=sp,reviewStatus='unreviewed')
        if extra:item.update(extra)
        items.append(item);covered.setdefault(page,[]).append(rect);return item
    for c in caps:
        dest=names[c['destination']];page=dest['page']+1;pg=doc[page-1];owner=owners.get((c['kind'],c['number']));src=None;caption=''
        for line in aux.splitlines():
            if c['destination'] not in line or not line.startswith('\\@writefile'):continue
            outer=tex_groups(line);fields=tex_groups(outer[1]);parts=tex_groups(fields[1]);caption=plain(parts[1]) if len(parts)>1 else '';break
        for label in c['labels']:
            if label not in labelmap:continue
            p,t,pos=labelmap[label];beg,end=enclosing_exhibit(t,pos)
            if beg<0:beg=max(0,pos-2000)
            src=source_record(p,t,beg,end)
            before=t[:pos];cm=list(re.finditer(r'\\caption(?:\[[^]]*\])?\{',before))
            if cm:
                tail=t[cm[-1].end()-1:];depth=0;stop=0
                for j,ch in enumerate(tail):
                    if ch=='{':depth+=1
                    elif ch=='}':
                        depth-=1
                        if depth==0:stop=j+1;break
                sourceCaption=plain(tail[1:stop-1]) if stop else ''
            break
        if owner:
            x=owner['posx']/65536*72/72.27;y=pg.rect.height-owner['posy']/65536*72/72.27;box=(x,y,x+owner['width'],y+owner['height'])
        else:box=pg.rect
        emit(c['kind'],f"{c['kind'].title()} {c['number']}",page,box,src,caption,dict(captionRecord=c,geometryStatus='shipped exhibit anchor' if owner else 'full page fallback'))
    # Every raster placement is retained, including repeats and captioned overlap.
    imagegroups={}
    for index,pg in enumerate(doc):
        imgs=pg.get_image_info(hashes=True,xrefs=True);draws=pg.get_drawings();pagefacts.append(dict(page=index+1,printedPage=pg.get_label(),rasterPlacements=len(imgs),drawingPaths=len(draws)))
        for im in imgs:
            identity=im['digest'].hex();box=fitz.Rect(im['bbox']);over=[it['id'] for it in items if any(o['page']==index+1 and (fitz.Rect(o['bbox'])&box).get_area()>.5*box.get_area() for o in it['occurrences'])]
            if identity in imagegroups:
                existing=imagegroups[identity];ident=existing['id'];cp=f'crops/{ident}-p{index+1}-{len(existing["occurrences"])}.png';pg.get_pixmap(matrix=fitz.Matrix(1.1,1.1),clip=(box+(-9,-9,9,9))&pg.rect).save(out/cp);ctx=f'contexts/page-{index+1:04d}.png'
                if not (out/ctx).exists():pg.get_pixmap(matrix=fitz.Matrix(.58,.58)).save(out/ctx)
                existing['occurrences'].append(dict(page=index+1,printedPage=pg.get_label(),bbox=list(box),crop=cp,context=ctx,overlapsCaptionItems=over))
            else:
                it=emit('raster-art','Raster art '+identity[:12],index+1,box,extra=dict(assetIdentity='pdf-image-sha256:'+identity,overlapsCaptionItems=over));imagegroups[identity]=it
        # Conservative vector components: discard only running furniture edges.
        rects=[]
        for d in draws:
            r=fitz.Rect(d['rect'])
            if r.y1<45 or r.y0>pg.rect.height-42:continue
            if r.width<1 and r.height<1:continue
            rects.append(r+(-3,-3,3,3))
        clusters=[]
        for r in rects:
            touch=[j for j,b in enumerate(clusters) if b.intersects(r)]
            if touch:
                for j in reversed(touch):r|=clusters.pop(j)
            clusters.append(r)
        for n,r in enumerate(clusters):
            if r.width<14 or r.height<10:continue
            overlap=[b for b in covered.get(index+1,[]) if (b&r).get_area()>.75*r.get_area()]
            if overlap:continue
            emit('vector-candidate',f'Uncaptioned vector component p{index+1}.{n+1}',index+1,r,extra=dict(detectionStatus='candidate; may include table rules, margin navigation or decoration'))
    # Source macro census makes unlocated semantic objects explicit rather than dropping them.
    census=[]
    bodypaths=[p for p in files if p.parent==a.build or p.name=='chapter-0-prerequisites.tex']
    norm=lambda v:re.sub(r'[^a-z0-9]','',plain(v).lower())
    pagewords=[norm(p.get_text()) for p in doc]
    for p in bodypaths:
        text=sources[p]
        for m in re.finditer(r'\\(pdmarginfigure|pdmarginexhibit|SGMarginLadder|SGStackLayers|includegraphics)(?:\[[^]]*\])?',text):
            if text[max(0,m.start()-40):m.start()].count('newcommand'):continue
            depth=0;end=m.end();groups=[];pos=m.end()
            for count in range(4):
                while pos<len(text) and text[pos].isspace():pos+=1
                if pos>=len(text) or text[pos]!='{':break
                start=pos;depth=0
                for j in range(pos,len(text)):
                    if text[j]=='{':depth+=1
                    elif text[j]=='}':
                        depth-=1
                        if depth==0:pos=j+1;groups.append(text[start+1:j]);break
                else:break
                end=pos
            kind=m[1];caption=(groups[1] if kind=='pdmarginfigure' and len(groups)>1 else groups[3] if kind=='pdmarginexhibit' and len(groups)>3 else '')
            token=norm(caption)[:65];pages=[j+1 for j,v in enumerate(pagewords) if token and token in v]
            source=source_record(p,text,m.start(),end)
            entry=dict(macro=kind,arguments=groups,source=source,pages=pages,status='matched page text' if pages else 'unlocated source candidate')
            census.append(entry)
            if kind in ('pdmarginfigure','pdmarginexhibit') and pages:
                for page in pages:
                    existing=[i for i in items if i['kind']=='raster-art' and any(o['page']==page for o in i['occurrences'])]
                    if existing and kind=='pdmarginfigure':
                        for i in existing:i['sourceCandidates']=i.get('sourceCandidates',[])+[source];i['type']='portrait-or-margin-art';i['caption']=plain(caption);i['purpose']=plain(caption)
                    else:
                        pg=doc[page-1];x0=400 if page%2 else 15;x1=pg.rect.width-15 if page%2 else 150
                        emit('margin-exhibit',groups[0] if groups else kind,page,(x0,45,x1,pg.rect.height-45),source,plain(caption),dict(relatedFamily='layer-stack' if 'Ladder' in source['excerpt'] else None,geometryStatus='margin-column context; exact object bounds unverified'))
    (out/'source-census.json').write_text(json.dumps(census,indent=2)+'\n')
    for item in items:
        source=item.get('source')
        if not source:continue
        dependencies=[]
        for rel in re.findall(r'\\input\{([^}]+)\}',source['excerpt']):
            rel=rel if rel.endswith('.tex') else rel+'.tex'
            choices=[Path(source['path']).parent/rel,Path('whitepaper')/rel,Path('website-v2/public/whitepaper')/rel]
            dep=next((p for p in choices if p.exists()),None)
            if dep:dependencies.append(source_record(dep,dep.read_text(),0,len(dep.read_text())))
        item['sourceDependencies']=dependencies
        if 'fig:book-reader-map' in item.get('captionRecord',{}).get('labels',[]):
            full=Path('whitepaper/figures/fig-book-reader-map.tex');item['source']=source_record(full,full.read_text(),0,len(full.read_text()))
            leftlabel=next((tex_groups(tex_groups(line)[1])[3] for line in aux.splitlines() if line.startswith('\\newlabel{book:reader-left}')),None);left=names.get(leftlabel) if leftlabel else None
            if left:
                page=left['page']+1;pg=doc[page-1];cp=f'crops/{item["id"]}-left.png';ctx=f'contexts/page-{page:04d}.png';pg.get_pixmap(matrix=fitz.Matrix(1.1,1.1),alpha=False).save(out/cp)
                if not(out/ctx).exists():pg.get_pixmap(matrix=fitz.Matrix(.58,.58)).save(out/ctx)
                item['occurrences'].insert(0,dict(page=page,printedPage=pg.get_label(),bbox=list(pg.rect),crop=cp,context=ctx,part='first half of explicitly split source figure'))
    # Decoded pixel identity connects raster placements to actual shipped assets.
    assetmap={}
    for asset in Path('website-v2/public/whitepaper/plates').rglob('*'):
        if asset.suffix.lower() not in ('.jpg','.jpeg','.png','.webp'):continue
        try:identity=hashlib.md5(Image.open(asset).convert('RGB').tobytes()).hexdigest()
        except Exception:continue
        assetmap.setdefault(identity,[]).append(dict(path=str(asset),sha256=digest(asset)))
    for identity,item in imagegroups.items():
        item['sourceAssets']=assetmap.get(identity,[])
        if item['sourceAssets']:
            item['dataProvenance']['status']='exact unpremultiplied RGB identity matched shipped asset'
            asset=Path(item['sourceAssets'][0]['path']);side=asset.with_suffix('.json')
            if side.exists():item['assetProvenance']=dict(path=str(side),sha256=digest(side),receipt=json.loads(side.read_text()))
    for item in items:
        pg=doc[item['occurrences'][0]['page']-1]
        if item['kind']=='vector-candidate':
            item['candidateContext']=pg.get_text(clip=fitz.Rect(item['occurrences'][0]['bbox'])+(-15,-20,15,20))
            item['reviewScope']='vector audit candidate; classify frame/furniture/exhibit before diagram ranking'
            item['nearbyCaptionIds']=[i['id'] for i in items if 'captionRecord'in i and i['occurrences'][0]['page']==item['occurrences'][0]['page']]
        if item['kind']=='table' and item['source']:
            raw=item['source']['excerpt'];rows=re.split(r'\\\\(?:\[[^]]*\])?',raw)
            item['dataProvenance']['tableRowsTex']=[r.strip().split(' & ') for r in rows if '&' in r]
            item['dataProvenance']['exactTableData']=raw
            item['dataProvenance']['renderedTableText']=pg.get_text(clip=fitz.Rect(item['occurrences'][0]['bbox']))
    environments=[]
    envpaths=[p for p in files if p.name in ('mega-volume-body.tex','chapter-0-prerequisites.tex','coordination-papers-mega-volume-appendices.tex')]
    for p in envpaths:
        text=sources[p]
        for m in re.finditer(r'\\begin\{(tabularx?|tabular\*|xltabular|longtable|tikzpicture|axis)\}',text):
            end=text.find('\\end{'+m[1]+'}',m.end());end=end+len('\\end{'+m[1]+'}') if end>=0 else m.end()
            source=source_record(p,text,m.start(),end)
            owners=[i['id'] for i in items if i['source'] and i['source']['path']==str(p) and i['source']['lineStart']<=source['lineStart']<=i['source']['lineEnd']]
            environments.append(dict(environment=m[1],source=source,captionOwnerIds=owners,status='captioned-source interval' if owners else 'unmatched source environment; inspect before declaring uncaptioned'))
    (out/'environment-census.json').write_text(json.dumps(environments,indent=2)+'\n')
    payload=dict(schemaVersion='1.0',title='Governing AI Agents visual inventory',pdfSha256=digest(a.pdf),book=dict(path=str(a.pdf),sha256=digest(a.pdf),pages=len(doc)),items=items,coverage=dict(captionExpected=len(caps),captionExtracted=sum('captionRecord'in i for i in items),rasterPlacementsExpected=sum(p['rasterPlacements'] for p in pagefacts),rasterPlacementsExtracted=sum(len(i['occurrences']) for i in imagegroups.values()),pageFacts=pagefacts,sourceEnvironmentCandidates=len(environments),unmatchedSourceEnvironments=sum(not e['captionOwnerIds'] for e in environments),sourceMacroCandidates=len(census),unlocatedSourceMacros=sum(not c['pages'] for c in census)),limitations=['Vector components are conservative candidates, not semantic objects; disjoint chart marks may be separate candidates.','Text-only uncaptioned tables and macro-only drawings require source reconciliation and human page review.','Source excerpts are frozen assembled source; upstream author files are not implied by these paths.','Raster identity uses decoded-image MD5 provided by PyMuPDF; source hashes are SHA256.','Purpose is caption-derived, never a verified editorial judgment.','Data kind and lineage remain unknown pending source review.'])
    for i in imagegroups.values():i['assetIdentity']=i['assetIdentity'].replace('pdf-image-sha256:','pdf-image-md5:')
    (out/'atlas.json').write_text(json.dumps(payload,indent=2)+'\n');print(json.dumps(dict(items=len(items),coverage={k:v for k,v in payload['coverage'].items() if k!='pageFacts'})))
if __name__=='__main__':main()
