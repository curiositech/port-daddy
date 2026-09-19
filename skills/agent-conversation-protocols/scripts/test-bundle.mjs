#!/usr/bin/env node
import fs from "node:fs";
import { validateTrace } from "./validate-conversation-trace.mjs";

const base=JSON.parse(fs.readFileSync(new URL("../examples/valid-trace.json",import.meta.url),"utf8"));
const clone=()=>structuredClone(base);
const cases=[
  ["valid",()=>clone(),null],
  ["unknown-field",()=>{const x=clone();x.surprise=true;return x},"E_UNKNOWN_FIELD"],
  ["stale-epoch",()=>{const x=clone();x.messages[1].epoch=2;return x},"E_STALE_EPOCH"],
  ["stale-generation",()=>{const x=clone();x.messages[1].senderBodyGeneration=2;return x},"E_STALE_GENERATION"],
  ["sequence-gap",()=>{const x=clone();x.messages[2].senderSequence=9;return x},"E_SEQUENCE_GAP"],
  ["wrong-audience",()=>{const x=clone();x.messages[0].audience=["principal:nobody"];return x},"E_AUDIENCE_SCOPE"],
  ["causation-gap",()=>{const x=clone();x.messages[1].causationId="missing";return x},"E_CAUSATION_GAP"],
  ["expired",()=>{const x=clone();x.messages[0].expiresAt=x.messages[0].observedAt;return x},"E_EXPIRED"],
  ["dynamic-member",()=>{const x=clone();x.gathers[0].membership.push("principal:nobody");return x},"E_GATHER_MEMBERSHIP"],
  ["bad-contributor",()=>{const x=clone();x.messages[1].senderPrincipalRef="principal:author";return x},"E_GATHER_CONTRIBUTION"],
  ["post-terminal",()=>{const x=clone();x.messages[3].kind="RESPONSE";return x},"E_POST_TERMINAL_MESSAGE"],
  ["completed-with-incomplete-gather",()=>{const x=clone();x.messages.splice(1,1);x.messages[1].causationId="m1";x.messages[2].senderSequence=1;return x},"E_GATHER_INCOMPLETE"],
  ["missing-ack",()=>{const x=clone();x.terminal.receivedAcknowledgements=[];return x},"E_ACK_REQUIRED"],
  ["authority-mint",()=>{const x=clone();x.authorityEffect="EXECUTE";return x},"E_AUTHORITY_MINTING"],
  ["truth-mint",()=>{const x=clone();x.truthEffect="VERIFIED";return x},"E_TRUTH_MINTING"]
];
const failures=[];
for (const [name,make,expected] of cases) { const codes=validateTrace(make()).map(x=>x.code); if (expected===null ? codes.length!==0 : !codes.includes(expected)) failures.push({name,expected,codes}); }
console.log(JSON.stringify({valid:failures.length===0,cases:cases.length,failures},null,2));
if (failures.length) process.exitCode=1;
