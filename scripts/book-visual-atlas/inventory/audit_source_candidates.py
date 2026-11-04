import json,re,hashlib
from pathlib import Path
b=Path('.scratch/visual-atlas/inventory');a=json.loads((b/'atlas.json').read_text());out=Path('.scratch/visual-atlas/verification');body=Path('.cache/whitepaper-build/coordination-papers-mega-volume/mega-volume-body.tex');text=body.read_text();lines=text.splitlines();stack=[];spans=[]
for line,t in enumerate(lines,1):
 m=re.search(r'% BEGIN INLINED ([^\s]+)',t)
 if m:stack.append((m[1],line))
 m=re.search(r'% END INLINED ([^\s]+)',t)
 if m and stack:
  name,start=stack.pop();spans.append((name,start,line))
upstream=[]
for i in a['items']:
 s=i.get('source')
 if not s or s['path']!=str(body):continue
 match=[x for x in spans if x[1]<=s['lineStart']<=x[2]]
 if not match:continue
 name,start,end=min(match,key=lambda v:v[2]-v[1]);rel=name if name.endswith('.tex')else name+'.tex';p=next((q for q in [Path('book')/rel,Path('book')/rel]if q.exists()),Path('book')/rel)
 upstream.append(dict(id=i['id'],generatedSource=s['path'],generatedLines=[s['lineStart'],s['lineEnd']],inliningMarker=name,originalPath=str(p),originalExists=p.exists(),originalSha256=hashlib.sha256(p.read_bytes()).hexdigest()if p.exists()else None,currentlyExplicitDependency=any(d['path']==str(p)for d in i.get('sourceDependencies',[])),status='Inlining-marker provenance; no claim of byte-identical source after generation'))
(out/'inlined-upstream-map.json').write_text(json.dumps(upstream,indent=2)+'\n')
# Compiled product sources include solution inputs absent from initial semantic census.
sourcepaths=[body,*Path('.cache/whitepaper-build/coordination-papers-mega-volume').glob('book-sol-*.tex'),Path('book/chapter-0-prerequisites.tex'),Path('book/coordination-papers-mega-volume-appendices.tex'),Path('book/figures/pd-margin-evidence.tex'),Path('book/figures/pd-margin-sketches.tex'),Path('book/figures/pd-swiss-evidence.tex')]
census=[]
for p in sourcepaths:
 t=p.read_text()
 for m in re.finditer(r'\\begin\{(tabular\*?|tabularx|longtable|xltabular|tikzpicture|axis|lstlisting|verbatim|pdsession)\}',t):
  end=t.find('\\end{'+m[1]+'}',m.end());end=end+len('\\end{'+m[1]+'}')if end>=0 else m.end();startline=t.count('\n',0,m.start())+1
  owners=[i['id']for i in a['items']if i.get('source')and i['source']['path']==str(p)and i['source']['lineStart']<=startline<=i['source']['lineEnd']]
  census.append(dict(path=str(p),line=startline,environment=m[1],sha256=hashlib.sha256(p.read_bytes()).hexdigest(),sourceExcerpt=t[m.start():end],directOwners=owners,qualification='Definition bodies and false conditional branches are candidates, not automatically shipped occurrences.'))
(out/'expanded-source-census.json').write_text(json.dumps(census,indent=2)+'\n')
macrofile=Path('book/figures/pd-margin-evidence.tex')
gaps=[dict(name='probation-capacity',source=str(macrofile),definitionLine=8,invocationPath=str(body),invocationLine=16527,pdfPage=432,kind='uncaptioned margin data table',evidence='PDF exact text Last period; source enumerates0/9,1/13.5,2/15.75,3/16.875,Infinite/18.',status='Absent independent inventory record'),dict(name='joint-misses',source=str(macrofile),definitionLine=25,invocationPath=str(body),invocationLine=23359,pdfPage=551,kind='uncaptioned margin data table',evidence='PDF exact text Panel A; source enumerates000/111,011/100,101/010,110/001 and1/4versus0.',status='Absent independent inventory record'),dict(name='bond-recipients',source=str(macrofile),definitionLine=48,invocationPath=str(body),invocationLine=28308,pdfPage=682,kind='data table attached to retained diagramv00689',evidence='PDF exact text Counterparty; source rowsCounterparty/$80 andReturnA/$20.',status='Diagram retained but its accompanying data table has no semantic/cell record')]
summary=dict(bookSha256=a['pdfSha256'],inventoryRecords=len(a['items']),captioned=263,rasterUnique=92,rasterOccurrences=113,vectorCandidates=346,knownExtras=dict(marginExhibit=1,standaloneUncaptionedTables=2),countEquation='263 + 92 + 346 + 1 + 2 = 704',coverageVerdict='Caption/raster/path accounting reconciles. Semantic completeness fails pending three named margin table additions and source-graph qualification.',namedGaps=gaps,inlinedOriginalDependenciesMissing=sum(not x['currentlyExplicitDependency']for x in upstream),inliningMaps=len(upstream),unrepresentedSolutionsCode=[dict(path=x['path'],line=x['line'])for x in census if '/book-sol-'in x['path']and x['environment']=='lstlisting'and not x['directOwners']],layerExamples=dict(SGStackLayers='v00024 Figure1.1',layerTable='v00120 Table4.1',SGMarginLadder='v00702 complete margin exhibit; v00507auditfragment',semanticFamily='layer-stack exists for all three; broad regex family membership elsewhere has not been semantically certified'),limitations=['No XeTeX recorder.fls exists in frozen build; source graph is reconstructed from explicit wrapper inputs and solution input list, not claimed exact execution trace.','Generated mega-body snippet provenance does not prove original author-source dependency completeness. Inlining marker map supplies current explicit omissions.','Source environment candidates can be unexecuted definitions or false branches; actual PDF occurrence is required before treating them as shipped.','Eleven unnumbered solution code/log listings are not independent caption records; audit lists exact paths/lines. They may be intentionally excluded as code, but cannot be called a complete listing inventory.'])
(out/'coverage-verdict.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps({k:v for k,v in summary.items()if k not in ['namedGaps','limitations','unrepresentedSolutionsCode']},indent=2))
