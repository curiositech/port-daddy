import json
from pathlib import Path
import fitz
b=Path('.scratch/visual-atlas/inventory');a=json.load(open(b/'atlas.json'));doc=fitz.open(a['book']['path'])
for i in a['items']:
 if i['kind']!='uncaptioned-listing':continue
 dest=doc.resolve_names()[i['pdfDestination']];pg=doc[dest['page']];y=pg.rect.height-dest['to'][1];lines=[l for block in pg.get_text('dict')['blocks']for l in block.get('lines',[])];body=[l['bbox'][1]for l in lines if l['bbox'][1]>y+2 and any(s['size']>9 and 'SourceCodePro'not in s['font']for s in l['spans'])];cut=min(body)if body else pg.rect.height-45;code=[l for l in lines if y-3<=l['bbox'][1]<cut and any('SourceCodePro'in s['font']for s in l['spans'])];assert code,i['id'];rect=fitz.Rect(code[0]['bbox'])
 for l in code[1:]:rect|=fitz.Rect(l['bbox'])
 rect.x0-=14;rect.y0-=2;rect.y1+=4;rect &=pg.rect;i['occurrences'][0]['bbox']=list(rect);pg.get_pixmap(matrix=fitz.Matrix(1.7,1.7),clip=(rect+(-5,-5,5,5))&pg.rect).save(b/i['occurrences'][0]['crop'])
(b/'atlas.json').write_text(json.dumps(a,indent=2)+'\n');print('recropped16listings')
