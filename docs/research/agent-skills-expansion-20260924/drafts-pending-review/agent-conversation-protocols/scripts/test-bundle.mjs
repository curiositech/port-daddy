#!/usr/bin/env node
import fs from "node:fs";
import { validateTrace } from "./validate-conversation-trace.mjs";

const base = JSON.parse(fs.readFileSync(new URL("../examples/valid-trace.json", import.meta.url), "utf8"));
const clone = () => structuredClone(base);
const cases = [];
function add(name, mutate, expected) { cases.push([name, mutate, expected]); }

add("valid", () => clone(), []);
add("state-digest-is-format-only", () => { const x=clone(); x.terminal.stateDigest="sha256:"+"f".repeat(64); return x; }, []);
add("self-causation", () => { const x=clone(); x.messages[1].causationId="m2"; return x; }, ["E_SELF_CAUSATION"]);
add("forward-causation", () => { const x=clone(); x.messages[0].causationId="m3"; return x; }, ["E_CAUSATION_GAP"]);
add("empty-message-id", () => { const x=clone(); x.messages[3].messageId=""; return x; }, ["E_TYPE"]);
add("invalid-global-deadline", () => { const x=clone(); x.limits.deadlineAt="not-a-date"; return x; }, ["E_DATE"]);
add("invalid-observation-time", () => { const x=clone(); x.observedAt="not-a-date"; return x; }, ["E_DATE"]);
add("late-gather-contribution", () => { const x=clone(); x.messages[1].observedAt="2026-09-16T18:40:00.000Z"; x.messages[1].expiresAt="2026-09-16T18:50:00.000Z"; return x; }, ["E_GATHER_DEADLINE"]);
add("completed-with-unresolved", () => { const x=clone(); x.terminal.unresolvedParticipants=["principal:reviewer"]; return x; }, ["E_UNRESOLVED_COMPLETED"]);
add("duplicate-declared-ack", () => { const x=clone(); x.terminal.receivedAcknowledgements.push("principal:reviewer"); return x; }, ["E_DUPLICATE"]);
add("unknown-acknowledgement", () => { const x=clone(); x.terminal.requiredAcknowledgements.push("principal:unknown"); x.terminal.receivedAcknowledgements.push("principal:unknown"); return x; }, ["E_UNKNOWN_PARTICIPANT_REF"]);
add("wrong-audience-label", () => { const x=clone(); x.participants[1].audiences=["another-label"]; return x; }, ["E_AUDIENCE_LABEL"]);
add("nonstring-verification", () => { const x=clone(); x.messages[0].verificationReceiptRef={present:true}; return x; }, ["E_TYPE"]);
add("null-participant", () => { const x=clone(); x.participants[0]=null; return x; }, ["E_SHAPE"]);
add("non-array-messages", () => { const x=clone(); x.messages={}; return x; }, ["E_MESSAGES"]);
add("null-terminal", () => { const x=clone(); x.terminal=null; return x; }, ["E_SHAPE"]);
add("wrong-top-string-type", () => { const x=clone(); x.protocolId=9; return x; }, ["E_TYPE"]);
add("fractional-epoch", () => { const x=clone(); x.epoch=1.5; return x; }, ["E_TYPE"]);
add("null-limits", () => { const x=clone(); x.limits=null; return x; }, ["E_SHAPE"]);
add("null-gather", () => { const x=clone(); x.gathers[0]=null; return x; }, ["E_SHAPE"]);
add("null-message", () => { const x=clone(); x.messages[0]=null; return x; }, ["E_SHAPE"]);
add("non-array-audience", () => { const x=clone(); x.messages[0].audience="principal:reviewer"; return x; }, ["E_TYPE"]);
add("unknown-field", () => { const x=clone(); x.surprise=true; return x; }, ["E_UNKNOWN_FIELD"]);
add("unknown-message-kind", () => { const x=clone(); x.messages[1].kind="VOTE"; return x; }, ["E_KIND"]);
add("duplicate-message", () => { const x=clone(); x.messages[3].messageId="m3"; return x; }, ["E_DUPLICATE_MESSAGE"]);
add("post-terminal-message", () => { const x=clone(); x.messages[3].kind="RESPONSE"; return x; }, ["E_POST_TERMINAL_MESSAGE"]);
add("ack-not-caused-by-fence", () => { const x=clone(); x.messages[3].causationId="m2"; return x; }, ["E_ACK_BINDING"]);
add("completed-incomplete-gather", () => { const x=clone(); x.messages[1].gatherId=null; return x; }, ["E_GATHER_INCOMPLETE"]);
add("bad-gather-policy", () => { const x=clone(); x.gathers[0].policy="ANY"; return x; }, ["E_GATHER_POLICY"]);
add("bad-gather-reducer", () => { const x=clone(); x.gathers[0].reducer="COUNT"; return x; }, ["E_REDUCER"]);
add("first-success-reducer", () => { const x=clone(); x.gathers[0].policy="FIRST_SUCCESS"; x.gathers[0].reducer="ORDERED_LIST"; return x; }, ["E_NONDETERMINISTIC_REDUCER"]);
add("bad-quorum", () => { const x=clone(); x.gathers[0].policy="QUORUM"; x.gathers[0].quorum=2; return x; }, ["E_GATHER_QUORUM"]);
add("authority-mint", () => { const x=clone(); x.authorityEffect="EXECUTE"; return x; }, ["E_AUTHORITY_MINTING"]);
add("truth-mint", () => { const x=clone(); x.truthEffect="VERIFIED"; return x; }, ["E_TRUTH_MINTING"]);

for (const field of ["schemaVersion","protocolId","conversationId","epoch","scope","observedAt","limits","participants","gathers","messages","terminal","truthEffect","authorityEffect"]) {
  add("required-top-"+field, () => { const x=clone(); delete x[field]; return x; }, ["E_REQUIRED"]);
}
for (const field of ["principalRef","bodyGeneration","role","audiences"]) {
  add("required-participant-"+field, () => { const x=clone(); delete x.participants[0][field]; return x; }, ["E_REQUIRED"]);
}
for (const field of ["gatherId","membership","policy","quorum","inputKind","reducer","deadlineAt"]) {
  add("required-gather-"+field, () => { const x=clone(); delete x.gathers[0][field]; return x; }, ["E_REQUIRED"]);
}
for (const field of ["messageId","protocolId","conversationId","epoch","senderPrincipalRef","senderBodyGeneration","audience","audienceLabels","scope","senderSequence","kind","correlationId","causationId","payloadType","payloadDigest","observedAt","expiresAt","verificationReceiptRef","gatherId"]) {
  add("required-message-"+field, () => { const x=clone(); delete x.messages[0][field]; return x; }, ["E_REQUIRED"]);
}
for (const field of ["state","fenceMessageId","requiredAcknowledgements","receivedAcknowledgements","stateDigest","unresolvedParticipants"]) {
  add("required-terminal-"+field, () => { const x=clone(); delete x.terminal[field]; return x; }, ["E_REQUIRED"]);
}

const failures = [];
for (const [name, make, expected] of cases) {
  let codes;
  try { codes = validateTrace(make()).map((issue) => issue.code); }
  catch (error) { failures.push({name, crashed:String(error)}); continue; }
  const missing = expected.filter((code) => !codes.includes(code));
  const unexpectedValid = expected.length === 0 && codes.length !== 0;
  if (missing.length || unexpectedValid) failures.push({name, expected, codes, missing});
}
console.log(JSON.stringify({valid:failures.length===0,cases:cases.length,failures}, null, 2));
if (failures.length) process.exitCode=1;
