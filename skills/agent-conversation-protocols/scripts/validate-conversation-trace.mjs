#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const TOP = ["schemaVersion","protocolId","conversationId","epoch","scope","observedAt","limits","participants","gathers","messages","terminal","truthEffect","authorityEffect"];
const LIMITS = ["maxMessages","deadlineAt"];
const PARTICIPANT = ["principalRef","bodyGeneration","role","audiences"];
const GATHER = ["gatherId","membership","policy","quorum","inputKind","reducer","deadlineAt"];
const MESSAGE = ["messageId","protocolId","conversationId","epoch","senderPrincipalRef","senderBodyGeneration","audience","scope","senderSequence","kind","correlationId","causationId","payloadType","payloadDigest","observedAt","expiresAt","verificationReceiptRef","gatherId"];
const TERMINAL = ["state","fenceMessageId","requiredAcknowledgements","receivedAcknowledgements","stateDigest","unresolvedParticipants"];
const KINDS = new Set(["REQUEST","RESPONSE","CONTRIBUTION","DISSENT","GATHER_RESULT","CANCEL_REQUEST","TERMINAL_FENCE","ACK"]);
const TERMINALS = new Set(["COMPLETED","BLOCKED","TIMED_OUT","CANCELLED","DISSENT_RECORDED"]);

function exactKeys(value, keys, path, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) { errors.push({code:"E_SHAPE",path}); return; }
  for (const key of keys) if (!(key in value)) errors.push({code:"E_REQUIRED",path:`${path}.${key}`});
  for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push({code:"E_UNKNOWN_FIELD",path:`${path}.${key}`});
}
function unique(values) { return new Set(values).size === values.length; }
function isDigest(v) { return /^sha256:[0-9a-f]{64}$/.test(v ?? ""); }
function date(v) { const n=Date.parse(v); return Number.isFinite(n) ? n : NaN; }

