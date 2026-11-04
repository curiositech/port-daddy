#!/usr/bin/env python3
"""Build the offline visual atlas with validated reviews and portable source snapshots."""
import argparse,copy,hashlib,json,os,pathlib,shutil

def records(value):
    if isinstance(value,list): return value
    for key in ('reviews','records','items'):
        if key in value:return records(value[key])
    if isinstance(value,dict):return [dict(v,id=v.get('id',k)) for k,v in value.items() if isinstance(v,dict)]
    raise ValueError('Review file must contain records')

FAMILIES={
 'Layer systems':['layer-stack','stack-layer-navigation'],
 'Decision flows':['decision-flow','boundary-gate','agent-control-loop','recovery-decision-flow','evidence-admission-gate','authority-release-flow','recovery-pipeline','dependency-pipeline'],
 'State machines':['state-machine','paired-state-transition'],
 'Message sequences':['message-sequence','paired-message-sequence','protocol-sequence'],
 'Timelines and concurrency':['concurrency-timeline','paired-timeline','timeline-sequence','failure-comparison','paired-failure-path','stateful-trace'],
 'Evidence and dependency graphs':['evidence-provenance','identity-continuity','observation-graph','preference-cycle','information-loading-tree','authority-provenance','dependency-graph','signature-binding-graph','assurance-dependency','provenance-certificate','graph-counterexample'],
 'Authority and containment':['authority-attenuation','paired-security-boundary','paired-security-trace','trust-boundary'],
 'Comparison matrices':['classification-matrix','speech-act-matrix','paired-data-transformation','paired-observation-trace','paired-guarantee-comparison','evidence-matrix','security-phase-matrix','comparison-matrix','reading-route-table','glossary-reference'],
 'Specification ledgers':['specification-ledger','evidence-manifest'],
 'Numerical result tables':['numerical-results'],
 'Quantitative plots':['numeric-line-chart','qualitative-regime-chart','mixed-evidence-chart','numeric-comparison'],
 'Margin plots':['analytic-sparkline','regime-boundary','numeric-small-multiples','stacked-bar-comparison'],
 'Allocation and accounting':['accounting-flow','information-channel-flow','allocation-tree','payoff-allocation'],
 'Concept illustrations':['concept-illustration','editorial-object-analogy'],
 'Portraits':['historical-reference'],
 'Editorial plates':['geometric-editorial-art'],
 'Chapter panels':['chapter-title-panel','chapter-title-art'],
 'Code and proof exhibits':['formal-model','formal-model-sketch','verification-transcript','algorithm-pseudocode','ffi-interface','terminal-transcript','implementation-excerpt','proof-harness','formal-query-sketch','command-example','query-example','schema-example','solver-output']}
ALIASES={alias:family for family,aliases in FAMILIES.items() for alias in aliases}
DIMENSIONS=['typography','composition','color_contrast','consistency_economy','purpose_fitness','encoding_relations','completeness_uncertainty','caption_context']

