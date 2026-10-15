import json,hashlib,re,sys
from pathlib import Path
import fitz
base=Path('.scratch/visual-atlas/inventory');p=json.load(open(base/'atlas.json'));doc=fitz.open(p['book']['path']);items=p['items'];lookup={i['id']:i for i in items}
true={311:'WAL commit and sync timeline',312:'WAL timing bracket',329:'Possible sampling pulses',365:'Gossip convergence sketch',410:'Canary detection power',413:'Sequential likelihood-ratio trace',414:'Canary operating curve',435:'Consent admissibility region',451:'Survival comparison',458:'Escalation threshold',515:'Parent reputation split',516:'Reputation outcome A',517:'Reputation outcome B',554:'Auditor tower C=8',555:'Auditor tower C=2',556:'Auditor tower C=1',574:'Naive succession allocation',575:'Corrected succession allocation',588:'Partial settlement ledger',634:'Leak probability curve',640:'Discount threshold curve',676:'Consistency radius curve',689:'Escrow payout split',692:'Card epoch and policy clocks',697:'Two-source contradiction certificate',698:'Path offsets counterexample',699:'Unsynced WAL vulnerability window',700:'Two-agent SQL admission sequence',701:'Continuity evidence pipeline'}
banners={286,304,345,383,422,505,565,622,655};wrappers={267,302,303,420,421,503,504,563,564};records=[]
for i in items:
 if i['kind']!='vector-candidate':continue
 n=int(i['id'][1:]);rec={'id':i['id'],'evidence':'Visually inspected actual crop on all18vector contact sheets; every occurrence retained in atlas.'}
 if n in true:
  i['title']=true[n];i['type']='uncaptioned-table' if n==588 else 'margin-chart-or-diagram';i['rankingEligibility']='include';rec.update(type=i['type'],purpose=true[n],score=6,verdict='revise',rationale='Rendered marks convey the named comparison; source/data lineage and legibility at actual margin size require verification. Small component crop is incomplete when it belongs to a larger panel.',nextAction='Inspect full page, recover source, label assumptions and combine adjacent components before final design approval.')
 elif n in banners:
  i['type']='chapter-title-art';i['relatedFamily']='chapter-title-panels';i['rankingEligibility']='include';rec.update(type=i['type'],score=7,verdict='retain',rationale='Large chapter numerals and restrained part color establish a consistent opening rhythm. This is navigation art and carries no quantitative evidence.',nextAction='Review the family once with all9chapter-opening occurrences.')
 elif n==507:
  i['type']='duplicate-vector-fragment';i['parentItemId']='v00702';i['rankingEligibility']='exclude';rec.update(excluded=True,rationale='Layer-ladder component is retained by complete margin exhibit v00702.')
 elif n in wrappers:
  i['type']='page-layout-wrapper';i['rankingEligibility']='exclude';rec.update(excluded=True,rationale='Vector page furniture surrounding independently inventoried raster art; part-spread layout occurrence remains auditable.')
 else:
  i['type']='text-callout-frame';i['rankingEligibility']='exclude';rec.update(excluded=True,rationale='Visually inspected prose, theorem/example/invariant/protocol frame, quotation rule or text-page furniture; not an independent illustration.')
 i['screening']=rec;records.append(rec)
# Capture the three uncaptions tables proven to ship; the first already has a crop.
census=json.load(open(base/'environment-census.json'))
for line,page,title,existing in [(20111,503,'Partial settlement ledger','v00588'),(20156,504,'Leasing control rights and exposure',None),(20678,513,'Successful multi-party settlement ledger',None)]:
 e=next(e for e in census if e['source']['path'].endswith('mega-volume-body.tex') and e['source']['lineStart']==line);s=e['source']
 if existing:i=lookup[existing]
 else:
  ident=f'v{len(items)+1:05d}';pg=doc[page-1];cp=f'crops/{ident}.png';ctx=f'contexts/page-{page:04d}.png';pg.get_pixmap(matrix=fitz.Matrix(1.1,1.1)).save(base/cp)
  if not(base/ctx).exists():pg.get_pixmap(matrix=fitz.Matrix(.58,.58)).save(base/ctx)
  i=dict(id=ident,kind='uncaptioned-table',type='uncaptioned-table',title=title,caption='',purpose=title,chapter='The Harbor Economy',occurrences=[dict(page=page,printedPage=pg.get_label(),bbox=list(pg.rect),crop=cp,context=ctx)],reviewStatus='unreviewed');items.append(i)
 i['source']=s;i['title']=title;i['dataProvenance']=dict(status='Exact source table captured; illustrative arithmetic and conceptual allocation, not measured field data',dataKind='illustrative' if line!=20156 else 'conceptual',exactTableData=s['excerpt'],tableRowsTex=[r.strip().split(' & ') for r in re.split(r'\\\\',s['excerpt']) if '&'in r],citations=[],urls=[])
# Visual review is family based, independent from source availability.
portraits={288,289,298,306,319,344,415,423,436,466,511,612,623,624,632,637}
illustrations={290,309,314,315,330,347,353,356,359,382,389,395,396,403,424,440,464,474,479,497,512,521,522,529,535,566,569,572,579,581,638,645,647,649,656,666,669,693,695}
for i in items:
 if i['kind']!='raster-art':continue
 n=int(i['id'][1:]);typ='portrait-or-historical-reference' if n in portraits else 'object-analogy-illustration' if n in illustrations else 'cover-or-chapter-art';i['type']=typ
 score=5 if n in {319,424,632} else 6 if typ=='object-analogy-illustration' else 7
 reason=('Photographic/historical credit supports attribution, but scale and tonal quality vary; inspect the full source licence and actual printed size.' if typ=='portrait-or-historical-reference' else 'The object analogy has a coherent limited palette and distinct silhouette. It introduces no measured evidence; the adjacent prose must earn its space.' if typ=='object-analogy-illustration' else 'Consistent geometric grid, photographic texture and part color provide a deliberate visual family; repeated black slabs and narrow slivers deserve an editorial economy pass.')
 records.append(dict(id=i['id'],type=typ,score=score,verdict='revise' if score<7 else 'retain',rationale=reason,nextAction='Verify matched asset provenance and examine full-size occurrence; these family-level contact-sheet scores are provisional.',evidence='Visually inspected all6raster contact sheets; repeated assets share one family judgment with all occurrences retained.'))
p['coverage']['uncaptionedTablesSourceVerified']=3;p['coverage']['vectorScreened']=346;p['coverage']['vectorTrueVisualComponents']=len(true);p['coverage']['sourceAssetsMatched']=sum(bool(i.get('sourceAssets')) for i in items if i['kind']=='raster-art')
(base/'atlas.json').write_text(json.dumps(p,indent=2)+'\n');(base/'visual-screening.json').write_text(json.dumps({'records':records,'scope':'Visual screening and provisional family judgments; no final publication approval.'},indent=2)+'\n')
print('items',len(items),'records',len(records))
