#!/usr/bin/env node
import fs from"node:fs";import{validateSession}from"./validate-discourse-session.mjs";const base=JSON.parse(fs.readFileSync(new URL("../examples/valid-peer-session.json",import.meta.url),"utf8"));const clone=()=>structuredClone(base);
const cases=[
 ["valid",()=>clone(),null],
 ["unknown",()=>{const x=clone();x.diagnosis="x";return x},"E_UNKNOWN_FIELD"],
 ["no-consent",()=>{const x=clone();x.participants[0].consent="NO";return x},"E_SAFETY_CONTINUED"],
 ["withdrawal",()=>{const x=clone();x.participants[0].withdrawal="KNOWN_PENALTY";return x},"E_SAFETY_CONTINUED"],
 ["hierarchy",()=>{const x=clone();x.participants[0].standing="IMBALANCED";return x},"E_AUTHORITY_CONTINUED"],
 ["mode-consent",()=>{const x=clone();x.mode.consentParticipantIds=["alice"];return x},"E_MODE_CONSENT"],
 ["wrong-mode",()=>{const x=clone();x.mode.kind="DIALOGUE";return x},"E_MODE_MISMATCH"],
 ["critique-no-steelman",()=>{const x=clone();x.steelmanCertificates[0].holderVerdict="REPAIR_REQUESTED";return x},"E_CRITIQUE_BEFORE_STEELMAN"],
 ["repair-skip",()=>{const x=clone();x.steelmanCertificates[0].attempt=2;return x},"E_STEELMAN_REPAIR_REQUIRED"],
 ["third-round",()=>{const x=clone();x.exchangeRounds.push({...x.exchangeRounds[0],roundNumber:2},{...x.exchangeRounds[0],roundNumber:2});return x},"E_ROUND_LIMIT"],
 ["majority",()=>{const x=clone();x.terminal.assent[1].status="DISSENT";return x},"E_UNANIMOUS_ASSENT_REQUIRED"],
 ["dissent-missing",()=>{const x=clone();x.terminal.state="DISSENT_RECORDED";return x},"E_DISSENT_REQUIRED"],
 ["bad-faith-alleged",()=>{const x=clone();x.terminal.state="TERMINATED_BAD_FAITH";x.integrityEvents=[{eventId:"e",participantId:"bob",code:"FABRICATED_LOCATOR",evidenceRefs:[],status:"ALLEGED",disposition:"OPEN",motiveClaimed:false}];return x},"E_BAD_FAITH_BASIS_REQUIRED"],
 ["motive",()=>{const x=clone();x.integrityEvents=[{eventId:"e",participantId:"bob",code:"OTHER_PROTOCOL_VIOLATION",evidenceRefs:[],status:"ALLEGED",disposition:"OPEN",motiveClaimed:true}];return x},"E_MOTIVE_CLAIM"],
 ["authority",()=>{const x=clone();x.authorityEffect="DECIDE";return x},"E_AUTHORITY_MINTING"],
 ["truth",()=>{const x=clone();x.truthEffect="VERIFIED";return x},"E_TRUTH_MINTING"]
];const failures=[];for(const[name,make,expected]of cases){const codes=validateSession(make()).map(x=>x.code);if(expected===null?codes.length!==0:!codes.includes(expected))failures.push({name,expected,codes});}console.log(JSON.stringify({valid:!failures.length,cases:cases.length,failures},null,2));if(failures.length)process.exitCode=1;
