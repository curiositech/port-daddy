#!/usr/bin/env node
import fs from "node:fs";
import {pathToFileURL} from "node:url";

const TOP=["schemaVersion","mode","runId","status","objective","packet","criteriaDigest","authorityBoundary","bounds","participants","positions","reviews","corrections","realityBeats","dissent","managerSubmission","externalDecisionRef","claims"];
const PACKET=["packetId","repositoryAnchor","packetSha256","fileCount","truthState","runtimeAuthority","includedClasses","excludedClasses"];
const AUTH=["managerMaySpawn","managerMayApprove","recursiveDelegationAllowed","externalGateRequired"];
const BOUNDS=["maxRounds","maxConcurrentContributors","maxTotalBirths","maxSpawnDepth","maxAttemptsPerArtifact","maxCorrectionAttemptsPerTicket","deadline","nativeCapacityCeilings"];
const CAPACITY=["resource","unit","ceiling"];
const PARTICIPANT=["participantId","role","admissionEvidenceRef"], POSITION=["positionId","authorId","packetSha256","artifactDigest","falsifier"];
const REVIEW=["reviewId","reviewerId","positionId","packetSha256","steelman","unresolvedTension","critique","critiqueFalsifier","narrowAmendment","ownConcession","retainedDissent"];
const STEEL=["thesisMechanism","evidenceFalsifier","protectedOutcome"];
const CORR=["ticketId","authorId","packetSha256","disposition","claimDelta","preservedInvariants","evidenceRefs","truthLabel","dissent","createsRole","createsAuthority","createsRuntimeAction","attempt"];
const BEAT=["beat","authorId","packetSha256","artifactDigest","decision","falsifiers"];
const DISSENT=["dissentId","originatorId","packetSha256","statementDigest","status","evidenceRefs"];
const SUB=["managerId","packetSha256","candidateDigest","referencedDissentIds","decision"];
const CLAIM=["claimId","truthLabel","statement","evidenceRefs","missingDynamicEvidence"];
const DIGEST=/^sha256:[0-9a-f]{64}$/;

function exact(v,keys,path,out){if(!v||typeof v!=="object"||Array.isArray(v)){out.push({code:"shape-invalid",path});return;}for(const k of keys)if(!(k in v))out.push({code:"required-field-missing",path:`${path}.${k}`});for(const k of Object.keys(v))if(!keys.includes(k))out.push({code:"unknown-field",path:`${path}.${k}`});}
function add(out,condition,code,path,message=""){if(condition)out.push({code,path,message});}
function validDateTime(value){
  if(typeof value!=="string")return false;
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if(!match)return false;
  const[,year,month,day,hour,minute,second,,offsetHour,offsetMinute]=match;
  const daysInMonth=new Date(Date.UTC(Number(year),Number(month),0)).getUTCDate();
  return Number(month)>=1&&Number(month)<=12&&Number(day)>=1&&Number(day)<=daysInMonth&&Number(hour)<=23&&Number(minute)<=59&&Number(second)<=59&&(!offsetHour||(Number(offsetHour)<=23&&Number(offsetMinute)<=59));
}

