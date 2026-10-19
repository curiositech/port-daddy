/* Exercises the db path and the region tool: the two things that must not
   have regressed, since the author's rulings and region notes live there. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {parseHTML}=require('linkedom');
// run from the repository root:  node <this file>
const B='docs/harbor-research/exposition/figures/desk';
const html=fs.readFileSync(path.join(B,'index.html'),'utf8');
const {window,document}=parseHTML('<!doctype html><html><head></head><body>'+html+'</body></html>');
const errs=[]; const writes=[];
global.window=window; global.document=document;
window.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
window.localStorage={getItem(){return null},setItem(){}};
window.innerWidth=1440;
const LOC={hash:''}; window.location=LOC; global.location=LOC;

/* a minimal stand-in for the artifact db capability */
let snapRulings, snapRegions, snapUndrawn;
function coll(name){
  return {
    onSnapshot(cb){ const f=()=>cb({docs:[]});
      if(name==='rulings')snapRulings=cb; if(name==='regions')snapRegions=cb; if(name==='undrawn')snapUndrawn=cb;
      f(); return ()=>{}; },
    limit(){ return this; },
    doc(){ return {id:'r'+(writes.length+1), set(b){writes.push(['region-set',b]);return Promise.resolve();}}; },
  };
}
const DB={ collection:coll,
  doc(p){ return { set(b){writes.push(['set',p,b]);return Promise.resolve();},
                   update(b){writes.push(['update',p,b]);return Promise.resolve();},
                   delete(){writes.push(['delete',p]);return Promise.resolve();} }; } };
window.claude={ use(n){ return Promise.resolve(n==='db'?DB:null); } };

for(const n of ['CHAPTERS','FIGS','CRIT','RESEARCH','TRIAGE','UNDRAWN','PIXEL','FINDINGS','DOCTRINE'])
  require(process.cwd()+'/'+B+'/data/'+n+'.js');
const src=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
try{ new Function('window','document','location','setTimeout','clearTimeout','console','Element',src)
      (window,document,LOC,setTimeout,clearTimeout,console,window.Element); }
catch(e){ errs.push('BOOT: '+e.stack.split('\n').slice(0,3).join(' | ')); }

setTimeout(()=>{
  const q=s=>document.querySelector(s), qa=s=>[...document.querySelectorAll(s)];
  const banner=q('#dbbanner');
  if(!banner.hasAttribute('hidden')) errs.push('db banner still shown after connect');

  // verdict buttons must be live once the db is up
  const vb=qa('#desk .vseg button');
  if(vb.length!==5) errs.push('verdict buttons: '+vb.length);
  if(vb.some(b=>b.hasAttribute('disabled'))) errs.push('verdict buttons still disabled with a db');
  vb[0].onclick();                                   // rule KEEP
  const ruled=writes.find(w=>w[0]==='set'&&/^rulings\//.test(w[1]));
  if(!ruled) errs.push('ruling was not written'); else console.log('ruling ->',ruled[1],JSON.stringify(ruled[2]).slice(0,60));

  // note field + save
  const ta=q('#notefield'); if(!ta||ta.hasAttribute('disabled')) errs.push('note field missing/disabled');
  ta.value='a whole-figure note';
  const save=qa('#desk .btn').find(b=>b.textContent==='Save note');
  if(!save) errs.push('Save note button missing'); else save.onclick();
  if(!writes.some(w=>w[0]==='set'&&w[2]&&w[2].note==='a whole-figure note')) errs.push('note was not written');

  // the region tool: the sheet, the drag handler, the composer, the save
  const sheet=q('#sheet');
  if(!sheet) errs.push('no sheet'); 
  if(!sheet.classList.contains('draw')) errs.push('drawing not armed by default');
  if(!q('#dragbox')) errs.push('no dragbox');
  if(!q('#overlay')) errs.push('no overlay');
  const toggles=qa('#stage .tog').map(b=>b.textContent);
  if(!toggles.includes('Draw regions')) errs.push('Draw regions toggle missing');
  if(!toggles.includes('Contact sheet')) errs.push('Contact sheet toggle missing');
  const img=q('#sheetwrap img');
  if(!img||!/^pages\/p\d{3}\.jpg$/.test(img.getAttribute('src')))
    errs.push('page image src wrong: '+(img&&img.getAttribute('src')));

  console.log('page image:', img.getAttribute('src'));
  console.log('stage toggles:', toggles.join(', '));
  console.log('writes:', writes.map(w=>w[0]+' '+(w[1]||'')).join(' | '));
  if(errs.length){ console.log('\nERRORS:'); errs.forEach(e=>console.log('  '+e)); process.exit(1); }
  console.log('\nDB + REGION TOOL OK');
},800);
