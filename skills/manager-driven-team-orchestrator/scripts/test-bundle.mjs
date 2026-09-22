#!/usr/bin/env node
import fs from "node:fs";import{audit}from"./audit-bounded-synthesis.mjs";
const base=JSON.parse(fs.readFileSync(new URL("../examples/valid-static-cycle.json",import.meta.url),"utf8"));const clone=()=>structuredClone(base);
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
 ["blocked-no-gap",()=>{const x=clone();x.claims[0].missingDynamicEvidence=[];return x},"blocked-claim-promoted"]
];
const failures=[];for(const[name,make,expected]of cases){const codes=audit(make()).map(x=>x.code);if(expected===null?codes.length!==0:!codes.includes(expected))failures.push({name,expected,codes});}console.log(JSON.stringify({valid:!failures.length,cases:cases.length,failures},null,2));if(failures.length)process.exitCode=1;
