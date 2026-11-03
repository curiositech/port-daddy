import json,re,hashlib,sys
from pathlib import Path
import fitz
sys.path.insert(0,'scripts');from book_visual_atlas_inventory import plain,source_record
b=Path('.scratch/visual-atlas/inventory');a=json.loads((b/'atlas.json').read_text());p=Path('.cache/whitepaper-build/coordination-papers-mega-volume/mega-volume-body.tex');text=p.read_text();listings=[]
norm=lambda v:re.sub('[^a-z0-9]','',plain(v).lower())
for m in re.finditer(r'\\begin\{lstlisting\}',text):
 end=text.find('\\end{lstlisting}',m.end())+len('\\end{lstlisting}');raw=text[m.start():end];cm=re.search(r'caption\s*=\s*\{',raw)
 if not cm:continue
 depth=1;start=cm.end();j=start
 while j<len(raw) and depth:
  if raw[j]=='{':depth+=1
  elif raw[j]=='}':depth-=1
  j+=1
 cap=raw[start:j-1];listings.append((norm(cap),source_record(p,text,m.start(),end),cap))
for m in re.finditer(r'\\begin\{pdsession\}\[([^\n]+)\]',text):
 end=text.find('\\end{pdsession}',m.end())+len('\\end{pdsession}');listings.append((norm(m[1]),source_record(p,text,m.start(),end),m[1]))
for i in a['items']:
 if i['kind']!='listing':continue
 cap=norm(i['caption']);labels=i['captionRecord']['labels'];matches=[s for n,s,c in listings if n==cap or any(('label={'+l+'}')in s['excerpt'] for l in labels)]
 if len(matches)==1:
  i['source']=matches[0];i['dataProvenance']['status']='exact listing caption or label match';(b/i['sourceText']).write_text(i['source']['excerpt'])
 else:print('unmatched',i['id'],i['caption'],[(c[:70])for n,s,c in listings if n[:30]==cap[:30]])
item=next(i for i in a['items'] if i['id']=='v00160');pos=text.find('\\pdwrapanalogy[r][0.42\\textwidth]{stp-splice-continuity}');end=text.find('\n',pos);item['source']=source_record(p,text,pos,end)
doc=fitz.open(a['book']['path'])
for ids in [[311,312],[515,516,517],[554,555,556],[574,575]]:
 group=[next(i for i in a['items']if i['id']==f'v{n:05d}')for n in ids];box=fitz.Rect(group[0]['occurrences'][0]['bbox'])
 for i in group[1:]:box|=fitz.Rect(i['occurrences'][0]['bbox'])
 pg=doc[group[0]['occurrences'][0]['page']-1];crop=f'crops/{group[0]["id"]}-complete-group.png';pg.get_pixmap(matrix=fitz.Matrix(1.7,1.7),clip=(box+(-15,-15,15,15))&pg.rect).save(b/crop)
 for i in group:i['familyGroup']=group[0]['id'];i['groupMemberIds']=[j['id']for j in group];i['groupCrop']=crop
(b/'atlas.json').write_text(json.dumps(a,indent=2)+'\n');print('listings source bound',sum(bool(i.get('source'))for i in a['items']if i['kind']=='listing'))
