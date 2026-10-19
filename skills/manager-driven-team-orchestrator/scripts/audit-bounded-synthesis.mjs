#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const TOP = ["schemaVersion", "mode", "runId", "status", "objective", "packet", "criteriaDigest", "authorityBoundary", "bounds", "participants", "positions", "reviews", "corrections", "realityBeats", "dissent", "managerSubmission", "externalDecisionRef", "claims"];
const PACKET = ["packetId", "repositoryAnchor", "packetSha256", "fileCount", "truthState", "runtimeAuthority", "includedClasses", "excludedClasses"];
const AUTH = ["managerMaySpawn", "managerMayApprove", "recursiveDelegationAllowed", "externalGateRequired"];
const BOUNDS = ["maxRounds", "maxConcurrentContributors", "maxTotalBirths", "maxSpawnDepth", "maxAttemptsPerArtifact", "maxCorrectionAttemptsPerTicket", "deadline", "nativeCapacityCeilings"];
const CAPACITY = ["resource", "unit", "ceiling"];
const PARTICIPANT = ["participantId", "role", "admissionEvidenceRef"];
const POSITION = ["positionId", "authorId", "packetSha256", "artifactDigest", "falsifier"];
const REVIEW = ["reviewId", "reviewerId", "positionId", "packetSha256", "steelman", "unresolvedTension", "critique", "critiqueFalsifier", "narrowAmendment", "ownConcession", "retainedDissent"];
const STEEL = ["thesisMechanism", "evidenceFalsifier", "protectedOutcome"];
const CORR = ["ticketId", "authorId", "packetSha256", "disposition", "claimDelta", "preservedInvariants", "evidenceRefs", "truthLabel", "dissent", "createsRole", "createsAuthority", "createsRuntimeAction", "attempt"];
const BEAT = ["beat", "authorId", "packetSha256", "artifactDigest", "decision", "falsifiers"];
const DISSENT = ["dissentId", "originatorId", "packetSha256", "statementDigest", "status", "evidenceRefs"];
const SUB = ["managerId", "packetSha256", "candidateDigest", "referencedDissentIds", "decision"];
const CLAIM = ["claimId", "truthLabel", "statement", "evidenceRefs", "missingDynamicEvidence"];
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const ROLES = ["POSITION_AUTHOR", "RECIPROCAL_REVIEWER", "MANAGER", "CORRECTION_AUTHOR", "ENGINEERING_BEAT", "PRODUCT_BEAT", "DESIGN_BEAT"];
const STATUSES = ["SUBMIT_FOR_INDEPENDENT_REVIEW", "REWORK_REQUIRED", "BLOCKED"];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectOrEmpty(value) {
  return isObject(value) ? value : {};
}

function exact(value, required, path, findings) {
  if (!isObject(value)) {
    findings.push({ code: "shape-invalid", path });
    return false;
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) findings.push({ code: "required-field-missing", path: `${path}.${key}` });
  }
  const allowed = new Set(required);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) findings.push({ code: "unknown-field", path: `${path}.${key}` });
  }
  return true;
}

function add(findings, condition, code, path, message = "") {
  if (condition) findings.push({ code, path, message });
}

function string(value, path, findings, code = "string-invalid", minLength = 1) {
  add(findings, typeof value !== "string" || value.length < minLength, code, path);
}

function enumValue(value, allowed, path, findings, code = "enum-invalid") {
  add(findings, !allowed.includes(value), code, path);
}

function digest(value, path, findings, code = "digest-invalid") {
  add(findings, typeof value !== "string" || !DIGEST.test(value), code, path);
}

function array(value, path, findings, minItems = 0, code = "array-invalid") {
  if (!Array.isArray(value)) {
    findings.push({ code, path, message: "must be an array" });
    return [];
  }
  if (value.length < minItems) findings.push({ code, path, message: `must contain at least ${minItems} item(s)` });
  return value;
}

function stringItems(values, path, findings, minItems = 0) {
  const list = array(values, path, findings, minItems);
  list.forEach((value, index) => string(value, `${path}[${index}]`, findings));
  return list;
}

function uniqueBy(values, key, path, findings, code) {
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    if (!isObject(value) || typeof value[key] !== "string" || value[key].length === 0) continue;
    const id = value[key];
    if (seen.has(id)) findings.push({ code, path: `${path}[${index}].${key}` });
    else seen.add(id);
  }
}

