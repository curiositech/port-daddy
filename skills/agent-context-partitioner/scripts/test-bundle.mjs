#!/usr/bin/env node
import fs from "node:fs";
import {computeCoverageDigest,validatePartition} from "./validate-context-partition.mjs";

const base=JSON.parse(fs.readFileSync(new URL("../examples/valid-proposal.json",import.meta.url),"utf8"));
const clone=()=>structuredClone(base);
function mutate(fn){const x=clone();fn(x);x.coverageDigest=computeCoverageDigest(x);return x;}
function transferred(){
  return mutate(x=>{
    x.targets.push({...structuredClone(x.targets[0]),targetRef:"body:source:g1",admissionEvidenceRef:"admission:source:g1"});
    x.dispositions[0].disposition="TRANSFERRED";
    x.transfers=[{itemId:"guidance:1",fromTargetRef:"body:source:g1",toTargetRef:"body:reviewer:g2",disclosureProofRef:"disclosure:guidance:1"}];
  });
}
const cases=[
  ["valid",()=>clone(),null],
  ["valid transfer",()=>transferred(),null],
  ["unknown",()=>mutate(x=>x.spawn=true),"E_UNKNOWN_FIELD"],
  ["unadmitted",()=>mutate(x=>x.targets[0].admissionEvidenceRef=null),"E_UNADMITTED_BODY"],
  ["fact-directive",()=>mutate(x=>x.items[1].directiveChannel=true),"E_AUTHORITY_CHANNEL"],
  ["revoked-guidance",()=>mutate(x=>x.items[0].authority.status="REVOKED"),"E_GUIDANCE_NOT_CURRENT"],
  ["obligation-droppable",()=>mutate(x=>x.items[1].droppable=true),"E_NON_DROPPABLE_STATE"],
  ["missing-disposition",()=>mutate(x=>x.dispositions.pop()),"E_COVERAGE_MISSING"],
  ["omit-obligation",()=>mutate(x=>{x.items[1].droppable=true;x.dispositions[1].disposition="OMITTED_ALLOWED";x.dispositions[1].targetRefs=[];x.dispositions[1].reasonCode="EXPIRED_DISPOSABLE"}),"E_NON_DROPPABLE_STATE"],
  ["scope",()=>mutate(x=>x.targets[0].scope="repo:other"),"E_DISCLOSURE_SCOPE"],
  ["capability",()=>mutate(x=>x.targets[0].capabilityDigests=[]),"E_CAPABILITY_GAP"],
  ["overflow",()=>mutate(x=>x.targets[0].capacityTokens=100),"E_BUDGET_OVERFLOW"],
  ["causal-gap",()=>mutate(x=>x.items[1].causalParents=["missing"]),"E_CAUSAL_GAP"],
  ["cross-space",()=>mutate(x=>x.semanticComparisons=[{leftItemId:"guidance:1",rightItemId:"obligation:1",spaceId:x.sourceRootDigest}]),"E_CROSS_SPACE_COMPARISON"],
  ["transferred without evidence",()=>{const x=transferred();x.transfers=[];return x},"E_TRANSFER_EVIDENCE_MISSING"],
  ["transfer destination mismatch",()=>{const x=transferred();x.dispositions[0].targetRefs=["body:source:g1"];x.coverageDigest=computeCoverageDigest(x);return x},"E_TRANSFER_DESTINATION_MISMATCH"],
  ["blocked-green",()=>mutate(x=>x.dispositions[1].disposition="BLOCKED"),"E_BLOCKED_FEASIBLE"],
  ["authority-mint",()=>mutate(x=>x.authorityEffect="ADMIT_SUCCESSOR"),"E_ADMISSION_ACTION_FORBIDDEN"],
  ["bad-coverage",()=>{const x=clone();x.coverageDigest=x.sourceRootDigest;return x},"E_COVERAGE_DIGEST"]
];
const failures=[];for(const[name,make,expected]of cases){const codes=validatePartition(make()).map(x=>x.code);if(expected===null?codes.length!==0:!codes.includes(expected))failures.push({name,expected,codes});}
console.log(JSON.stringify({valid:!failures.length,cases:cases.length,failures},null,2));if(failures.length)process.exitCode=1;
