#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const TOP = ["schemaVersion","protocolId","conversationId","epoch","scope","observedAt","limits","participants","gathers","messages","terminal","truthEffect","authorityEffect"];
const LIMITS = ["maxMessages","deadlineAt"];
const PARTICIPANT = ["principalRef","bodyGeneration","role","audiences"];
const GATHER = ["gatherId","membership","policy","quorum","inputKind","reducer","deadlineAt"];
const MESSAGE = ["messageId","protocolId","conversationId","epoch","senderPrincipalRef","senderBodyGeneration","audience","audienceLabels","scope","senderSequence","kind","correlationId","causationId","payloadType","payloadDigest","observedAt","expiresAt","verificationReceiptRef","gatherId"];
const TERMINAL = ["state","fenceMessageId","requiredAcknowledgements","receivedAcknowledgements","stateDigest","unresolvedParticipants"];
const KINDS = new Set(["REQUEST","RESPONSE","CONTRIBUTION","DISSENT","GATHER_RESULT","CANCEL_REQUEST","TERMINAL_FENCE","ACK"]);
const TERMINALS = new Set(["COMPLETED","BLOCKED","TIMED_OUT","CANCELLED","DISSENT_RECORDED"]);
const POLICIES = new Set(["ALL","QUORUM","FIRST_SUCCESS"]);
const REDUCERS = new Set(["ORDERED_LIST","PRESERVE_DISSENT","FIRST_BY_CANONICAL_ORDER"]);
const digestPattern = /^sha256:[0-9a-f]{64}$/;

function add(errors, code, path) { errors.push({code, path}); }
function object(value, path, errors) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    add(errors, "E_SHAPE", path); return false;
  }
  return true;
}
function exactKeys(value, keys, path, errors) {
  if (!object(value, path, errors)) return false;
  for (const key of keys) if (!(key in value)) add(errors, "E_REQUIRED", path + "." + key);
  for (const key of Object.keys(value)) if (!keys.includes(key)) add(errors, "E_UNKNOWN_FIELD", path + "." + key);
  return true;
}
function string(value, path, errors, allowNull=false) {
  if (allowNull && value === null) return true;
  if (typeof value !== "string" || value.length === 0) { add(errors, "E_TYPE", path); return false; }
  return true;
}
function integer(value, path, errors, min=1, allowNull=false) {
  if (allowNull && value === null) return true;
  if (!Number.isInteger(value) || value < min) { add(errors, "E_TYPE", path); return false; }
  return true;
}
function stringArray(value, path, errors, min=0) {
  if (!Array.isArray(value) || value.length < min || value.some((item) => typeof item !== "string" || item.length === 0)) {
    add(errors, "E_TYPE", path); return false;
  }
  if (new Set(value).size !== value.length) { add(errors, "E_DUPLICATE", path); return false; }
  return true;
}
function timestamp(value, path, errors) {
  if (!string(value, path, errors)) return NaN;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) add(errors, "E_DATE", path);
  return parsed;
}
function digest(value, path, errors) {
  if (typeof value !== "string" || !digestPattern.test(value)) add(errors, "E_DIGEST", path);
}
function sorted(errors) {
  return errors.sort((a,b) => (a.code + a.path).localeCompare(b.code + b.path));
}

