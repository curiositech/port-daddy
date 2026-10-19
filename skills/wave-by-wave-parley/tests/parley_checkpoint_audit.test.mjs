import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {auditParleyCheckpoint} from '../scripts/parley_checkpoint_audit.mjs';
const base=JSON.parse(readFileSync(new URL('../examples/checkpoint-valid.json',import.meta.url)));
const clone=change=>{const x=structuredClone(base);change(x);return x;};
const invalid=(name,change)=>test(name,()=>{const r=auditParleyCheckpoint(clone(change));assert.equal(r.pass,false);assert.equal(r.declarationValid,false);assert.equal(r.eligibleToAdmit,false);});
test('valid checkpoint is declaration-valid and eligible',()=>{const r=auditParleyCheckpoint(base);assert.equal(r.pass,true);assert.equal(r.declarationValid,true);assert.equal(r.eligibleToAdmit,true);});
test('null checkpoint fails schema',()=>{const r=auditParleyCheckpoint(null);assert.equal(r.pass,false);assert.equal(r.declarationValid,false);assert.equal(r.eligibleToAdmit,false);});
invalid('missing graph revision fails schema',x=>delete x.graphRevision);
invalid('partial just-finished output fails declaration',x=>x.outcomes[1].status='partial');
invalid('missing outcome revision fails schema',x=>delete x.outcomes[1].revision);
invalid('duplicate outcome fails declaration',x=>x.outcomes.push(structuredClone(x.outcomes[0])));
invalid('cycle fails declaration',x=>x.nodes[0].dependsOn=['publish']);
invalid('empty next wave fails schema',x=>x.nextWave=[]);
invalid('string authority fails schema',x=>x.assignment.authority='false');
invalid('missing risk evidence hash fails schema',x=>delete x.risks[0].evidenceHash);
invalid('duplicate next-wave member fails schema',x=>x.nextWave=['patch-X','patch-X']);
invalid('next wave cannot relaunch completed scan',x=>x.nextWave=['scan']);
invalid('causal parent and child cannot share just-finished set',x=>x.justFinished=['scan','inspect-call-sites']);
invalid('successful inspect cannot omit its scan producer outcome',x=>x.outcomes=x.outcomes.filter(o=>o.nodeId!=='scan'));
invalid('successful inspect cannot follow a failed scan producer',x=>x.outcomes.find(o=>o.nodeId==='scan').status='failed');
invalid('transitive causal closure rejects scan and patch in one just-finished wave',x=>{x.justFinished=['scan','patch-X'];x.outcomes.push({nodeId:'patch-X',revision:5,status:'success',evidenceHash:'h3'});x.nextWave=['publish'];});
test('reported non-success independent outcome is coherent but holds next admission',()=>{for(const status of ['partial','failed','missing','untrusted']) {const r=auditParleyCheckpoint(clone(x=>{x.nodes.push({id:'independent-observation',dependsOn:[]});x.justFinished.push('independent-observation');x.outcomes.push({nodeId:'independent-observation',revision:5,status,evidenceHash:'h4'});}));assert.equal(r.declarationValid,true);assert.equal(r.eligibleToAdmit,false);assert.equal(r.structuralBlocked,true);assert.ok(r.findings.some(f=>f.id==='wave-recovery-required'));}});
test('independent successful waves remain declaration-valid',()=>{const r=auditParleyCheckpoint(clone(x=>{x.nodes.push({id:'independent-observation',dependsOn:[]});x.justFinished.push('independent-observation');x.outcomes.push({nodeId:'independent-observation',revision:5,status:'success',evidenceHash:'h4'});}));assert.equal(r.declarationValid,true);assert.equal(r.eligibleToAdmit,true);});
test('non-success outcome outside just-finished is coherent when no declared admission gate depends on it',()=>{const r=auditParleyCheckpoint(clone(x=>{x.nodes.push({id:'independent-observation',dependsOn:[]});x.outcomes.push({nodeId:'independent-observation',revision:5,status:'failed',evidenceHash:'h4'});}));assert.equal(r.declarationValid,true);assert.equal(r.eligibleToAdmit,true);});
for (const value of [null, [], {}, '', false, 1, NaN, Infinity]) invalid('schema rejects graphRevision mutation '+String(value),x=>x.graphRevision=value);
test('missing approval is structurally valid but blocked from admission',()=>{const r=auditParleyCheckpoint(clone(x=>x.approval={required:true,present:false}));assert.equal(r.pass,true);assert.equal(r.declarationValid,true);assert.equal(r.eligibleToAdmit,false);assert.equal(r.structuralBlocked,true);});
test('CLI returns nonzero for malformed input',()=>{const source=new URL('../scripts/parley_checkpoint_audit.mjs',import.meta.url);const file=resolveTemp('parley-null.json');writeFileSync(file,'null');const result=spawnSync(process.execPath,[source.pathname,'--input',file],{encoding:'utf8',env:process.env});unlinkSync(file);assert.notEqual(result.status,0);});
function resolveTemp(name){return new URL(name,import.meta.url).pathname;}

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
    assert.doesNotThrow(()=>auditParleyCheckpoint(x));
  }
});
test('CLI returns nonzero for a declaration-valid but blocked checkpoint',()=>{
  const x=structuredClone(base);x.approval={required:true,present:false};
  const file=resolveTemp('parley-blocked.json');writeFileSync(file,JSON.stringify(x));
  const source=new URL('../scripts/parley_checkpoint_audit.mjs',import.meta.url);
  const result=spawnSync(process.execPath,[source.pathname,'--input',file],{encoding:'utf8',env:process.env});unlinkSync(file);
  assert.notEqual(result.status,0);assert.equal(result.stdout.includes('"eligibleToAdmit": false'),true);
});
