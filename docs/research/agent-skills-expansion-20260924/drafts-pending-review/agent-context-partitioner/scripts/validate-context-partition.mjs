#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const TOP=["schemaVersion","mode","sourceRootDigest","policyDigest","result","targets","items","semanticComparisons","dispositions","transfers","gaps","coverageDigest","truthEffect","authorityEffect"];
const TARGET=["targetRef","type","scope","capacityTokens","capabilityDigests","admissionEvidenceRef"];
const ITEM=["itemId","kind","trustClass","directiveChannel","droppable","tokenEstimate","scope","causalParents","retrievalSpace","obligationState","effectState","capabilityRequirements","authority","contentDigest"];
const AUTH=["status","audience","guidanceEnvelopeRef","verificationReceiptRef","revocationWitnessRef"];
const SPACE=["modelArtifactDigest","modelConfigDigest","preprocessingDigest","chunkerDigest","pooling","dimensions","normalization","metric","coordinatePrecision","quantizationDigest","redactionPolicyDigest","modality","spaceId"];
const DISP=["itemId","disposition","sourceTargetRef","targetRefs","reasonCode","proofRefs"];
const TRANSFER=["itemId","fromTargetRef","toTargetRef","disclosureProofRef"];
const COMPARISON=["leftItemId","rightItemId","spaceId"];
const GAP=["code","itemId","targetRef","detail"];
const OMIT=new Set(["OUT_OF_SCOPE","RETENTION_REDACTED_WITH_TOMBSTONE","EXPIRED_DISPOSABLE","DUPLICATE_CONTENT_HASH","SUPERSEDED_PROJECTION"]);
const DISPOSITIONS=new Set(["ASSIGNED","TRANSFERRED","OMITTED_ALLOWED","BLOCKED"]);
const EFFECT_OPEN=new Set(["PREPARED","DISPATCHED","AMBIGUOUS"]);
const digestPattern=/^sha256:[0-9a-f]{64}$/;

function exact(value,keys,path,errors){
  if(!value||typeof value!=="object"||Array.isArray(value)){errors.push({code:"E_SHAPE",path});return;}
  for(const k of keys)if(!(k in value))errors.push({code:"E_REQUIRED",path:`${path}.${k}`});
  for(const k of Object.keys(value))if(!keys.includes(k))errors.push({code:"E_UNKNOWN_FIELD",path:`${path}.${k}`});
}
function hash(value){return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;}
export function computeCoverageDigest(plan){
  return hash({sourceRootDigest:plan.sourceRootDigest,dispositions:[...(plan.dispositions??[])].sort((a,b)=>a.itemId.localeCompare(b.itemId))});
}
export function computeSpaceId(space){
  const v={};for(const k of SPACE.filter(x=>x!=="spaceId"))v[k]=space[k];return hash(v);
}

