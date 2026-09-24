#!/usr/bin/env node
import fs from "node:fs";import{audit}from"./audit-bounded-synthesis.mjs";
const base=JSON.parse(fs.readFileSync(new URL("../examples/valid-static-cycle.json",import.meta.url),"utf8"));const schema=JSON.parse(fs.readFileSync(new URL("../schemas/bounded-synthesis-v2.schema.json",import.meta.url),"utf8"));const clone=()=>structuredClone(base);const fixtureEvaluationClock="2026-09-16T00:00:00.000Z";
const makeCorrection=(x,ticketId)=>({ticketId,authorId:"p1",packetSha256:x.packet.packetSha256,disposition:"ACCEPT",claimDelta:"bounded update",preservedInvariants:[],evidenceRefs:[],truthLabel:"PROPOSED",dissent:"",createsRole:false,createsAuthority:false,createsRuntimeAction:false,attempt:1});
const cases=[
 ["valid",()=>clone(),null],
 ["unknown",()=>{const x=clone();x.ship=true;return x},"unknown-field"],
 ["manager-spawn",()=>{const x=clone();x.authorityBoundary.managerMaySpawn=true;return x},"manager-runtime-spawn-authority"],
 ["manager-approve",()=>{const x=clone();x.authorityBoundary.managerMayApprove=true;return x},"manager-self-approval"],
 ["recursive",()=>{const x=clone();x.bounds.maxSpawnDepth=1;return x},"recursive-spawn-enabled"],
 ["bad concurrency bound",()=>{const x=clone();x.bounds.maxConcurrentContributors=-1;return x},"contributor-bound-invalid"],
 ["bad birth bound",()=>{const x=clone();x.bounds.maxTotalBirths=-99;return x},"birth-bound-invalid"],
 ["bad artifact attempt bound",()=>{const x=clone();x.bounds.maxAttemptsPerArtifact=0;return x},"artifact-attempt-bound-invalid"],
 ["bad deadline",()=>{const x=clone();x.bounds.deadline="eventually";return x},"deadline-invalid"],
 ["expired deadline",()=>{const x=clone();x.bounds.deadline="2026-09-15T23:59:59.000Z";return x},"deadline-not-after-fixture-clock"],
 ["equal deadline",()=>{const x=clone();x.bounds.deadline=fixtureEvaluationClock;return x},"deadline-not-after-fixture-clock"],
 ["before deadline",()=>{const x=clone();x.bounds.deadline="2026-09-15T00:00:00.000Z";return x},"deadline-not-after-fixture-clock"],
 ["empty capacity ceilings",()=>{const x=clone();x.bounds.nativeCapacityCeilings=[];return x},"native-capacity-empty"],
 ["invalid capacity ceiling",()=>{const x=clone();x.bounds.nativeCapacityCeilings[0].ceiling=Number.POSITIVE_INFINITY;return x},"native-capacity-invalid"],
 ["birth",()=>{const x=clone();x.participants[0].admissionEvidenceRef="";return x},"birth-without-admission"],
 ["packet-drift",()=>{const x=clone();x.positions[0].packetSha256=x.criteriaDigest;return x},"packet-digest-mismatch"],
 ["missing-review",()=>{const x=clone();x.reviews=x.reviews.filter(r=>r.positionId!=="pos1");return x},"reciprocal-review-missing"],
 ["bad-steelman",()=>{const x=clone();x.reviews[0].steelman.protectedOutcome="";return x},"steelmanning-incomplete"],
 ["correction-role",()=>{const x=clone();x.corrections=[{ticketId:"t",authorId:"p1",packetSha256:x.packet.packetSha256,disposition:"ACCEPT",claimDelta:"x",preservedInvariants:[],evidenceRefs:[],truthLabel:"PROPOSED",dissent:"",createsRole:true,createsAuthority:false,createsRuntimeAction:false,attempt:1}];return x},"correction-broadens-scope"],
 ["stale-beat",()=>{const x=clone();x.realityBeats[0].authorId="p1";return x},"reality-beat-not-fresh"],
 ["wrong beat role",()=>{const x=clone();x.participants.push({participantId:"e2",role:"ENGINEERING_BEAT",admissionEvidenceRef:"admit:e2"});x.realityBeats[1].authorId="e2";return x},"reality-beat-role-invalid"],
 ["same author for multiple beats",()=>{const x=clone();x.realityBeats[1].authorId="e1";return x},"reality-beat-author-duplicate"],
 ["missing-beat",()=>{const x=clone();x.realityBeats.pop();return x},"reality-beat-missing"],
 ["hide-dissent",()=>{const x=clone();x.managerSubmission.referencedDissentIds=[];return x},"dissent-not-durable"],
 ["status-drift",()=>{const x=clone();x.managerSubmission.decision="BLOCKED";return x},"submission-status-mismatch"],
 ["source-no-evidence",()=>{const x=clone();x.claims[0].truthLabel="SOURCE_PRESENT";x.claims[0].missingDynamicEvidence=[];return x},"truth-state-upgrade"],
 ["blocked-no-gap",()=>{const x=clone();x.claims[0].missingDynamicEvidence=[];return x},"blocked-claim-promoted"],
 ["participants-not-array",()=>{const x=clone();x.participants={};return x},"array-invalid"],
 ["packet-null",()=>{const x=clone();x.packet=null;return x},"shape-invalid"],
 ["null-review-item",()=>{const x=clone();x.reviews[0]=null;return x},"shape-invalid"],
 ["manager-approval-enum",()=>{const x=clone();x.status="APPROVED";x.managerSubmission.decision="APPROVED";return x},"status-invalid"],
 ["noninteger-packet-file-count",()=>{const x=clone();x.packet.fileCount="x";return x},"packet-file-count-invalid"],
 ["invalid-packet-digest",()=>{const x=clone();x.packet.packetSha256="sha256:bad";return x},"packet-digest-invalid"],
 ["duplicate-position-id",()=>{const x=clone();x.positions[1].positionId=x.positions[0].positionId;return x},"position-duplicate"],
 ["duplicate-review-id",()=>{const x=clone();x.reviews[1].reviewId=x.reviews[0].reviewId;return x},"review-duplicate"],
 ["duplicate-correction-ticket",()=>{const x=clone();x.corrections=[makeCorrection(x,"ticket-a"),makeCorrection(x,"ticket-a")];return x},"correction-duplicate"],
 ["duplicate-dissent-id",()=>{const x=clone();x.dissent.push(structuredClone(x.dissent[0]));return x},"dissent-duplicate"],
 ["duplicate-claim-id",()=>{const x=clone();x.claims.push(structuredClone(x.claims[0]));return x},"claim-duplicate"],
 ["empty-included-class",()=>{const x=clone();x.packet.includedClasses=[""];return x},"string-invalid"],
 ["invalid-role-enum",()=>{const x=clone();x.participants[0].role="MANAGERISH";return x},"enum-invalid"],
 ["invalid-external-decision-reference",()=>{const x=clone();x.externalDecisionRef=7;return x},"external-decision-ref-invalid"],
 ["same-position-author",()=>{const x=clone();x.positions[1].authorId=x.positions[0].authorId;return x},"position-authors-not-distinct"],
 ["missing-dissent-originator",()=>{const x=clone();x.dissent[0].originatorId="missing";return x},"dissent-originator-missing"],
 ["null-submission",()=>{const x=clone();x.managerSubmission=null;return x},"shape-invalid"]
];
const failures=[];
const schemaRefs=[];
function collectRefs(value){if(Array.isArray(value)){for(const item of value)collectRefs(item);return;}if(!value||typeof value!=="object")return;if(typeof value.$ref==="string"&&value.$ref.startsWith("#/$defs/"))schemaRefs.push(value.$ref.slice("#/$defs/".length));for(const child of Object.values(value))collectRefs(child);}
collectRefs(schema);
for(const ref of schemaRefs)if(!Object.hasOwn(schema.$defs??{},ref))failures.push({name:"schema-unresolved-ref",ref});
for(const required of ["packet","authority","bounds","participant","position","review","correction","beat","dissent","submission","claim","digest"])if(!Object.hasOwn(schema.$defs??{},required))failures.push({name:"schema-required-definition-missing",required});
if(schema.$defs?.packet?.properties?.fileCount?.type!=="integer")failures.push({name:"schema-fileCount-must-be-integer"});
if(!schema.properties?.status?.enum?.includes("SUBMIT_FOR_INDEPENDENT_REVIEW")||schema.properties?.status?.enum?.includes("APPROVED"))failures.push({name:"schema-status-enum-invalid"});
for(const[name,make,expected]of cases){let codes;try{codes=audit(make(),{fixtureEvaluationClock}).map(x=>x.code);}catch(error){failures.push({name,expected,threw:String(error)});continue;}if(expected===null?codes.length!==0:!codes.includes(expected))failures.push({name,expected,codes});}console.log(JSON.stringify({valid:!failures.length,cases:cases.length,fixtureEvaluationClock,failures},null,2));if(failures.length)process.exitCode=1;