export function validateTrace(trace) {
  const errors=[];
  exactKeys(trace,TOP,"$",errors);
  if (errors.length) return errors;
  exactKeys(trace.limits,LIMITS,"$.limits",errors);
  if (trace.schemaVersion!=="2.0.0") errors.push({code:"E_VERSION",path:"$.schemaVersion"});
  if (!Number.isInteger(trace.epoch)||trace.epoch<1) errors.push({code:"E_EPOCH",path:"$.epoch"});
  if (!Number.isInteger(trace.limits?.maxMessages)||trace.limits.maxMessages<1) errors.push({code:"E_LIMIT",path:"$.limits.maxMessages"});
  if (!Array.isArray(trace.participants)||trace.participants.length===0) errors.push({code:"E_PARTICIPANTS",path:"$.participants"});
  const participants=new Map();
  for (const [i,p] of (trace.participants??[]).entries()) {
    exactKeys(p,PARTICIPANT,`$.participants[${i}]`,errors);
    if (participants.has(p.principalRef)) errors.push({code:"E_DUPLICATE_PARTICIPANT",path:`$.participants[${i}].principalRef`});
    participants.set(p.principalRef,p);
    if (!Number.isInteger(p.bodyGeneration)||p.bodyGeneration<1) errors.push({code:"E_GENERATION",path:`$.participants[${i}].bodyGeneration`});
    if (!Array.isArray(p.audiences)||p.audiences.length===0||!unique(p.audiences)) errors.push({code:"E_AUDIENCES",path:`$.participants[${i}].audiences`});
  }
  const gathers=new Map();
  for (const [i,g] of (trace.gathers??[]).entries()) {
    exactKeys(g,GATHER,`$.gathers[${i}]`,errors);
    if (gathers.has(g.gatherId)) errors.push({code:"E_DUPLICATE_GATHER",path:`$.gathers[${i}].gatherId`});
    gathers.set(g.gatherId,g);
    if (!Array.isArray(g.membership)||!g.membership.length||!unique(g.membership)||g.membership.some(x=>!participants.has(x))) errors.push({code:"E_GATHER_MEMBERSHIP",path:`$.gathers[${i}].membership`});
    if (g.policy==="QUORUM" && (!Number.isInteger(g.quorum)||g.quorum<1||g.quorum>g.membership.length)) errors.push({code:"E_GATHER_QUORUM",path:`$.gathers[${i}].quorum`});
    if (g.policy!=="QUORUM" && g.quorum!==null) errors.push({code:"E_GATHER_QUORUM",path:`$.gathers[${i}].quorum`});
    if (g.policy==="FIRST_SUCCESS" && g.reducer!=="FIRST_BY_CANONICAL_ORDER") errors.push({code:"E_NONDETERMINISTIC_REDUCER",path:`$.gathers[${i}].reducer`});
  }
  if (!Array.isArray(trace.messages)) errors.push({code:"E_MESSAGES",path:"$.messages"});
  if ((trace.messages??[]).length>trace.limits.maxMessages) errors.push({code:"E_MESSAGE_LIMIT",path:"$.messages"});
  const ids=new Set(), seq=new Map(), fenceIndexes=[];
  for (const [i,m] of (trace.messages??[]).entries()) {
    exactKeys(m,MESSAGE,`$.messages[${i}]`,errors);
    if (ids.has(m.messageId)) errors.push({code:"E_DUPLICATE_MESSAGE",path:`$.messages[${i}].messageId`});
    ids.add(m.messageId);
    if (m.protocolId!==trace.protocolId||m.conversationId!==trace.conversationId) errors.push({code:"E_PROTOCOL_BINDING",path:`$.messages[${i}]`});
    if (m.epoch!==trace.epoch) errors.push({code:"E_STALE_EPOCH",path:`$.messages[${i}].epoch`});
    const p=participants.get(m.senderPrincipalRef);
    if (!p) errors.push({code:"E_UNKNOWN_SENDER",path:`$.messages[${i}].senderPrincipalRef`});
    else if (m.senderBodyGeneration!==p.bodyGeneration) errors.push({code:"E_STALE_GENERATION",path:`$.messages[${i}].senderBodyGeneration`});
    const expected=(seq.get(m.senderPrincipalRef)??0)+1;
    if (m.senderSequence!==expected) errors.push({code:"E_SEQUENCE_GAP",path:`$.messages[${i}].senderSequence`}); else seq.set(m.senderPrincipalRef,m.senderSequence);
    if (!Array.isArray(m.audience)||!m.audience.length||!unique(m.audience)||m.audience.some(x=>!participants.has(x))||m.scope!==trace.scope) errors.push({code:"E_AUDIENCE_SCOPE",path:`$.messages[${i}]`});
    if (!KINDS.has(m.kind)) errors.push({code:"E_KIND",path:`$.messages[${i}].kind`});
    if (!isDigest(m.payloadDigest)) errors.push({code:"E_DIGEST",path:`$.messages[${i}].payloadDigest`});
    if (!m.verificationReceiptRef) errors.push({code:"E_VERIFICATION_REF",path:`$.messages[${i}].verificationReceiptRef`});
    if (!(date(m.observedAt)<date(m.expiresAt))||date(m.observedAt)>date(trace.limits.deadlineAt)) errors.push({code:"E_EXPIRED",path:`$.messages[${i}].expiresAt`});
    if (m.causationId!==null&&!ids.has(m.causationId)) errors.push({code:"E_CAUSATION_GAP",path:`$.messages[${i}].causationId`});
    if (m.gatherId!==null) { const g=gathers.get(m.gatherId); if (!g||!g.membership.includes(m.senderPrincipalRef)||m.kind!==g.inputKind) errors.push({code:"E_GATHER_CONTRIBUTION",path:`$.messages[${i}].gatherId`}); }
    if (m.kind==="TERMINAL_FENCE") fenceIndexes.push(i);
  }
  exactKeys(trace.terminal,TERMINAL,"$.terminal",errors);
  if (!TERMINALS.has(trace.terminal?.state)) errors.push({code:"E_TERMINAL",path:"$.terminal.state"});
  if (fenceIndexes.length!==1) errors.push({code:"E_TERMINAL_FENCE",path:"$.messages"});
  const fenceIndex=fenceIndexes[0], fence=(trace.messages??[])[fenceIndex];
  if (fence?.messageId!==trace.terminal?.fenceMessageId) errors.push({code:"E_TERMINAL_FENCE",path:"$.terminal.fenceMessageId"});
  for (let i=(fenceIndex??trace.messages?.length??0)+1;i<(trace.messages??[]).length;i++) if (trace.messages[i].kind!=="ACK") errors.push({code:"E_POST_TERMINAL_MESSAGE",path:`$.messages[${i}]`});
  const ackSenders=new Set((trace.messages??[]).filter(m=>m.kind==="ACK"&&m.causationId===trace.terminal?.fenceMessageId).map(m=>m.senderPrincipalRef));
  if ((trace.terminal?.receivedAcknowledgements??[]).some(x=>!ackSenders.has(x))) errors.push({code:"E_ACK_EVIDENCE",path:"$.terminal.receivedAcknowledgements"});
  if (trace.terminal?.state==="COMPLETED") {
    if ((trace.terminal.requiredAcknowledgements??[]).some(x=>!trace.terminal.receivedAcknowledgements.includes(x))) errors.push({code:"E_ACK_REQUIRED",path:"$.terminal.receivedAcknowledgements"});
    for (const [gatherId,gather] of gathers) {
      const contributors=new Set((trace.messages??[]).filter(m=>m.gatherId===gatherId&&m.kind===gather.inputKind).map(m=>m.senderPrincipalRef));
      const required=gather.policy==="ALL"?gather.membership.length:gather.policy==="QUORUM"?gather.quorum:1;
      if (contributors.size<required) errors.push({code:"E_GATHER_INCOMPLETE",path:`$.gathers.${gatherId}`});
    }
  }
  if (!isDigest(trace.terminal?.stateDigest)) errors.push({code:"E_DIGEST",path:"$.terminal.stateDigest"});
  if (trace.truthEffect!=="NONE") errors.push({code:"E_TRUTH_MINTING",path:"$.truthEffect"});
  if (trace.authorityEffect!=="NONE") errors.push({code:"E_AUTHORITY_MINTING",path:"$.authorityEffect"});
  return errors.sort((a,b)=>(a.code+a.path).localeCompare(b.code+b.path));
}

if (import.meta.url===pathToFileURL(process.argv[1]??"").href) {
  try { const trace=JSON.parse(fs.readFileSync(process.argv[2],"utf8")); const errors=validateTrace(trace); console.log(JSON.stringify({valid:errors.length===0,errors},null,2)); process.exitCode=errors.length?1:0; }
  catch (error) { console.error(JSON.stringify({valid:false,error:String(error)})); process.exitCode=2; }
}