export function validateTrace(trace) {
  const errors = [];
  if (!exactKeys(trace, TOP, "$", errors)) return sorted(errors);

  string(trace.schemaVersion, "$.schemaVersion", errors);
  string(trace.protocolId, "$.protocolId", errors);
  string(trace.conversationId, "$.conversationId", errors);
  integer(trace.epoch, "$.epoch", errors);
  string(trace.scope, "$.scope", errors);
  timestamp(trace.observedAt, "$.observedAt", errors);
  if (trace.schemaVersion !== "2.0.0") add(errors, "E_VERSION", "$.schemaVersion");
  if (trace.truthEffect !== "NONE") add(errors, "E_TRUTH_MINTING", "$.truthEffect");
  if (trace.authorityEffect !== "NONE") add(errors, "E_AUTHORITY_MINTING", "$.authorityEffect");

  let globalDeadline = NaN;
  if (exactKeys(trace.limits, LIMITS, "$.limits", errors)) {
    integer(trace.limits.maxMessages, "$.limits.maxMessages", errors);
    globalDeadline = timestamp(trace.limits.deadlineAt, "$.limits.deadlineAt", errors);
  }

  const participants = new Map();
  if (!Array.isArray(trace.participants) || trace.participants.length === 0) {
    add(errors, "E_PARTICIPANTS", "$.participants");
  } else {
    for (const [i, participant] of trace.participants.entries()) {
      const path = "$.participants[" + i + "]";
      if (!exactKeys(participant, PARTICIPANT, path, errors)) continue;
      const principalOK = string(participant.principalRef, path + ".principalRef", errors);
      integer(participant.bodyGeneration, path + ".bodyGeneration", errors);
      string(participant.role, path + ".role", errors);
      stringArray(participant.audiences, path + ".audiences", errors, 1);
      if (principalOK) {
        if (participants.has(participant.principalRef)) add(errors, "E_DUPLICATE_PARTICIPANT", path + ".principalRef");
        else participants.set(participant.principalRef, participant);
      }
    }
  }

  const gathers = new Map();
  if (!Array.isArray(trace.gathers)) {
    add(errors, "E_TYPE", "$.gathers");
  } else {
    for (const [i, gather] of trace.gathers.entries()) {
      const path = "$.gathers[" + i + "]";
      if (!exactKeys(gather, GATHER, path, errors)) continue;
      const idOK = string(gather.gatherId, path + ".gatherId", errors);
      const membershipOK = stringArray(gather.membership, path + ".membership", errors, 1);
      if (membershipOK && gather.membership.some((ref) => !participants.has(ref))) add(errors, "E_GATHER_MEMBERSHIP", path + ".membership");
      if (!POLICIES.has(gather.policy)) add(errors, "E_GATHER_POLICY", path + ".policy");
      if (!REDUCERS.has(gather.reducer)) add(errors, "E_REDUCER", path + ".reducer");
      string(gather.inputKind, path + ".inputKind", errors);
      timestamp(gather.deadlineAt, path + ".deadlineAt", errors);
      if (gather.policy === "QUORUM") {
        if (!Number.isInteger(gather.quorum) || gather.quorum < 1 || (Array.isArray(gather.membership) && gather.quorum > gather.membership.length)) add(errors, "E_GATHER_QUORUM", path + ".quorum");
      } else if (gather.quorum !== null) add(errors, "E_GATHER_QUORUM", path + ".quorum");
      if (gather.policy === "FIRST_SUCCESS" && gather.reducer !== "FIRST_BY_CANONICAL_ORDER") add(errors, "E_NONDETERMINISTIC_REDUCER", path + ".reducer");
      if (idOK) {
        if (gathers.has(gather.gatherId)) add(errors, "E_DUPLICATE_GATHER", path + ".gatherId");
        else gathers.set(gather.gatherId, gather);
      }
    }
  }

  const messages = Array.isArray(trace.messages) ? trace.messages : [];
  if (!Array.isArray(trace.messages)) add(errors, "E_MESSAGES", "$.messages");
  if (Number.isInteger(trace.limits?.maxMessages) && messages.length > trace.limits.maxMessages) add(errors, "E_MESSAGE_LIMIT", "$.messages");

  const ids = new Set();
  const sequences = new Map();
  const acceptedShape = [];
  const fenceIndexes = [];
  const contributions = new Map();

  for (const [i, message] of messages.entries()) {
    const path = "$.messages[" + i + "]";
    if (!exactKeys(message, MESSAGE, path, errors)) continue;
    const messageIdOK = string(message.messageId, path + ".messageId", errors);
    string(message.protocolId, path + ".protocolId", errors);
    string(message.conversationId, path + ".conversationId", errors);
    integer(message.epoch, path + ".epoch", errors);
    const senderOK = string(message.senderPrincipalRef, path + ".senderPrincipalRef", errors);
    integer(message.senderBodyGeneration, path + ".senderBodyGeneration", errors);
    const audienceOK = stringArray(message.audience, path + ".audience", errors, 1);
    const labelOK = stringArray(message.audienceLabels, path + ".audienceLabels", errors, 1);
    string(message.scope, path + ".scope", errors);
    integer(message.senderSequence, path + ".senderSequence", errors);
    string(message.kind, path + ".kind", errors);
    string(message.correlationId, path + ".correlationId", errors, true);
    string(message.causationId, path + ".causationId", errors, true);
    string(message.payloadType, path + ".payloadType", errors);
    digest(message.payloadDigest, path + ".payloadDigest", errors);
    const observed = timestamp(message.observedAt, path + ".observedAt", errors);
    const expires = timestamp(message.expiresAt, path + ".expiresAt", errors);
    string(message.verificationReceiptRef, path + ".verificationReceiptRef", errors);
    string(message.gatherId, path + ".gatherId", errors, true);

    if (messageIdOK) {
      if (ids.has(message.messageId)) add(errors, "E_DUPLICATE_MESSAGE", path + ".messageId");
      else ids.add(message.messageId);
    }
    if (message.protocolId !== trace.protocolId || message.conversationId !== trace.conversationId) add(errors, "E_PROTOCOL_BINDING", path);
    if (message.epoch !== trace.epoch) add(errors, "E_STALE_EPOCH", path + ".epoch");

    const sender = senderOK ? participants.get(message.senderPrincipalRef) : undefined;
    if (!sender) add(errors, "E_UNKNOWN_SENDER", path + ".senderPrincipalRef");
    else if (message.senderBodyGeneration !== sender.bodyGeneration) add(errors, "E_STALE_GENERATION", path + ".senderBodyGeneration");

    const expected = (sequences.get(message.senderPrincipalRef) || 0) + 1;
    if (message.senderSequence !== expected) add(errors, "E_SEQUENCE_GAP", path + ".senderSequence");
    else sequences.set(message.senderPrincipalRef, message.senderSequence);

    if (!audienceOK || message.audience.some((ref) => !participants.has(ref)) || message.scope !== trace.scope) {
      add(errors, "E_AUDIENCE_SCOPE", path);
    } else if (labelOK && message.audience.some((ref) => { const labels = participants.get(ref)?.audiences; return !Array.isArray(labels) || message.audienceLabels.some((label) => !labels.includes(label)); })) {
      add(errors, "E_AUDIENCE_LABEL", path + ".audienceLabels");
    }
    if (!KINDS.has(message.kind)) add(errors, "E_KIND", path + ".kind");
    if (!(observed < expires) || observed > globalDeadline) add(errors, "E_EXPIRED", path + ".expiresAt");

    if (message.causationId !== null) {
      if (message.causationId === message.messageId) add(errors, "E_SELF_CAUSATION", path + ".causationId");
      else if (!ids.has(message.causationId)) add(errors, "E_CAUSATION_GAP", path + ".causationId");
    }

    if (message.gatherId !== null) {
      const gather = gathers.get(message.gatherId);
      if (!gather || !Array.isArray(gather.membership) || !gather.membership.includes(message.senderPrincipalRef) || message.kind !== gather.inputKind) {
        add(errors, "E_GATHER_CONTRIBUTION", path + ".gatherId");
      } else {
        if (observed > Date.parse(gather.deadlineAt)) add(errors, "E_GATHER_DEADLINE", path + ".observedAt");
        const contributionKey = message.gatherId + "|" + message.senderPrincipalRef;
        if (contributions.has(contributionKey)) add(errors, "E_DUPLICATE_GATHER_CONTRIBUTION", path + ".gatherId");
        else contributions.set(contributionKey, message);
      }
    }
    if (message.kind === "TERMINAL_FENCE") fenceIndexes.push(i);
    acceptedShape.push({index:i, message});
  }

  if (!exactKeys(trace.terminal, TERMINAL, "$.terminal", errors)) return sorted(errors);
  if (!TERMINALS.has(trace.terminal.state)) add(errors, "E_TERMINAL", "$.terminal.state");
  string(trace.terminal.fenceMessageId, "$.terminal.fenceMessageId", errors, true);
  stringArray(trace.terminal.requiredAcknowledgements, "$.terminal.requiredAcknowledgements", errors);
  stringArray(trace.terminal.receivedAcknowledgements, "$.terminal.receivedAcknowledgements", errors);
  stringArray(trace.terminal.unresolvedParticipants, "$.terminal.unresolvedParticipants", errors);
  digest(trace.terminal.stateDigest, "$.terminal.stateDigest", errors);

  for (const ref of [...(trace.terminal.requiredAcknowledgements || []), ...(trace.terminal.receivedAcknowledgements || []), ...(trace.terminal.unresolvedParticipants || [])]) {
    if (!participants.has(ref)) add(errors, "E_UNKNOWN_PARTICIPANT_REF", "$.terminal");
  }
  const requiredAcks = Array.isArray(trace.terminal.requiredAcknowledgements) ? trace.terminal.requiredAcknowledgements : [];
  const receivedAcks = Array.isArray(trace.terminal.receivedAcknowledgements) ? trace.terminal.receivedAcknowledgements : [];
  if (receivedAcks.some((ref) => !requiredAcks.includes(ref))) add(errors, "E_ACK_DECLARATION", "$.terminal.receivedAcknowledgements");

  if (fenceIndexes.length !== 1) add(errors, "E_TERMINAL_FENCE", "$.messages");
  const fenceIndex = fenceIndexes[0];
  const fence = messages[fenceIndex];
  if (!fence || fence.messageId !== trace.terminal.fenceMessageId) add(errors, "E_TERMINAL_FENCE", "$.terminal.fenceMessageId");

  const ackSenders = new Set();
  for (const {index, message} of acceptedShape) {
    if (index > fenceIndex && message.kind !== "ACK") add(errors, "E_POST_TERMINAL_MESSAGE", "$.messages[" + index + "]");
    if (message.kind === "ACK") {
      if (index <= fenceIndex || message.causationId !== trace.terminal.fenceMessageId) add(errors, "E_ACK_BINDING", "$.messages[" + index + "]");
      else ackSenders.add(message.senderPrincipalRef);
    }
  }
  for (const ref of receivedAcks) if (!ackSenders.has(ref)) add(errors, "E_ACK_EVIDENCE", "$.terminal.receivedAcknowledgements");

  if (trace.terminal.state === "COMPLETED") {
    if ((trace.terminal.unresolvedParticipants || []).length > 0) add(errors, "E_UNRESOLVED_COMPLETED", "$.terminal.unresolvedParticipants");
    if (requiredAcks.some((ref) => !receivedAcks.includes(ref))) add(errors, "E_ACK_REQUIRED", "$.terminal.receivedAcknowledgements");
    for (const [id, gather] of gathers) {
      const count = [...contributions.values()].filter((message) => message.gatherId === id).length;
      const required = gather.policy === "ALL" ? (Array.isArray(gather.membership) ? gather.membership.length : Infinity) : gather.policy === "QUORUM" ? gather.quorum : 1;
      if (count < required) add(errors, "E_GATHER_INCOMPLETE", "$.gathers." + id);
    }
  }
  return sorted(errors);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    const trace = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const errors = validateTrace(trace);
    console.log(JSON.stringify({valid:errors.length === 0, errors}, null, 2));
    process.exitCode = errors.length ? 1 : 0;
  } catch (error) {
    console.error(JSON.stringify({valid:false,error:String(error)}));
    process.exitCode = 2;
  }
}