export function audit(plan){
  const out=[];exact(plan,TOP,"$",out);if(out.length)return out;
  exact(plan.packet,PACKET,"$.packet",out);exact(plan.authorityBoundary,AUTH,"$.authorityBoundary",out);exact(plan.bounds,BOUNDS,"$.bounds",out);
  add(out,plan.schemaVersion!=="2.0.0","version-invalid","$.schemaVersion");add(out,plan.mode!=="DESIGN_AUDIT_ONLY","runtime-mode-forbidden","$.mode");
  add(out,!DIGEST.test(plan.packet.packetSha256),"packet-digest-invalid","$.packet.packetSha256");add(out,plan.packet.runtimeAuthority!=="NONE","truth-state-upgrade","$.packet.runtimeAuthority");
  add(out,plan.authorityBoundary.managerMaySpawn||plan.authorityBoundary.recursiveDelegationAllowed,"manager-runtime-spawn-authority","$.authorityBoundary");
  add(out,plan.authorityBoundary.managerMayApprove||!plan.authorityBoundary.externalGateRequired,"manager-self-approval","$.authorityBoundary");
  const b=plan.bounds??{};add(out,!Number.isInteger(b.maxRounds)||b.maxRounds<1,"unbounded-rounds","$.bounds.maxRounds");add(out,!Number.isInteger(b.maxConcurrentContributors)||b.maxConcurrentContributors<1,"contributor-bound-invalid","$.bounds.maxConcurrentContributors");add(out,!Number.isInteger(b.maxTotalBirths)||b.maxTotalBirths<0,"birth-bound-invalid","$.bounds.maxTotalBirths");add(out,b.maxSpawnDepth!==0,"recursive-spawn-enabled","$.bounds.maxSpawnDepth");add(out,!Number.isInteger(b.maxAttemptsPerArtifact)||b.maxAttemptsPerArtifact<1,"artifact-attempt-bound-invalid","$.bounds.maxAttemptsPerArtifact");add(out,b.maxCorrectionAttemptsPerTicket!==1,"correction-unbounded","$.bounds.maxCorrectionAttemptsPerTicket");add(out,!validDateTime(b.deadline),"deadline-invalid","$.bounds.deadline");
  const capacities=Array.isArray(b.nativeCapacityCeilings)?b.nativeCapacityCeilings:[];add(out,!capacities.length,"native-capacity-empty","$.bounds.nativeCapacityCeilings");const capacityKeys=new Set();
  for(const[i,c]of capacities.entries()){exact(c,CAPACITY,`$.bounds.nativeCapacityCeilings[${i}]`,out);const resource=typeof c?.resource==="string"?c.resource.trim():"",unit=typeof c?.unit==="string"?c.unit.trim():"",key=`${resource}\0${unit}`;add(out,!resource||!unit||typeof c?.ceiling!=="number"||!Number.isFinite(c.ceiling)||c.ceiling<0,"native-capacity-invalid",`$.bounds.nativeCapacityCeilings[${i}]`);add(out,capacityKeys.has(key),"native-capacity-duplicate",`$.bounds.nativeCapacityCeilings[${i}]`);capacityKeys.add(key);}
  const participants=new Map();for(const[i,p]of(plan.participants??[]).entries()){exact(p,PARTICIPANT,`$.participants[${i}]`,out);add(out,participants.has(p.participantId),"participant-duplicate",`$.participants[${i}].participantId`);participants.set(p.participantId,p);add(out,!p.admissionEvidenceRef,"birth-without-admission",`$.participants[${i}].admissionEvidenceRef`);}
  const managers=[...participants.values()].filter(p=>p.role==="MANAGER");add(out,managers.length!==1,"manager-count-invalid","$.participants");
  const positions=new Map();for(const[i,p]of(plan.positions??[]).entries()){exact(p,POSITION,`$.positions[${i}]`,out);positions.set(p.positionId,p);add(out,participants.get(p.authorId)?.role!=="POSITION_AUTHOR","position-role-invalid",`$.positions[${i}].authorId`);add(out,p.packetSha256!==plan.packet.packetSha256,"packet-digest-mismatch",`$.positions[${i}].packetSha256`);}
  const reviewed=new Set();for(const[i,r]of(plan.reviews??[]).entries()){exact(r,REVIEW,`$.reviews[${i}]`,out);exact(r.steelman,STEEL,`$.reviews[${i}].steelman`,out);const pos=positions.get(r.positionId);add(out,!pos,"reciprocal-review-target-missing",`$.reviews[${i}].positionId`);add(out,participants.get(r.reviewerId)?.role!=="RECIPROCAL_REVIEWER"||r.reviewerId===pos?.authorId,"reciprocal-review-not-independent",`$.reviews[${i}].reviewerId`);add(out,r.packetSha256!==plan.packet.packetSha256,"packet-digest-mismatch",`$.reviews[${i}].packetSha256`);add(out,Object.values(r.steelman??{}).some(v=>!String(v).trim()),"steelmanning-incomplete",`$.reviews[${i}].steelman`);reviewed.add(r.positionId);}
  for(const id of positions.keys())add(out,!reviewed.has(id),"reciprocal-review-missing",`$.positions.${id}`);
  for(const[i,c]of(plan.corrections??[]).entries()){exact(c,CORR,`$.corrections[${i}]`,out);add(out,c.packetSha256!==plan.packet.packetSha256,"packet-digest-mismatch",`$.corrections[${i}].packetSha256`);add(out,c.createsRole||c.createsAuthority||c.createsRuntimeAction||c.attempt!==1,"correction-broadens-scope",`$.corrections[${i}]`);add(out,participants.get(c.authorId)?.role!=="CORRECTION_AUTHOR","correction-role-invalid",`$.corrections[${i}].authorId`);}
  const prior=new Set([...plan.positions.map(x=>x.authorId),...plan.reviews.map(x=>x.reviewerId),...plan.corrections.map(x=>x.authorId),...managers.map(x=>x.participantId)]);const beats=new Set();
  for(const[i,bx]of(plan.realityBeats??[]).entries()){exact(bx,BEAT,`$.realityBeats[${i}]`,out);add(out,beats.has(bx.beat),"reality-beat-duplicate",`$.realityBeats[${i}].beat`);beats.add(bx.beat);add(out,prior.has(bx.authorId),"reality-beat-not-fresh",`$.realityBeats[${i}].authorId`);add(out,bx.packetSha256!==plan.packet.packetSha256,"packet-digest-mismatch",`$.realityBeats[${i}].packetSha256`);}
  for(const needed of["ENGINEERING","PRODUCT","DESIGN"])add(out,!beats.has(needed),"reality-beat-missing",`$.realityBeats.${needed}`);
  const dissent=new Map();for(const[i,d]of(plan.dissent??[]).entries()){exact(d,DISSENT,`$.dissent[${i}]`,out);dissent.set(d.dissentId,d);add(out,d.packetSha256!==plan.packet.packetSha256,"packet-digest-mismatch",`$.dissent[${i}].packetSha256`);}
  exact(plan.managerSubmission,SUB,"$.managerSubmission",out);const s=plan.managerSubmission;add(out,participants.get(s.managerId)?.role!=="MANAGER","manager-submission-role-invalid","$.managerSubmission.managerId");add(out,s.packetSha256!==plan.packet.packetSha256,"packet-digest-mismatch","$.managerSubmission.packetSha256");add(out,s.decision!==plan.status,"submission-status-mismatch","$.managerSubmission.decision");
  for(const d of dissent.values())if(["OPEN","RETAINED"].includes(d.status))add(out,!s.referencedDissentIds.includes(d.dissentId),"dissent-not-durable",`$.managerSubmission.referencedDissentIds`);
  for(const id of s.referencedDissentIds)add(out,!dissent.has(id),"dissent-reference-invalid","$.managerSubmission.referencedDissentIds");
  for(const[i,c]of(plan.claims??[]).entries()){exact(c,CLAIM,`$.claims[${i}]`,out);add(out,c.truthLabel==="SOURCE_PRESENT"&&!c.evidenceRefs.length,"truth-state-upgrade",`$.claims[${i}]`);add(out,c.truthLabel==="BLOCKED_BY_HALT"&&!c.missingDynamicEvidence.length,"blocked-claim-promoted",`$.claims[${i}]`);}
  return out.sort((a,b)=>(a.code+a.path).localeCompare(b.code+b.path));
}

if(import.meta.url===pathToFileURL(process.argv[1]??"").href){try{const p=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));const findings=audit(p);console.log(JSON.stringify({valid:!findings.length,findings},null,2));process.exitCode=findings.length?1:0;}catch(error){console.error(JSON.stringify({valid:false,error:String(error)}));process.exitCode=2;}}
