#!/usr/bin/env python3
"""Canonical research work ledger, source retention, and deterministic projection.

The ZIP is immutable evidence, including PDF graphics and exact source bytes.
The JSON holds current work records and searchable document text. Markdown is
only a generated view. Retiring a document requires byte-for-byte ZIP verification.
"""
from __future__ import annotations
import argparse
import fnmatch
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'docs/harbor-research'
DATA = BASE / 'omni-ledger.json'
ARCHIVE = BASE / 'omni-sources.zip'
VIEW = BASE / 'OMNI-LEDGER.md'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load():
    return json.loads(DATA.read_text())


def save(data):
    DATA.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def relative(path):
    p = Path(path)
    if p.is_absolute():
        p = p.relative_to(ROOT)
    if '..' in p.parts:
        raise ValueError('Source path must stay inside the repository')
    return p.as_posix()


@lru_cache(maxsize=1)
def _source_map(path, mtime, size):
    return {s['path']: s for s in json.loads(Path(path).read_text())['sources']}


def source_for(path, data=None):
    key = relative(path)
    if data is not None:
        return next((s for s in data['sources'] if s['path'] == key), None)
    stat = DATA.stat()
    return _source_map(str(DATA), stat.st_mtime_ns, stat.st_size).get(key)


def document_text(path):
    """Read a retired document from its canonical ledger document record."""
    key = relative(path)
    source = source_for(key)
    if source and source['disposition'] in {'retire', 'import'}:
        return source['text']
    return (ROOT / key).read_text(encoding='utf-8')


def document_exists(path):
    key = relative(path)
    source = source_for(key)
    return (ROOT / key).is_file() or bool(source and source['disposition'] in {'retire', 'import'})


def document_glob(pattern):
    keys = {relative(p) for p in ROOT.glob(pattern) if p.is_file()}
    keys.update(s['path'] for s in load()['sources'] if fnmatch.fnmatchcase(s['path'], pattern))
    return sorted(keys)


def update_document(path, text):
    """Update a live ledger document; the captured original remains immutable."""
    data = load()
    source = source_for(path, data)
    if not source or source['disposition'] != 'retire':
        raise ValueError('Only consolidated documents are writable through this API')
    source['text'] = text
    source['text_sha256'] = digest(text.encode())
    save(data)
    render(data)


