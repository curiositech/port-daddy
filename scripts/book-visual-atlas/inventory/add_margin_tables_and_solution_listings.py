import json,re,hashlib,sys
from pathlib import Path
import fitz
sys.path.insert(0,'scripts');from book_visual_atlas_inventory import source_record
b=Path('.scratch/visual-atlas/inventory');a=json.loads((b/'atlas.json').read_text());doc=fitz.open(a['book']['path']);items=a['items'];assert len(items)==704
# Restore literal mathematical caption source before making any display rendering.
aux=Path('.cache/whitepaper-build/coordination-papers-mega-volume/coordination-papers-mega-volume.aux').read_text()
sys.path.insert(0,'scripts/harbor-research');from export_book_type_review import tex_groups
rawcaps={}
for line in aux.splitlines():
 if not line.startswith('\\@writefile'):continue
 outer=tex_groups(line)
 if len(outer)<2:continue
 fields=tex_groups(outer[1])
 if len(fields)<4:continue
 parts=tex_groups(fields[1])
 if len(parts)>1:rawcaps[fields[3]]=parts[1]
for i in items:
 if 'captionRecord'not in i:continue
 raw=rawcaps.get(i['captionRecord']['destination'])
 if raw is None:continue
 i['captionTex']=raw
 # Only presentation macros are removed; unknown math commands stay literal.
 display=re.sub(r'\\(?:textbf|textit|emph|texttt|textrm|textsf|mathrm|mathbf|mathit)\s*\{', '{',raw)
 for tex,unicode in [('delta','δ'),('epsilon','ε'),('varepsilon','ε'),('alpha','α'),('beta','β'),('gamma','γ'),('theta','θ'),('lambda','λ'),('rho','ρ'),('sigma','σ'),('tau','τ'),('mu','μ'),('pi','π')]:display=re.sub(r'\\'+tex+r'\b',unicode,display)
 i['caption']=display.replace('{','').replace('}','')
# Current original-source mappings are evidence dependencies, not byte equality claims.
for entry in json.loads(Path('.scratch/visual-atlas/verification/inlined-upstream-map.json').read_text()):
 i=next(i for i in items if i['id']==entry['id']);p=Path(entry['originalPath']);dep=source_record(p,p.read_text(),0,len(p.read_text()));dep['relationship']='Original fragment named by generated BEGIN INLINED marker; generator transformations not replayed';i.setdefault('sourceDependencies',[]).append(dep)
macro=Path('book/figures/pd-margin-evidence.tex');text=macro.read_text();body=Path('.cache/whitepaper-build/coordination-papers-mega-volume/mega-volume-body.tex');bodytext=body.read_text()
def emit(kind,title,page,rect,source,extra):
 ident=f'v{len(items)+1:05d}';pg=doc[page-1];rect=fitz.Rect(rect)&pg.rect;crop=f'crops/{ident}.png';context=f'contexts/page-{page:04d}.png';pg.get_pixmap(matrix=fitz.Matrix(1.7,1.7),clip=(rect+(-8,-8,8,8))&pg.rect).save(b/crop)
 if not(b/context).exists():pg.get_pixmap(matrix=fitz.Matrix(.58,.58)).save(b/context)
 sp=f'sources/{ident}.txt';(b/sp).write_text(source['excerpt']);item=dict(id=ident,kind=kind,type=kind,title=title,caption='',purpose=title,chapter='Backmatter solutions'if'book-sol-'in source['path']else None,occurrences=[dict(page=page,printedPage=pg.get_label(),bbox=list(rect),crop=crop,context=context)],source=source,sourceText=sp,reviewStatus='unreviewed',dataProvenance=dict(status='Exact source and shipped PDF occurrence located',dataKind='analytic'if kind=='uncaptioned-table'else'code/log',exactTableData=source['excerpt']if kind=='uncaptioned-table'else None,citations=[],urls=[]));item.update(extra);items.append(item);return item
for name,page,title,box,invline,datakind in [('pdprobationcapacity',432,'Probation capacity by final period',(12,516,110,602),16527,'analytic'),('pdpairwisecounterexample',551,'Equal pairwise correlations with unequal joint miss risk',(394,480,493,556),23359,'analytic'),('pdbondrecipientexample',682,'Recipient ledger after complete bond clearance',(12,547,110,576),28308,'illustrative')]:
 start=text.index('\\newcommand{\\'+name+'}');nextdef=text.find('\\newcommand',start+12);end=nextdef if nextdef>=0 else len(text);src=source_record(macro,text,start,end);invstart=sum(len(x)+1 for x in bodytext.splitlines()[:invline-1]);inv=source_record(body,bodytext,invstart,bodytext.find('\n',invstart));extra=dict(sourceDependencies=[inv],dataProvenance=dict(status='Exact source cells and shipped PDF table verified; values are analytic/illustrative, not field observations',dataKind=datakind,exactTableData=src['excerpt'],tableRowsTex=[r.strip().split('&')for r in re.split(r'\\\\',src['excerpt'])if'&'in r],citations=[],urls=[]))
 if name=='pdbondrecipientexample':extra.update(familyGroup='bond-recipients',groupMemberIds=['v00689','v00707'])
 emit('uncaptioned-table',title,page,box,src,extra)
# Eleven active uncaptioned solution listings have explicit PDF destinations.
entries=[]
for p in sorted(Path('.cache/whitepaper-build/coordination-papers-mega-volume').glob('book-sol-*.tex')):
 text=p.read_text();chapter=p.stem.split('-')[-1];dests=sorted([(int(k.rsplit('.',1)[1]),k,v)for k,v in doc.resolve_names().items()if k.startswith('lstlisting.solution.'+chapter+'.')],reverse=True)
 matches=list(re.finditer(r'\\begin\{lstlisting\}',text));assert len(dests)==len(matches),(p,len(dests),len(matches))
 for m,(_,name,dest)in zip(matches,dests):
  end=text.find('\\end{lstlisting}',m.end())+len('\\end{lstlisting}');entries.append((dest['page']+1,doc[dest['page']].rect.height-dest['to'][1],name,p,text,m.start(),end))
for page,y,name,p,text,start,end in sorted(entries):
 pg=doc[page-1];lines=[l for block in pg.get_text('dict')['blocks']for l in block.get('lines',[])];normal=[l['bbox'][1]for l in lines if l['bbox'][1]>y+2 and any(s['size']>9 for s in l['spans'])];cut=min(normal)if normal else pg.rect.height-45
 code=[l for l in lines if y-3<=l['bbox'][1]<cut and any('SourceCodePro'in s['font']for s in l['spans'])];assert code,(name,y,cut)
 rect=fitz.Rect(code[0]['bbox'])
 for l in code[1:]:rect|=fitz.Rect(l['bbox'])
 rect.x0-=14;rect.y0-=3;rect.y1+=8
 src=source_record(p,text,start,end);body=src['excerpt'].split('\n',1)[1].split('\\end{lstlisting}')[0].strip();emit('uncaptioned-listing','Solution log: '+body.splitlines()[0][:100],page,rect,src,dict(pdfDestination=name,geometryStatus='Explicit shipped listing anchor; SourceCodePro text extent stops at following body prose',sourceMatchStatus='Source order matched within chapter against all explicit listing.solution destinations'))
a['coverage'].update(uncaptionedMarginTablesAdded=3,uncaptionedSolutionListingsAdded=11,explicitOriginalDependenciesAdded=135,captionTexPreserved=len(rawcaps),inventoryRecords=len(items));(b/'atlas.json').write_text(json.dumps(a,indent=2)+'\n');print('records',len(items))
