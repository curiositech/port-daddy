import json,re,sys,hashlib
from pathlib import Path
import fitz
sys.path.insert(0,'scripts');from book_visual_atlas_inventory import source_record
b=Path('.scratch/visual-atlas/inventory');a=json.loads((b/'atlas.json').read_text());items=a['items'];doc=fitz.open(a['book']['path']);assert len(items)==718
for spec in json.loads(Path('.scratch/visual-atlas/verification/five_main_listing_gaps.json').read_text()):
 ident=spec['proposedId'];assert ident==f'v{len(items)+1:05d}';p=Path(spec['sourcePath']);t=p.read_text();pos=sum(map(len,t.splitlines(keepends=True)[:spec['sourceLine']-1]));end=t.index('\\end{lstlisting}',pos)+len('\\end{lstlisting}');src=source_record(p,t,pos,end);dest=doc.resolve_names()[spec['pdfDestination']];pg=doc[dest['page']];assert dest['page']+1==spec['page'];y=pg.rect.height-dest['to'][1];lines=[l for block in pg.get_text('dict')['blocks']for l in block.get('lines',[])];normal=[l['bbox'][1]for l in lines if l['bbox'][1]>y+2 and any(s['size']>11 for s in l['spans'])];cut=min(normal)if normal else pg.rect.height-45
 # In the body some examples use larger code; font identity is the boundary.
 codelines=[l for l in lines if l['bbox'][1]>=y-3 and any('SourceCodePro'in s['font']for s in l['spans'])];assert codelines;first=codelines[0];cluster=[first];last=first['bbox'][3]
 for l in codelines[1:]:
  if l['bbox'][1]-last>22:break
  cluster.append(l);last=l['bbox'][3]
 rect=fitz.Rect(cluster[0]['bbox'])
 for l in cluster[1:]:rect|=fitz.Rect(l['bbox'])
 rect.x0-=14;rect.y0-=3;rect.y1+=5;rect &=pg.rect;crop=f'crops/{ident}.png';ctx=f'contexts/page-{spec["page"]:04d}.png';pg.get_pixmap(matrix=fitz.Matrix(1.7,1.7),clip=(rect+(-8,-8,8,8))&pg.rect).save(b/crop)
 if not(b/ctx).exists():pg.get_pixmap(matrix=fitz.Matrix(.58,.58)).save(b/ctx)
 sp=f'sources/{ident}.txt';(b/sp).write_text(src['excerpt']);items.append(dict(id=ident,kind='uncaptioned-listing',type='uncaptioned-listing',title=spec['title'],caption='',purpose=spec['title'],occurrences=[dict(page=spec['page'],printedPage=pg.get_label(),bbox=list(rect),crop=crop,context=ctx)],source=src,sourceText=sp,pdfDestination=spec['pdfDestination'],geometryStatus='Exact PDF destination and contiguous SourceCodePro lines',reviewStatus='unreviewed',dataProvenance=dict(status='Exact source and shipped PDF destination bound',dataKind='code/log',citations=[],urls=[])))
for spec in json.loads(Path('.scratch/visual-atlas/verification/layer-macro-dependencies.json').read_text()):
 item=next(i for i in items if i['id']==spec['id']);item.setdefault('sourceDependencies',[]).append(spec['sourceDependency'])
for spec in json.loads(Path('.scratch/visual-atlas/verification/all-uncaptioned-diagram-source-map.json').read_text()):
 for ident in spec['ids']:
  item=next(i for i in items if i['id']==ident);item['source']=spec['source'];item['sourceMatchEvidence']=spec['matchEvidence'];item.setdefault('sourceDependencies',[]).extend(spec.get('sourceDependencies',[]));item['dataProvenance']['status']='Actual drawing and source labels/model matched; model not rerun during inventory review'
  if item.get('sourceText'):(b/item['sourceText']).write_text(spec['source']['excerpt'])
item=next(i for i in items if i['id']=='v00634');item['title']='Precautionary-lock welfare loss';item['purpose']='Analytic welfare loss L(rho)=1-(1-rho)^2 under precautionary locks; not a leak probability.'
for i in items:
 if 'caption'in i:i['caption']=re.sub(r'\\(?:ignorespaces|protect)\b\s*','',i['caption'])
a['coverage'].update(inventoryRecords=len(items),uncaptionedMainListingsAdded=5,uncaptionedDiagramComponentsSourceBound=28,layerMacroDependenciesAdded=2);(b/'atlas.json').write_text(json.dumps(a,indent=2)+'\n');print('inventory',len(items))