def capture():
    if DATA.exists() or ARCHIVE.exists():
        raise ValueError('Capture already exists; refusing to overwrite provenance')
    tracked = subprocess.check_output(['git', 'ls-files'], cwd=ROOT, text=True).splitlines()
    paths = set()
    for name in tracked:
        p = Path(name)
        if p.suffix.lower() not in {'.md', '.pdf'}:
            continue
        if name.startswith(('docs/harbor-research/', 'skills/harbor-results/',
                            'skills/harbor-exposition/', 'skills/falsification-first/', 'studies/')):
            paths.add(name)
    paths.add('docs/roadmap/whitepaper-research-program.md')
    # Include local build PDFs as explicitly untracked evidence, never as paper replacements.
    paths.update(relative(p) for p in (BASE / 'build').rglob('*.pdf'))
    sources = []
    import fitz  # extraction only; subsequent checks and reads use the standard library
    with zipfile.ZipFile(ARCHIVE, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for index, name in enumerate(sorted(paths), 1):
            p = ROOT / name
            raw = p.read_bytes()
            ident = f'SRC-{index:03d}'
            paper = p.suffix == '.pdf' and p.stem in {f'paper{i}' for i in range(1, 9)} and p.parent == BASE / 'pdf'
            retire = name.startswith('docs/harbor-research/') and not paper
            retire = retire or name == 'docs/roadmap/whitepaper-research-program.md'
            pages = []
            if p.suffix == '.pdf':
                with fitz.open(stream=raw, filetype='pdf') as pdf:
                    pages = [page.get_text(sort=True) for page in pdf]
                text = '\n\n'.join(f'PAGE {i}\n{t}' for i,t in enumerate(pages,1))
            else:
                text = raw.decode('utf-8')
            info = zipfile.ZipInfo(name, date_time=(2026,9,30,0,0,0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
            sources.append(dict(id=ident,path=name,sha256=digest(raw),bytes=len(raw),
                disposition='retire' if retire else 'retain',
                reason='Consolidated supporting document' if retire else 'Paper publication or executable skill/study contract',
                tracked=name in tracked,pages=len(pages),text=text,text_sha256=digest(text.encode())))
    data = dict(version=1, authority='Operator-authorized canonical Harbor research work ledger, 2026-09-30',
        scope='Harbor research Markdown/PDF corpus, research skills, study protocols, and designated research roadmap. Paper manuscripts and eight publication PDFs remain live.',
        captured_head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        archive_sha256=digest(ARCHIVE.read_bytes()),sources=sources,records=[],
        coverage={},decisions=[],retirement_complete=False)
    save(data)
    print(f'Captured {len(sources)} sources; {sum(s["disposition"]=="retire" for s in sources)} retirement candidates; originals retained in {ARCHIVE.relative_to(ROOT)}')


def cell(value):
    if isinstance(value, (dict,list)):
        value = json.dumps(value, ensure_ascii=False)
    return str(value).replace('|','\\|').replace('\n',' ')


def render_text(data=None):
    data = data or load()
    out = ['# Omni ledger: Harbor research', '',
        'The single work ledger for the research program. Edit `omni-ledger.json`; this document is generated.', '',
        'A source-reported proof, run, or completion is not a fresh verification. Current records preserve assumptions, open acceptance conditions, and evidence separately. The roadmap registry remains the repository scheduling authority; this ledger does not start jobs or authorize spend.', '',
        '## Work and evidence', '',
        '| ID | Work | Papers | Status | Next action |', '|---|---|---|---|---|']
    visible = [r for r in data['records'] if r.get('queue_state') != 'archive_source_assertion']
    visible.sort(key=lambda r: (r.get('queue_state') != 'current_work', r.get('priority', 'P2'), r['id']))
    for r in visible:
        out.append(f'| [{r["id"]}](#work-{r["id"].lower()}) | {cell(r["title"])} | {cell(r.get("papers",[]))} | {cell(r["status"])} | {cell(r.get("next",""))} |')
    out += ['', '## Authority and decisions', '']
    out += ['- '+d for d in data['decisions']]
    out += ['', '## Record details', '']
    for r in visible:
        out += [f'<a id="work-{r["id"].lower()}"></a>', f'### {r["id"]}: {r["title"]}', '',
                f'**Status:** {r["status"]}. **Kind:** {r.get("kind","work")}.', '']
        for key,label in [('result','Result or question'),('assumptions','Assumptions'),('evidence','Evidence'),('next','Next action'),('acceptance','Completion condition'),('depends_on','Dependencies')]:
            value = r.get(key)
            if value:
                if isinstance(value,list): value='; '.join(cell(x) for x in value)
                out += [f'**{label}:** {value}', '']
        refs=[]
        for s in r.get('sources',[]):
            source=source_for(s['path'],data)
            target=f'#source-{source["id"].lower()}' if source else os.path.relpath(ROOT / s['path'], BASE)
            refs.append(f'[{s["path"]}]({target}) — {s.get("locator","")}')
        out += ['**Sources:** '+'; '.join(refs), '']
    out += ['## Source coverage', '',
        f'{len(data["sources"])} source documents. Exact original bytes, including PDF figures, are retained in [omni-sources.zip](omni-sources.zip). Text below is provenance, not a competing task list. No source claim becomes certified by being imported.', '',
        '| ID | Source | Disposition | Pages | SHA-256 |', '|---|---|---|---|---|']
    for s in data['sources']:
        out.append(f'| [{s["id"]}](#source-{s["id"].lower()}) | {cell(s["path"])} | {s["disposition"]} | {s["pages"] or "—"} | `{s["sha256"]}` |')
    archival = [r for r in data['records'] if r.get('queue_state') == 'archive_source_assertion']
    out += ['', '## Imported adjudications and section records', '', f'{len(archival)} source assertions remain individually addressable by ID in [the canonical JSON ledger](omni-ledger.json). Their complete text, original statuses, locators and rationale are preserved; they are not automatically current work.', '', '## Source documents', '']
    for s in data['sources']:
        out += [f'<a id="source-{s["id"].lower()}"></a>', f'### {s["id"]}: {s["path"]}', '',
                f'**Disposition:** {s["disposition"]}. **Original SHA-256:** `{s["sha256"]}`. **Pages:** {s["pages"] or "not a PDF"}.', '',
                f'Exact original bytes: member `{s["path"]}` in [the source archive](omni-sources.zip). <!-- cite-exempt: archive member identity, verified against the ZIP by the ledger checker --> Complete searchable text: `sources[{s["id"]}].text` in [the ledger](omni-ledger.json).', '']
    return '\n'.join(out).rstrip()+'\n'


def render(data=None):
    data = data or load()
    VIEW.write_text(render_text(data))
    if 'critique_rows' in data:
        (BASE / 'critique-ledger.json').write_text(json.dumps(data['critique_rows'], ensure_ascii=False, indent=2)+'\n')


def check(data=None):
    data=data or load()
    errors=[]
    if digest(ARCHIVE.read_bytes()) != data['archive_sha256']:
        errors.append('Archive checksum differs from captured manifest')
    if data.get('retirement_complete'):
        for source in data['sources']:
            path = ROOT / source['path']
            if source['disposition'] == 'retire' and path.exists():
                if digest(path.read_bytes()) != source.get('replacement_sha256'):
                    errors.append('Retired document reappeared: '+source['path'])
    ids=[r['id'] for r in data['records']]
    if data.get('coverage', {}).get('review_complete'):
        missing = {s['path'] for s in data['sources']} - set(data['coverage'].get('source_readers', {}))
        if missing: errors.append('Missing source coverage: '+', '.join(sorted(missing)))
    if len(ids)!=len(set(ids)):errors.append('Duplicate work IDs')
    for source in data['sources']:
        try:
            if relative(source['path']) != source['path']: errors.append('Noncanonical source path')
        except ValueError:
            errors.append('Unsafe source path: '+source['path'])
        if source['disposition'] == 'retire' and __import__('re').search(r'(?:^|/)paper[1-8]\.(?:tex|pdf)$', source['path']) and '/build/' not in source['path']:
            errors.append('Protected paper cannot be retired: '+source['path'])
    paths={s['path'] for s in data['sources']}
    if len(paths)!=len(data['sources']):errors.append('Duplicate source paths')
    with zipfile.ZipFile(ARCHIVE) as archive:
        if set(archive.namelist())!=paths:errors.append('Archive/manifest path mismatch')
        for s in data['sources']:
            raw=archive.read(s['path'])
            if len(raw)!=s['bytes'] or digest(raw)!=s['sha256']:errors.append('Corrupt source: '+s['path'])
            if digest(s['text'].encode())!=s['text_sha256']:errors.append('Text checksum mismatch: '+s['path'])
            if s['pages'] and not s['text'].strip():errors.append('Empty PDF transcript: '+s['path'])
    for r in data['records']:
        for field in ['title','kind','status','result','acceptance','sources']:
            if not r.get(field):errors.append(f'{r["id"]}: missing {field}')
        for s in r.get('sources',[]):
            if s['path'] not in paths and not (ROOT/s['path']).is_file():errors.append(f'{r["id"]}: missing source {s["path"]}')
        for dep in r.get('depends_on',[]):
            if dep not in ids:errors.append(f'{r["id"]}: unknown dependency {dep}')
    graph = {r['id']: r.get('depends_on', []) for r in data['records']}
    visiting, visited = set(), set()
    def visit(node):
        if node in visiting:
            errors.append('Dependency cycle at '+node)
            return
        if node in visited or node not in graph:
            return
        visiting.add(node)
        for child in graph[node]: visit(child)
        visiting.remove(node)
        visited.add(node)
    for node in graph: visit(node)
    if VIEW.exists() and VIEW.read_text() != render_text(data):
        errors.append('Omni Markdown projection is stale; run render')
    if 'critique_rows' in data and (BASE / 'critique-ledger.json').exists():
        if json.loads((BASE / 'critique-ledger.json').read_text()) != data['critique_rows']:
            errors.append('Critique projection differs from Omni authority')
    return errors


def retire():
    data=load()
    errors=check(data)
    if not data['records'] or not data.get('coverage',{}).get('review_complete'):
        errors.append('Semantic harvest is incomplete')
    # Preflight all files before deleting any: no partially destructive checksum failure.
    candidates=[]
    for s in data['sources']:
        if s['disposition']!='retire':continue
        p=ROOT/s['path']
        if p.exists():
            if digest(p.read_bytes())!=s['sha256']:errors.append('Source changed since capture: '+s['path'])
            candidates.append(p)
    if errors:raise ValueError('\n'.join(errors))
    for p in candidates:p.unlink()
    data['retirement_complete']=True
    save(data)
    render(data)
    print(f'Retired {len(candidates)} verified supporting documents; originals remain in the checked archive')


def require_linked_feature():
    root = subprocess.check_output(['git','rev-parse','--show-toplevel'],cwd=ROOT,text=True).strip()
    branch = subprocess.check_output(['git','branch','--show-current'],cwd=ROOT,text=True).strip()
    gitdir = subprocess.check_output(['git','rev-parse','--absolute-git-dir'],cwd=ROOT,text=True).strip()
    if Path(root).resolve() != ROOT.resolve() or branch in {'','main','master'} or '/worktrees/' not in gitdir:
        raise ValueError('Writes require the verified linked feature worktree')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['capture','render','check','retire'])
    args=parser.parse_args()
    if args.command != 'check': require_linked_feature()
    if args.command=='capture':capture()
    elif args.command=='render':render()
    elif args.command=='retire':retire()
    else:
        errors=check()
        if errors:raise SystemExit('\n'.join(errors))
        print('Omni ledger: source checksums, archive membership, work records, and dependencies pass')

if __name__=='__main__':main()
