import pathlib,subprocess,os,json,hashlib,re,sys,time
root=pathlib.Path('/Users/erichowens/coding/tmp/book-textbook-craft-20261103');out=pathlib.Path(__file__).parent;pub=root/'website-v2/public/whitepaper'
assert subprocess.check_output(['git','rev-parse','--show-toplevel'],cwd=root,text=True).strip()==str(root)
assert subprocess.check_output(['git','branch','--show-current'],cwd=root,text=True).strip()=='codex/book-textbook-craft-20261103'
paths=sorted(set(root.glob('whitepaper/**/*.tex'))|set(root.glob('website-v2/public/whitepaper/**/*.tex')))
inputs={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
accepted=root/'.cache/whitepaper-build/coordination-papers-mega-volume/coordination-papers-mega-volume.pdf';before=hashlib.sha256(accepted.read_bytes()).hexdigest()
subprocess.run(['node','scripts/generate-mega-whitepaper.mjs',str(out)],cwd=root,check=True)
for name in ['coordination-papers-mega-volume.tex','coordination-papers-mega-volume-appendices.tex']:
 s=(pub/name).read_text().replace('../../../.cache/whitepaper-build/coordination-papers-mega-volume/',out.as_posix()+'/')
 if name=='coordination-papers-mega-volume.tex':s=s.replace(r'\input{coordination-papers-mega-volume-appendices.tex}',r'\input{'+str(out/'coordination-papers-mega-volume-appendices.tex')+'}')
 (out/name).write_text(s)
(out/'pd-book-font-config.tex').write_text(r'\def\pdbookfontprofile{open-proof}'+'\n')
env=os.environ.copy();env['TEXINPUTS']=str(out)+':'+str(pub)+':'
env['SOURCE_DATE_EPOCH']=subprocess.check_output(['git','log','-1','--format=%at'],cwd=root,text=True).strip();env['FORCE_SOURCE_DATE']='1'
pattern=re.compile(r'Rerun to get cross-references right|Label\(s\) may have changed|PD-MARGIN-CONVERGENCE: pending|Margin positions changed|Rerun to get outlines right|rerunfilecheck Warning: File .* has changed|There were undefined references|Citation .* undefined|Reference .* undefined')
for n in range(1,9):
 print('Isolated open-proof pass',n,'/8',flush=True)
 with (out/f'pass-{n}.console.log').open('w') as log:
  result=subprocess.run(['/Library/TeX/texbin/xelatex','-interaction=nonstopmode','-halt-on-error','-file-line-error','-recorder','-output-directory='+str(out),str(out/'coordination-papers-mega-volume.tex')],cwd=pub,env=env,stdout=log,stderr=subprocess.STDOUT)
 if result.returncode:print('Engine failed',result.returncode,flush=True);sys.exit(result.returncode)
 log=(out/'coordination-papers-mega-volume.log').read_text(errors='replace')
 if n>=2 and not pattern.search(log):break
else:raise RuntimeError('Eight passes did not converge')
drift=[p for p,h in inputs.items() if hashlib.sha256((root/p).read_bytes()).hexdigest()!=h];assert not drift,drift
assert hashlib.sha256(accepted.read_bytes()).hexdigest()==before,'Accepted Suisse cache PDF changed'
fls=(out/'coordination-papers-mega-volume.fls').read_text();bad=[l for l in fls.splitlines() if l.startswith('INPUT ') and '.cache/whitepaper-build' in l];assert not bad,bad
pdf=out/'coordination-papers-mega-volume.pdf'
r={'scope':'Isolated local Source Sans open-proof, no publication','head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'source_inputs':inputs,'font_profile':'open-proof','passes':n,'pdf_sha256':hashlib.sha256(pdf.read_bytes()).hexdigest(),'accepted_suisse_sha256_before_and_after':before,'source_drift':drift,'cache_inputs':bad,'overfull_hboxes':len(re.findall(r'Overfull \\hbox',log)),'driver_only_changes':'Generated input paths and appendix path rebound to isolated output; no content changes.'}
(out/'build-receipt.json').write_text(json.dumps(r,indent=2)+'\n');print('CONVERGED',json.dumps({k:v for k,v in r.items() if k!='source_inputs'}),flush=True)
