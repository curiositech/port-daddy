"""Crop the named ladder plus its caption, retaining a full-page context link."""
import json
from pathlib import Path
import fitz
b=Path('.scratch/visual-atlas/inventory');a=json.loads((b/'atlas.json').read_text());i=next(i for i in a['items']if i['id']=='v00702');doc=fitz.open(a['book']['path']);pg=doc[398];rects=[fitz.Rect(x[:4])for x in pg.get_text('blocks')if x[0]>380 and 260<x[1]<525];rects += [d['rect']+(-.6,-.6,.6,.6)for d in pg.get_drawings()if d['rect'].x0>390 and 260<d['rect'].y0<410];assert len(rects)==10;rect=fitz.Rect(rects[0])
for r in rects[1:]:rect|=r
rect=rect+(-4,-4,4,4);rect &=pg.rect;i['occurrences'][0]['bbox']=list(rect);i['geometryStatus']='Actual layer labels, rule geometry and full adjoining caption; full page retained as context';pg.get_pixmap(matrix=fitz.Matrix(2.4,2.4),clip=(rect+(-3,-3,3,3))&pg.rect).save(b/i['occurrences'][0]['crop']);(b/'atlas.json').write_text(json.dumps(a,indent=2)+'\n');print('ladder bbox',list(rect))