function validDateTime(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone, offsetHour, offsetMinute] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1]) return false;
  if (zone !== "Z" && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function requireDigestMatch(value, expected, path, findings) {
  add(findings, typeof value !== "string" || value !== expected, "packet-digest-mismatch", path);
}

export function audit(input, { fixtureEvaluationClock } = {}) {
  const findings = [];
  if (!exact(input, TOP, "$", findings)) return findings;

  const plan = input;
  const packet = objectOrEmpty(plan.packet);
  const authority = objectOrEmpty(plan.authorityBoundary);
  const bounds = objectOrEmpty(plan.bounds);
  const submission = objectOrEmpty(plan.managerSubmission);
  exact(plan.packet, PACKET, "$.packet", findings);
  exact(plan.authorityBoundary, AUTH, "$.authorityBoundary", findings);
  exact(plan.bounds, BOUNDS, "$.bounds", findings);
  exact(plan.managerSubmission, SUB, "$.managerSubmission", findings);

  string(plan.runId, "$.runId", findings);
  string(plan.objective, "$.objective", findings);
  enumValue(plan.schemaVersion, ["2.0.0"], "$.schemaVersion", findings, "version-invalid");
  enumValue(plan.mode, ["DESIGN_AUDIT_ONLY"], "$.mode", findings, "runtime-mode-forbidden");
  enumValue(plan.status, STATUSES, "$.status", findings, "status-invalid");
  digest(plan.criteriaDigest, "$.criteriaDigest", findings);
  add(findings, plan.externalDecisionRef !== null && (typeof plan.externalDecisionRef !== "string" || plan.externalDecisionRef.length === 0), "external-decision-ref-invalid", "$.externalDecisionRef");

  string(packet.packetId, "$.packet.packetId", findings);
  string(packet.repositoryAnchor, "$.packet.repositoryAnchor", findings);
  digest(packet.packetSha256, "$.packet.packetSha256", findings, "packet-digest-invalid");
  add(findings, !Number.isInteger(packet.fileCount) || packet.fileCount < 1, "packet-file-count-invalid", "$.packet.fileCount");
  string(packet.truthState, "$.packet.truthState", findings);
  enumValue(packet.runtimeAuthority, ["NONE"], "$.packet.runtimeAuthority", findings, "truth-state-upgrade");
  const includedClasses = stringItems(packet.includedClasses, "$.packet.includedClasses", findings);
  const excludedClasses = stringItems(packet.excludedClasses, "$.packet.excludedClasses", findings);
  for (const [path, list] of [["$.packet.includedClasses", includedClasses], ["$.packet.excludedClasses", excludedClasses]]) {
    if (new Set(list).size !== list.length) findings.push({ code: "packet-class-duplicate", path });
  }

  for (const key of AUTH) add(findings, typeof authority[key] !== "boolean", "authority-flag-invalid", `$.authorityBoundary.${key}`);
  add(findings, authority.managerMaySpawn === true || authority.recursiveDelegationAllowed === true, "manager-runtime-spawn-authority", "$.authorityBoundary");
  add(findings, authority.managerMayApprove === true || authority.externalGateRequired !== true, "manager-self-approval", "$.authorityBoundary");

  add(findings, !Number.isInteger(bounds.maxRounds) || bounds.maxRounds < 1, "unbounded-rounds", "$.bounds.maxRounds");
  add(findings, !Number.isInteger(bounds.maxConcurrentContributors) || bounds.maxConcurrentContributors < 1, "contributor-bound-invalid", "$.bounds.maxConcurrentContributors");
  add(findings, !Number.isInteger(bounds.maxTotalBirths) || bounds.maxTotalBirths < 0, "birth-bound-invalid", "$.bounds.maxTotalBirths");
  add(findings, bounds.maxSpawnDepth !== 0, "recursive-spawn-enabled", "$.bounds.maxSpawnDepth");
  add(findings, !Number.isInteger(bounds.maxAttemptsPerArtifact) || bounds.maxAttemptsPerArtifact < 1, "artifact-attempt-bound-invalid", "$.bounds.maxAttemptsPerArtifact");
  add(findings, bounds.maxCorrectionAttemptsPerTicket !== 1, "correction-unbounded", "$.bounds.maxCorrectionAttemptsPerTicket");
  add(findings, !validDateTime(bounds.deadline), "deadline-invalid", "$.bounds.deadline");
  if (fixtureEvaluationClock !== undefined) {
    add(findings, !validDateTime(fixtureEvaluationClock), "fixture-clock-invalid", "$.fixtureEvaluationClock");
    add(findings, validDateTime(bounds.deadline) && validDateTime(fixtureEvaluationClock) && Date.parse(bounds.deadline) <= Date.parse(fixtureEvaluationClock), "deadline-not-after-fixture-clock", "$.bounds.deadline", "fixture-based static check only");
  }
  const capacities = array(bounds.nativeCapacityCeilings, "$.bounds.nativeCapacityCeilings", findings, 1, "native-capacity-empty");
  const capacityKeys = new Set();
  for (const [index, capacityValue] of capacities.entries()) {
    const path = `$.bounds.nativeCapacityCeilings[${index}]`;
    if (!exact(capacityValue, CAPACITY, path, findings)) continue;
    const capacity = capacityValue;
    string(capacity.resource, `${path}.resource`, findings);
    string(capacity.unit, `${path}.unit`, findings);
    add(findings, typeof capacity.ceiling !== "number" || !Number.isFinite(capacity.ceiling) || capacity.ceiling < 0, "native-capacity-invalid", path);
    const key = `${typeof capacity.resource === "string" ? capacity.resource.trim() : ""}\0${typeof capacity.unit === "string" ? capacity.unit.trim() : ""}`;
    if (capacityKeys.has(key)) findings.push({ code: "native-capacity-duplicate", path });
    capacityKeys.add(key);
  }

  const participantsList = array(plan.participants, "$.participants", findings, 1);
  uniqueBy(participantsList, "participantId", "$.participants", findings, "participant-duplicate");
  const participants = new Map();
  for (const [index, participantValue] of participantsList.entries()) {
    const path = `$.participants[${index}]`;
    if (!exact(participantValue, ["participantId", "role", "admissionEvidenceRef"], path, findings)) continue;
    const participant = participantValue;
    string(participant.participantId, `${path}.participantId`, findings);
    enumValue(participant.role, ROLES, `${path}.role`, findings);
    string(participant.admissionEvidenceRef, `${path}.admissionEvidenceRef`, findings, "birth-without-admission");
    if (typeof participant.participantId === "string" && participant.participantId.length > 0 && !participants.has(participant.participantId)) participants.set(participant.participantId, participant);
  }
  const managers = [...participants.values()].filter((participant) => participant.role === "MANAGER");
  add(findings, managers.length !== 1, "manager-count-invalid", "$.participants");

  const positionsList = array(plan.positions, "$.positions", findings, 2);
  uniqueBy(positionsList, "positionId", "$.positions", findings, "position-duplicate");
  const positions = new Map();
  for (const [index, positionValue] of positionsList.entries()) {
    const path = `$.positions[${index}]`;
    if (!exact(positionValue, POSITION, path, findings)) continue;
    const position = positionValue;
    string(position.positionId, `${path}.positionId`, findings);
    string(position.authorId, `${path}.authorId`, findings);
    digest(position.packetSha256, `${path}.packetSha256`, findings);
    digest(position.artifactDigest, `${path}.artifactDigest`, findings);
    string(position.falsifier, `${path}.falsifier`, findings, "string-invalid", 0);
    add(findings, participants.get(position.authorId)?.role !== "POSITION_AUTHOR", "position-role-invalid", `${path}.authorId`);
    requireDigestMatch(position.packetSha256, packet.packetSha256, `${path}.packetSha256`, findings);
    if (typeof position.positionId === "string" && position.positionId.length > 0 && !positions.has(position.positionId)) positions.set(position.positionId, position);
  }

  add(findings, new Set([...positions.values()].map(p => p.authorId)).size < 2, "position-authors-not-distinct", "$.positions");

  const reviewsList = array(plan.reviews, "$.reviews", findings, 2);
  uniqueBy(reviewsList, "reviewId", "$.reviews", findings, "review-duplicate");
  const reviewed = new Set();
  for (const [index, reviewValue] of reviewsList.entries()) {
    const path = `$.reviews[${index}]`;
    if (!exact(reviewValue, REVIEW, path, findings)) continue;
    const review = reviewValue;
    string(review.reviewId, `${path}.reviewId`, findings);
    string(review.reviewerId, `${path}.reviewerId`, findings);
    string(review.positionId, `${path}.positionId`, findings);
    digest(review.packetSha256, `${path}.packetSha256`, findings);
    const steelmanValid = exact(review.steelman, STEEL, `${path}.steelman`, findings);
    if (steelmanValid) {
      for (const key of STEEL) string(review.steelman[key], `${path}.steelman.${key}`, findings);
      add(findings, Object.values(review.steelman).some((value) => typeof value !== "string" || !value.trim()), "steelmanning-incomplete", `${path}.steelman`);
    }
    for (const key of ["unresolvedTension", "critique", "critiqueFalsifier", "narrowAmendment", "ownConcession", "retainedDissent"]) string(review[key], `${path}.${key}`, findings, "string-invalid", 0);
    const position = positions.get(review.positionId);
    add(findings, !position, "reciprocal-review-target-missing", `${path}.positionId`);
    add(findings, participants.get(review.reviewerId)?.role !== "RECIPROCAL_REVIEWER" || review.reviewerId === position?.authorId, "reciprocal-review-not-independent", `${path}.reviewerId`);
    requireDigestMatch(review.packetSha256, packet.packetSha256, `${path}.packetSha256`, findings);
    reviewed.add(review.positionId);
  }
  for (const id of positions.keys()) add(findings, !reviewed.has(id), "reciprocal-review-missing", `$.positions.${id}`);

  const correctionsList = array(plan.corrections, "$.corrections", findings);
  uniqueBy(correctionsList, "ticketId", "$.corrections", findings, "correction-duplicate");
  for (const [index, correctionValue] of correctionsList.entries()) {
    const path = `$.corrections[${index}]`;
    if (!exact(correctionValue, CORR, path, findings)) continue;
    const correction = correctionValue;
    for (const key of ["ticketId", "authorId", "claimDelta", "dissent"]) string(correction[key], `${path}.${key}`, findings, "string-invalid", key === "claimDelta" || key === "dissent" ? 0 : 1);
    digest(correction.packetSha256, `${path}.packetSha256`, findings);
    requireDigestMatch(correction.packetSha256, packet.packetSha256, `${path}.packetSha256`, findings);
    enumValue(correction.disposition, ["ACCEPT", "REJECT_WITH_EVIDENCE", "CLARIFY"], `${path}.disposition`, findings);
    stringItems(correction.preservedInvariants, `${path}.preservedInvariants`, findings);
    stringItems(correction.evidenceRefs, `${path}.evidenceRefs`, findings);
    enumValue(correction.truthLabel, ["SOURCE_PRESENT", "PROPOSED", "UNKNOWN", "BLOCKED_BY_HALT"], `${path}.truthLabel`, findings);
    add(findings, correction.createsRole !== false || correction.createsAuthority !== false || correction.createsRuntimeAction !== false || correction.attempt !== 1, "correction-broadens-scope", path);
    add(findings, participants.get(correction.authorId)?.role !== "CORRECTION_AUTHOR", "correction-role-invalid", `${path}.authorId`);
  }

  const priorActors = new Set([
    ...positionsList.filter(isObject).map((position) => position.authorId),
    ...reviewsList.filter(isObject).map((review) => review.reviewerId),
    ...correctionsList.filter(isObject).map((correction) => correction.authorId),
    ...managers.map((manager) => manager.participantId),
  ]);
  const beatsList = array(plan.realityBeats, "$.realityBeats", findings, 3);
  const beats = new Set();
  const beatAuthors = new Set();
  const beatRoles = { ENGINEERING: "ENGINEERING_BEAT", PRODUCT: "PRODUCT_BEAT", DESIGN: "DESIGN_BEAT" };
  for (const [index, beatValue] of beatsList.entries()) {
    const path = `$.realityBeats[${index}]`;
    if (!exact(beatValue, BEAT, path, findings)) continue;
    const beat = beatValue;
    enumValue(beat.beat, ["ENGINEERING", "PRODUCT", "DESIGN"], `${path}.beat`, findings);
    string(beat.authorId, `${path}.authorId`, findings);
    digest(beat.packetSha256, `${path}.packetSha256`, findings);
    digest(beat.artifactDigest, `${path}.artifactDigest`, findings);
    string(beat.decision, `${path}.decision`, findings);
    stringItems(beat.falsifiers, `${path}.falsifiers`, findings, 1);
    add(findings, beats.has(beat.beat), "reality-beat-duplicate", `${path}.beat`);
    beats.add(beat.beat);
    add(findings, priorActors.has(beat.authorId), "reality-beat-not-fresh", `${path}.authorId`);
    add(findings, participants.get(beat.authorId)?.role !== beatRoles[beat.beat], "reality-beat-role-invalid", `${path}.authorId`);
    add(findings, beatAuthors.has(beat.authorId), "reality-beat-author-duplicate", `${path}.authorId`);
    beatAuthors.add(beat.authorId);
    requireDigestMatch(beat.packetSha256, packet.packetSha256, `${path}.packetSha256`, findings);
  }
  for (const needed of ["ENGINEERING", "PRODUCT", "DESIGN"]) add(findings, !beats.has(needed), "reality-beat-missing", `$.realityBeats.${needed}`);

  const dissentList = array(plan.dissent, "$.dissent", findings);
  uniqueBy(dissentList, "dissentId", "$.dissent", findings, "dissent-duplicate");
  const dissent = new Map();
  for (const [index, dissentValue] of dissentList.entries()) {
    const path = `$.dissent[${index}]`;
    if (!exact(dissentValue, DISSENT, path, findings)) continue;
    const item = dissentValue;
    for (const key of ["dissentId", "originatorId"]) string(item[key], `${path}.${key}`, findings);
    add(findings, !participants.has(item.originatorId), "dissent-originator-missing", `${path}.originatorId`);
    digest(item.packetSha256, `${path}.packetSha256`, findings);
    digest(item.statementDigest, `${path}.statementDigest`, findings);
    enumValue(item.status, ["OPEN", "INCORPORATED", "RETAINED", "REJECTED_WITH_EVIDENCE", "WITHDRAWN_BY_ORIGINATOR"], `${path}.status`, findings);
    stringItems(item.evidenceRefs, `${path}.evidenceRefs`, findings);
    requireDigestMatch(item.packetSha256, packet.packetSha256, `${path}.packetSha256`, findings);
    if (typeof item.dissentId === "string" && item.dissentId.length > 0 && !dissent.has(item.dissentId)) dissent.set(item.dissentId, item);
  }

  string(submission.managerId, "$.managerSubmission.managerId", findings);
  digest(submission.packetSha256, "$.managerSubmission.packetSha256", findings);
  digest(submission.candidateDigest, "$.managerSubmission.candidateDigest", findings);
  const referencedDissentIds = stringItems(submission.referencedDissentIds, "$.managerSubmission.referencedDissentIds", findings);
  if (new Set(referencedDissentIds).size !== referencedDissentIds.length) findings.push({ code: "dissent-reference-duplicate", path: "$.managerSubmission.referencedDissentIds" });
  enumValue(submission.decision, STATUSES, "$.managerSubmission.decision", findings);
  add(findings, participants.get(submission.managerId)?.role !== "MANAGER", "manager-submission-role-invalid", "$.managerSubmission.managerId");
  requireDigestMatch(submission.packetSha256, packet.packetSha256, "$.managerSubmission.packetSha256", findings);
  add(findings, submission.decision !== plan.status, "submission-status-mismatch", "$.managerSubmission.decision");
  for (const item of dissent.values()) {
    if (["OPEN", "RETAINED"].includes(item.status)) add(findings, !referencedDissentIds.includes(item.dissentId), "dissent-not-durable", "$.managerSubmission.referencedDissentIds");
  }
  for (const id of referencedDissentIds) add(findings, !dissent.has(id), "dissent-reference-invalid", "$.managerSubmission.referencedDissentIds");

  const claimsList = array(plan.claims, "$.claims", findings);
  uniqueBy(claimsList, "claimId", "$.claims", findings, "claim-duplicate");
  for (const [index, claimValue] of claimsList.entries()) {
    const path = `$.claims[${index}]`;
    if (!exact(claimValue, CLAIM, path, findings)) continue;
    const claim = claimValue;
    string(claim.claimId, `${path}.claimId`, findings);
    enumValue(claim.truthLabel, ["SOURCE_PRESENT", "PROPOSED", "UNKNOWN", "BLOCKED_BY_HALT"], `${path}.truthLabel`, findings);
    string(claim.statement, `${path}.statement`, findings);
    const evidenceRefs = stringItems(claim.evidenceRefs, `${path}.evidenceRefs`, findings);
    const missingDynamicEvidence = stringItems(claim.missingDynamicEvidence, `${path}.missingDynamicEvidence`, findings);
    add(findings, claim.truthLabel === "SOURCE_PRESENT" && evidenceRefs.length === 0, "truth-state-upgrade", path);
    add(findings, claim.truthLabel === "BLOCKED_BY_HALT" && missingDynamicEvidence.length === 0, "blocked-claim-promoted", path);
  }

  return findings.sort((a, b) => (a.code + a.path).localeCompare(b.code + b.path));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const plan = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const findings = audit(plan);
    console.log(JSON.stringify({ valid: findings.length === 0, findings }, null, 2));
    process.exitCode = findings.length ? 1 : 0;
  } catch (error) {
    console.error(JSON.stringify({ valid: false, error: String(error) }));
    process.exitCode = 2;
  }
}
