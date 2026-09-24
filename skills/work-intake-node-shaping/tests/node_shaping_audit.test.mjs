import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {auditNodeShaping} from '../scripts/node_shaping_audit.mjs';
const base=JSON.parse(readFileSync(new URL('../examples/sample-input.json',import.meta.url)));
const clone=change=>{const x=structuredClone(base);change(x);return x;};
const invalid=(name,change)=>test(name,()=>{const r=auditNodeShaping(clone(change));assert.equal(r.pass,false);assert.equal(r.declarationValid,false);assert.equal(r.eligibleToAdmit,false);});
test('valid supplied trace is declaration-valid and eligible',()=>{const r=auditNodeShaping(base);assert.equal(r.pass,true);assert.equal(r.eligibleToAdmit,true);});
invalid('unknown signal enum rejects',x=>x.workIntent.signals.budget='huge');
invalid('missing runner-up rejects',x=>delete x.runnerUp);
invalid('same runner-up rejects',x=>x.runnerUp.archetype='node');
invalid('human gate needs approval declaration',x=>{x.selectedArchetypes=['human-gate'];x.approval={required:false,present:false,blockedAction:''};});
invalid('string authority rejects',x=>x.assignment.authority='false');
invalid('unknown imported route verb rejects',x=>x.legacyRoutes[0].verb='invented');
invalid('empty routes need evidence',x=>x.legacyRoutes=[]);
invalid('empty canonical trace suffix rejects',x=>x.canonicalTarget.callTraceRef='trace:');
invalid('empty canonical readback suffix rejects',x=>x.canonicalTarget.persistedStateRef='readback:');
invalid('empty no-route evidence suffix rejects',x=>{x.legacyRoutes=[];x.noReachableLegacyRoutesEvidence='trace:';});
for (const value of [null, [], {}, '', 1, NaN, Infinity]) invalid('schema rejects assignment authority mutation '+String(value),x=>x.assignment.authority=value);
test('empty routes can be explicitly evidenced',()=>{const r=auditNodeShaping(clone(x=>{x.legacyRoutes=[];x.noReachableLegacyRoutesEvidence='trace:no-legacy-reachable';}));assert.equal(r.pass,true);assert.equal(r.eligibleToAdmit,true);});
test('required approval blocks otherwise valid selected node',()=>{const r=auditNodeShaping(clone(x=>x.approval={required:true,present:false,blockedAction:'approve-dispatch'}));assert.equal(r.pass,true);assert.equal(r.eligibleToAdmit,false);assert.equal(r.structuralBlocked,true);});
test('authority false blocks otherwise valid intake',()=>{const r=auditNodeShaping(clone(x=>x.assignment.authority=false));assert.equal(r.pass,true);assert.equal(r.eligibleToAdmit,false);assert.equal(r.structuralBlocked,true);});
test('allowed extra properties remain valid',()=>{const r=auditNodeShaping(clone(x=>x.extraAuditNote='preserved'));assert.equal(r.pass,true);});
test('CLI returns nonzero for malformed input',()=>{const source=new URL('../scripts/node_shaping_audit.mjs',import.meta.url);const file=new URL('intake-null.json',import.meta.url).pathname;writeFileSync(file,'null');const result=spawnSync(process.execPath,[source.pathname,'--input',file],{encoding:'utf8',env:process.env});unlinkSync(file);assert.notEqual(result.status,0);});

test('all supplied leaf mutations return a result without an API exception',()=>{
  const values=[null,[],{},'',false,1,NaN,Infinity];
  const leaves=[];
  const collect=(value,path=[])=>{
    if(Array.isArray(value)) value.forEach((child,index)=>collect(child,path.concat(index)));
    else if(value&&typeof value==='object') Object.entries(value).forEach(([key,child])=>collect(child,path.concat(key)));
    else leaves.push(path);
  };
  collect(base);
  for(const path of leaves) for(const value of values){
    const x=structuredClone(base); let target=x;
    for(const part of path.slice(0,-1)) target=target[part];
    target[path.at(-1)]=value;
    assert.doesNotThrow(()=>auditNodeShaping(x));
  }
});
test('CLI returns nonzero for a declaration-valid but blocked intake',()=>{
  const x=structuredClone(base);x.assignment.authority=false;
  const file=new URL('intake-blocked.json',import.meta.url).pathname;writeFileSync(file,JSON.stringify(x));
  const source=new URL('../scripts/node_shaping_audit.mjs',import.meta.url);
  const result=spawnSync(process.execPath,[source.pathname,'--input',file],{encoding:'utf8',env:process.env});unlinkSync(file);
  assert.notEqual(result.status,0);assert.equal(result.stdout.includes('"eligibleToAdmit": false'),true);
});