def build(inventory,output,review_paths,screening=None,source_root=None):
    data=json.loads(inventory.read_text());base=inventory.resolve().parent;out=output.resolve();repo=(source_root or pathlib.Path.cwd()).resolve();out.mkdir(parents=True,exist_ok=True)
    items={str(i['id']):i for i in data['items']};seen=set()
    if len(items)!=len(data['items']):raise ValueError('Duplicate inventory ID')
    if screening:
        for r in records(json.loads(screening.read_text())):
            item=items[r['id']]
            if r.get('excluded'):
                item['excludedFromRanking']=True;item['exclusionReason']=r.get('rationale','Screened non-exhibit fragment')
            if r.get('parent'):item['parentId']=r['parent']
    for path in review_paths:
        for r in records(json.loads(path.read_text())):
            ident=str(r['id'])
            if ident not in items:raise ValueError('Review ID absent from inventory: '+ident)
            if ident in seen:raise ValueError('Two reviews would silently overwrite '+ident)
            seen.add(ident);item=items[ident];item['evaluation']=copy.deepcopy(r)
            ev=item['evaluation']
            if 'provenanceReview' in ev and 'provenance' not in ev:ev['provenance']=copy.deepcopy(ev['provenanceReview'])
            if r.get('scores'):
                if any(k not in r['scores'] or not isinstance(r['scores'][k],(int,float)) or not 0<=r['scores'][k]<=5 for k in DIMENSIONS):raise ValueError('Invalid rubric scores '+ident)
                craft=sum(r['scores'][k] for k in DIMENSIONS[:4])*5;info=sum(r['scores'][k] for k in DIMENSIONS[4:])*5
                for key,value in [('craft',craft),('information',info),('composite',(craft+info)/2)]:
                    if abs(r.get(key,value)-value)>.001:raise ValueError('Score arithmetic disagrees '+ident+' '+key)
                    ev[key]=value
            for field in ('purpose','title'):
                if r.get(field):item[field]=r[field]
            if r.get('type'):
                item['subtype']=r.get('subtype',r['type']);item['type']=ALIASES.get(r['type'],r['type'])
            parent=r.get('componentOf') or r.get('rank_with_parent_id')
            if r.get('rankEligible') is False or parent or r.get('excluded_from_ranking'):
                item['excludedFromRanking']=True;item['parentId']=parent;item['exclusionReason']=r.get('exclusionReason') or 'Component or repeated asset; judged with '+str(parent or 'its parent exhibit')
            if ev.get('status')!='inspected':
                ev['craft']=None;ev['information']=None;ev['composite']=None
    # These three actual objects are the operator's shared four-layer concept.
    for ident in ['v00024','v00120','v00702']:
        if ident in items:
            items[ident]['type']='Layer systems';items[ident]['relatedFamily']='four-layer-system'
    # Retain original chapter/section text but offer actual chapter-level filtering.
    chapter_starts=[(26,0),(88,1),(184,2),(240,3),(290,4),(398,5),(488,6),(558,7),(644,8),(714,9)]
    for item in data['items']:
        page=item['occurrences'][0]['page'];item['sectionContext']=item.get('chapter')
        number=max((n for p,n in chapter_starts if p<=page),default=-1)
        item['chapter']='Front matter' if number<0 else ('Back matter and solutions' if number==9 else 'Chapter '+str(number))
        if item.get('excludedFromRanking') and not item.get('evaluation'):item['type']='Excluded page furniture'
        if item.get('kind')=='raster-art' and not item.get('source'):
            assets=item.get('sourceAssets',[])
            if assets and isinstance(assets[0],dict):item['source']=copy.deepcopy(assets[0])
    snapshots={};missing=[]
    def localfile(value):
        if not isinstance(value,str) or not value or '://' in value or value.startswith('data:'):return value
        candidate=pathlib.Path(value);candidate=candidate if candidate.is_absolute() else repo/candidate
        if not candidate.is_file():return value
        candidate=candidate.resolve()
        try:relative=candidate.relative_to(repo)
        except ValueError:return candidate.as_uri()
        # Source evidence only; neither crawl the repository nor export unrelated secrets.
        if relative.parts[0] not in ('book','website-v2','scripts','skills','docs','proofs','analyses','.cache'):return candidate.as_uri()
        dest=out/'source-files'/relative;dest.parent.mkdir(parents=True,exist_ok=True)
        if str(candidate) not in snapshots:
            shutil.copyfile(candidate,dest);snapshots[str(candidate)]={'originalPath':str(relative),'snapshot':str(dest.relative_to(out)),'sha256':hashlib.sha256(candidate.read_bytes()).hexdigest()}
        return str(dest.relative_to(out))
    def path_metadata(value):
        if isinstance(value,list):return [path_metadata(v) for v in value]
        if isinstance(value,dict):
            ans={k:path_metadata(v) for k,v in value.items()}
            for k in ('path','file','sourcePath','sidecar','licensePath'):
                if isinstance(value.get(k),str):ans['original'+k[0].upper()+k[1:]]=value[k];ans[k]=localfile(value[k])
            for k in ('scripts','data_paths','source_paths','upstream','sidecars'):
                if isinstance(value.get(k),list):ans[k]=[localfile(v) if isinstance(v,str) else path_metadata(v) for v in value[k]]
            return ans
        return value
    def imagepath(value):
        if not value:return value
        candidate=pathlib.Path(value);candidate=candidate if candidate.is_absolute() else base/candidate
        if not candidate.is_file():missing.append(str(candidate));return value
        return os.path.relpath(candidate,out)
    for item in data['items']:
        for key in ('preview','sourceText','groupPreview'):
            if item.get(key):item[key]=imagepath(item[key])
        for occ in item.get('occurrences',[]):
            for key in ('crop','context'):
                if occ.get(key):occ[key]=imagepath(occ[key])
        for key in ('source','sourceDependencies','sourceAssets'):
            if item.get(key):item[key]=path_metadata(item[key])
        ev=item.get('evaluation',{})
        if ev.get('provenance'):ev['provenance']=path_metadata(ev['provenance'])
        if not item.get('title') or item['title'].startswith(('Uncaptioned vector','Raster art')):
            if ev.get('purpose'):item['title']=item['id']+' · '+ev['purpose']
    if missing:raise ValueError('Missing preview/source text assets: '+str(missing[:8]))
    active=[i for i in data['items'] if not i.get('excludedFromRanking')]
    unreviewed=[i['id'] for i in active if not i.get('evaluation',{}).get('scores')]
    data['reviewSummary']={'inventoryRecords':len(items),'reviewedRecords':len(seen),'rankedObjects':len(active),'excludedRecords':len(items)-len(active),'unreviewedRankedIds':unreviewed,'sourceSnapshots':len(snapshots)}
    data['initialFamily']='Layer systems';data['sourceCommit']='924869333220cb3d9a33d75accce8e6a67e3e2aa'
    here=pathlib.Path(__file__).resolve().parent
    for name in ('index.html','atlas.css','atlas.js'):shutil.copyfile(here/name,out/name)
    (out/'atlas-data.js').write_text('window.ATLAS_DATA = '+json.dumps(data,ensure_ascii=False).replace('<','\\u003c')+';\n')
    (out/'atlas-data.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    (out/'source-manifest.json').write_text(json.dumps(list(snapshots.values()),indent=2)+'\n')
    (out/'review-summary.json').write_text(json.dumps(data['reviewSummary'],indent=2)+'\n')
    print(json.dumps(data['reviewSummary']));print(out/'index.html')
    return data

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('inventory',type=pathlib.Path);p.add_argument('--output',type=pathlib.Path,required=True);p.add_argument('--reviews',type=pathlib.Path,nargs='*',default=[]);p.add_argument('--screening',type=pathlib.Path);p.add_argument('--source-root',type=pathlib.Path)
    a=p.parse_args();build(a.inventory,a.output,a.reviews,a.screening,a.source_root)
