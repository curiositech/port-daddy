import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {parseHTML}=require('linkedom');
// run from the repository root:  node <this file>
const B='docs/harbor-research/exposition/figures/desk';
const html=fs.readFileSync(path.join(B,'index.html'),'utf8');
const {window,document}=parseHTML('<!doctype html><html><head></head><body>'+html+'</body></html>');
const errs=[];
global.window=window; global.document=document;
window.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
window.localStorage={getItem(){return null},setItem(){}};
window.innerWidth=1440;
window.requestAnimationFrame=cb=>setTimeout(cb,0);
global.setTimeout=setTimeout; global.clearTimeout=clearTimeout;
const LOC={hash:''};
window.location=LOC; global.location=LOC;
// no claude runtime -> the db path must degrade to read-only, which is a case worth exercising
for(const n of ['CHAPTERS','FIGS','CRIT','RESEARCH','TRIAGE','UNDRAWN','PIXEL','FINDINGS','DOCTRINE'])
  require(process.cwd()+'/'+B+'/data/'+n+'.js');
const src=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
try{ new Function('window','document','location','setTimeout','clearTimeout','console','Element',src)
      (window,document,LOC,setTimeout,clearTimeout,console,window.Element); }
catch(e){ errs.push('BOOT: '+e.stack.split('\n').slice(0,3).join(' | ')); }
setTimeout(()=>{
  const q=s=>document.querySelector(s), qa=s=>[...document.querySelectorAll(s)];
  const checks=[
    ['counts tiles', qa('#counts .cblk').length, 8],
    ['cross findings', qa('#crosshost .find').length, 6],
    ['rubric lists', qa('#listshost .find').length, 3],
    ['list rows', qa('#list .row').length>0, true],
    ['desk rubric rows', qa('#desk .rubrow').length, 15],
    ['four reviewer tiles', qa('#desk .revb').length, 4],
    ['epigraph shown', q('#epigraph') && !q('#epigraph').hasAttribute('hidden'), true],
    ['stage sheet', !!q('#sheet'), true],
    ['rubric filter opts', qa('#f-crit option').length>2, true],
  ];
  for(const [n,got,want] of checks)
    if(got!==want) errs.push(`CHECK ${n}: got ${got}, want ${want}`);
  const unpublishedFigures=[
    ['anchor-four-phases',94],
    ['anchor-handshake-ladder',100],
    ['he-succession-price',314],
    ['bc-delta-threshold',388],
  ];
  for(const [id,bookPage] of unpublishedFigures){
    const unpublished=qa('#list .row').find(b=>b.textContent.includes(id));
    if(!unpublished){
      errs.push(`CHECK unpublished figure row: missing ${id}`);
      continue;
    }
    if(!unpublished.textContent.includes(`Book p${bookPage} · JPG pending`))
      errs.push(`CHECK unpublished figure row ${id}: missing pending-publication label`);
    unpublished.onclick();
    const stageText=(q('#stage')&&q('#stage').textContent||'').replace(/\s+/g,' ');
    if(!stageText.includes('Page image not published'))
      errs.push(`CHECK unpublished stage ${id}: missing truthful publication state`);
    if(!stageText.includes(`Book p${bookPage}`))
      errs.push(`CHECK unpublished stage ${id}: missing current Book location`);
    if(q('#sheet'))
      errs.push(`CHECK unpublished stage ${id}: fabricated a page image sheet`);
  }
  const epi=q('#epigraph'); if(epi) console.log('epigraph:', epi.textContent.slice(0,90)+'...');
  console.log('list head:', q('#listhead') && q('#listhead').textContent);
  console.log('first row:', q('#list .row') && q('#list .row').textContent.replace(/\s+/g,' ').slice(0,90));
  console.log('rubric lists:', qa('#listshost h5').map(h=>h.textContent).join(' / '));
  console.log('db banner:', q('#dbbanner') && q('#dbbanner').textContent.slice(0,60));
  if(errs.length){ console.log('\nERRORS:'); errs.forEach(e=>console.log('  '+e)); process.exit(1); }
  console.log('\nALL CHECKS PASS');
},600);