export function validatePartition(plan){
  const errors=[];
  exact(plan,TOP,"$",errors);if(errors.length)return errors;
  if(plan.schemaVersion!=="2.0.0")errors.push({code:"E_VERSION",path:"$.schemaVersion"});
  if(!["ACTIVE_SET_PARTITION","CONTINUATION_REQUIREMENTS"].includes(plan.mode))errors.push({code:"E_MODE",path:"$.mode"});
  if(!digestPattern.test(plan.sourceRootDigest)||!digestPattern.test(plan.policyDigest))errors.push({code:"E_ROOT_DIGEST",path:"$"});
  const targets=new Map();
  for(const[i,t]of(plan.targets??[]).entries()){
    exact(t,TARGET,`$.targets[${i}]`,errors);
    if(targets.has(t.targetRef))errors.push({code:"E_DUPLICATE_TARGET",path:`$.targets[${i}].targetRef`});targets.set(t.targetRef,t);
    if(plan.mode==="ACTIVE_SET_PARTITION"&&(t.type!=="ADMITTED_BODY"||!t.admissionEvidenceRef))errors.push({code:"E_UNADMITTED_BODY",path:`$.targets[${i}]`});
    if(plan.mode==="CONTINUATION_REQUIREMENTS"&&(t.type!=="ABSTRACT_SLOT"||t.admissionEvidenceRef!==null))errors.push({code:"E_SLOT_HAS_LIFECYCLE",path:`$.targets[${i}]`});
    if(!Number.isInteger(t.capacityTokens)||t.capacityTokens<0)errors.push({code:"E_CAPACITY",path:`$.targets[${i}].capacityTokens`});
  }
  const items=new Map();
  for(const[i,item]of(plan.items??[]).entries()){
    exact(item,ITEM,`$.items[${i}]`,errors);exact(item.authority,AUTH,`$.items[${i}].authority`,errors);
    if(items.has(item.itemId))errors.push({code:"E_DUPLICATE_ITEM",path:`$.items[${i}].itemId`});items.set(item.itemId,item);
    if(item.directiveChannel){
      if(item.kind!=="GUIDANCE"||item.trustClass!=="CURRENT_GUIDANCE")errors.push({code:"E_AUTHORITY_CHANNEL",path:`$.items[${i}].directiveChannel`});
      const a=item.authority;if(a.status!=="CURRENT"||!a.guidanceEnvelopeRef||!a.verificationReceiptRef||!a.revocationWitnessRef||!a.audience.length)errors.push({code:"E_GUIDANCE_NOT_CURRENT",path:`$.items[${i}].authority`});
    }
    if((item.obligationState==="OPEN"||item.obligationState==="BLOCKED"||EFFECT_OPEN.has(item.effectState))&&item.droppable)errors.push({code:"E_NON_DROPPABLE_STATE",path:`$.items[${i}].droppable`});
    if(!Number.isInteger(item.tokenEstimate)||item.tokenEstimate<0)errors.push({code:"E_TOKEN_ESTIMATE",path:`$.items[${i}].tokenEstimate`});
    if(item.retrievalSpace!==null){exact(item.retrievalSpace,SPACE,`$.items[${i}].retrievalSpace`,errors);if(computeSpaceId(item.retrievalSpace)!==item.retrievalSpace.spaceId)errors.push({code:"E_SPACE_ID",path:`$.items[${i}].retrievalSpace.spaceId`});}
  }
  for(const[i,item]of(plan.items??[]).entries())for(const p of item.causalParents??[])if(!items.has(p))errors.push({code:"E_CAUSAL_GAP",path:`$.items[${i}].causalParents`});
  const dispositions=new Map();
  for(const[i,d]of(plan.dispositions??[]).entries()){
    exact(d,DISP,`$.dispositions[${i}]`,errors);
    if(dispositions.has(d.itemId))errors.push({code:"E_DUPLICATE_DISPOSITION",path:`$.dispositions[${i}].itemId`});dispositions.set(d.itemId,d);
    if(!DISPOSITIONS.has(d.disposition))errors.push({code:"E_DISPOSITION",path:`$.dispositions[${i}].disposition`});
    const item=items.get(d.itemId);if(!item)errors.push({code:"E_UNKNOWN_ITEM",path:`$.dispositions[${i}].itemId`});
    if(d.targetRefs.some(x=>!targets.has(x)))errors.push({code:"E_UNKNOWN_TARGET",path:`$.dispositions[${i}].targetRefs`});
    if(["ASSIGNED","TRANSFERRED"].includes(d.disposition)&&d.targetRefs.length===0)errors.push({code:"E_TARGET_REQUIRED",path:`$.dispositions[${i}].targetRefs`});
    if(d.disposition==="TRANSFERRED"){
      if(typeof d.sourceTargetRef!=="string"||!targets.has(d.sourceTargetRef)||d.targetRefs.includes(d.sourceTargetRef))errors.push({code:"E_TRANSFER_SOURCE_INVALID",path:`$.dispositions[${i}].sourceTargetRef`});
    }else if(d.sourceTargetRef!==null)errors.push({code:"E_TRANSFER_SOURCE_ORPHAN",path:`$.dispositions[${i}].sourceTargetRef`});
    if(d.disposition==="OMITTED_ALLOWED"&&(!item?.droppable||!OMIT.has(d.reasonCode)))errors.push({code:"E_OMISSION_DENIED",path:`$.dispositions[${i}]`});
    if(d.disposition==="BLOCKED"&&plan.result==="FEASIBLE")errors.push({code:"E_BLOCKED_FEASIBLE",path:`$.dispositions[${i}]`});
  }
  for(const item of items.values())if(!dispositions.has(item.itemId))errors.push({code:"E_COVERAGE_MISSING",path:`$.items.${item.itemId}`});
  for(const id of dispositions.keys())if(!items.has(id))errors.push({code:"E_COVERAGE_EXTRA",path:`$.dispositions.${id}`});
  const used=new Map([...targets.keys()].map(x=>[x,0]));
  for(const d of dispositions.values())if(["ASSIGNED","TRANSFERRED"].includes(d.disposition))for(const ref of d.targetRefs){const item=items.get(d.itemId),target=targets.get(ref);if(!item||!target)continue;used.set(ref,used.get(ref)+item.tokenEstimate);if(item.scope!==target.scope)errors.push({code:"E_DISCLOSURE_SCOPE",path:`$.dispositions.${d.itemId}`});for(const cap of item.capabilityRequirements)if(!target.capabilityDigests.includes(cap))errors.push({code:"E_CAPABILITY_GAP",path:`$.dispositions.${d.itemId}`});}
  for(const[ref,n]of used)if(n>targets.get(ref).capacityTokens)errors.push({code:"E_BUDGET_OVERFLOW",path:`$.targets.${ref}`});
  const transfersByItem=new Map(),transferEdges=new Set();
  for(const[i,t]of(plan.transfers??[]).entries()){
    exact(t,TRANSFER,`$.transfers[${i}]`,errors);
    const edge=`${t.itemId}\0${t.fromTargetRef}\0${t.toTargetRef}`;
    if(transferEdges.has(edge))errors.push({code:"E_TRANSFER_DUPLICATE",path:`$.transfers[${i}]`});
    transferEdges.add(edge);
    if(!items.has(t.itemId)||!targets.has(t.fromTargetRef)||!targets.has(t.toTargetRef)||typeof t.disclosureProofRef!=="string"||!t.disclosureProofRef.trim())errors.push({code:"E_TRANSFER_INVALID",path:`$.transfers[${i}]`});
    if(t.fromTargetRef===t.toTargetRef)errors.push({code:"E_TRANSFER_SELF_EDGE",path:`$.transfers[${i}]`});
    const edges=transfersByItem.get(t.itemId)??[];edges.push(t);transfersByItem.set(t.itemId,edges);
  }
  for(const d of dispositions.values()){
    const edges=transfersByItem.get(d.itemId)??[];
    if(d.disposition!=="TRANSFERRED"){
      if(edges.length)errors.push({code:"E_TRANSFER_ORPHAN",path:`$.dispositions.${d.itemId}`});
      continue;
    }
    if(!edges.length)errors.push({code:"E_TRANSFER_EVIDENCE_MISSING",path:`$.dispositions.${d.itemId}`});
    for(const edge of edges)if(edge.fromTargetRef!==d.sourceTargetRef)errors.push({code:"E_TRANSFER_SOURCE_MISMATCH",path:`$.transfers.${d.itemId}`});
    for(const ref of new Set(d.targetRefs)){
      if(edges.filter(t=>t.toTargetRef===ref).length!==1)errors.push({code:"E_TRANSFER_DESTINATION_MISMATCH",path:`$.dispositions.${d.itemId}.targetRefs`});
    }
    for(const edge of edges)if(!d.targetRefs.includes(edge.toTargetRef))errors.push({code:"E_TRANSFER_DESTINATION_MISMATCH",path:`$.transfers.${d.itemId}`});
  }
  for(const[i,c]of(plan.semanticComparisons??[]).entries()){exact(c,COMPARISON,`$.semanticComparisons[${i}]`,errors);const a=items.get(c.leftItemId)?.retrievalSpace,b=items.get(c.rightItemId)?.retrievalSpace;if(!a||!b||a.spaceId!==b.spaceId||c.spaceId!==a.spaceId)errors.push({code:"E_CROSS_SPACE_COMPARISON",path:`$.semanticComparisons[${i}]`});}
  for(const[i,g]of(plan.gaps??[]).entries())exact(g,GAP,`$.gaps[${i}]`,errors);
  if(plan.result==="FEASIBLE"&&plan.gaps.length)errors.push({code:"E_FEASIBLE_WITH_GAPS",path:"$.gaps"});
  if(plan.coverageDigest!==computeCoverageDigest(plan))errors.push({code:"E_COVERAGE_DIGEST",path:"$.coverageDigest"});
  if(plan.truthEffect!=="NONE")errors.push({code:"E_TRUTH_MINTING",path:"$.truthEffect"});
  if(plan.authorityEffect!=="NONE")errors.push({code:"E_ADMISSION_ACTION_FORBIDDEN",path:"$.authorityEffect"});
  return errors.sort((a,b)=>(a.code+a.path).localeCompare(b.code+b.path));
}

if(import.meta.url===pathToFileURL(process.argv[1]??"").href){
  try{const p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));const errors=validatePartition(p);console.log(JSON.stringify({valid:!errors.length,coverageDigest:computeCoverageDigest(p),errors},null,2));process.exitCode=errors.length?1:0;}
  catch(error){console.error(JSON.stringify({valid:false,error:String(error)}));process.exitCode=2;}
}
