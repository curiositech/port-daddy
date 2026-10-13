#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const TOP = ["schemaVersion", "evaluationId", "proposition", "subject", "repositoryAnchor", "policyDigest", "truthState", "environment", "haltObserved", "roles", "model", "schedule", "faults", "evidence", "oracle", "negativeControls", "resultVector", "replay", "promotion", "runtimeAuthority", "truthEffect"];
const ROLE_KEYS = ["scheduler", "subject", "recorder", "oracle", "adjudicator"];
const ROLE = ["id", "controlDomain"];
const MODEL = ["modelId", "revision", "correspondence", "exclusions"];
const CORR = ["realMechanism", "modeledSubstitute", "contractRef", "knownMismatch", "falsifier"];
const SCHEDULE = ["digest", "virtualClock", "seed", "interleaving"];
const FAULTS = ["envelopeDigest", "faultIds"];
const EVIDENCE = ["rawManifestDigest", "rawTraceDigest", "committedBeforeMinimization", "guestSoleWitness"];
const ORACLE = ["oracleId", "revision", "predicateIds", "mutationTotal", "mutationKilled"];
const CONTROL = ["controlId", "manifestDeclared", "expectedPredicate", "observedPredicate"];
const RESULT = ["axis", "evidenceClass", "status", "evidenceRefs", "limitation"];
const REPLAY = ["semanticProjectionRef", "rawPredicate", "minimizedTraceDigest", "minimizedPredicate", "samePredicate"];
const TRUTH_STATES = new Set(["T0_STATIC", "T1_MODEL", "T2_SHADOW", "T3_CANARY"]);
const RESULT_STATUSES = new Set(["PASS", "FAIL", "INCOMPLETE", "UNKNOWN", "BLOCKED_BY_HALT"]);
const EVIDENCE_CLASSES = new Set(["STATIC", "MODEL", "RUNTIME", "HUMAN"]);

function add(errors, condition, code, path) { if (condition) errors.push({ code, path }); }
function exact(value, fields, path, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) { errors.push({ code: "E_SHAPE", path }); return; }
  for (const field of fields) add(errors, !(field in value), "E_REQUIRED", `${path}.${field}`);
  for (const field of Object.keys(value)) add(errors, !fields.includes(field), "E_UNKNOWN_FIELD", `${path}.${field}`);
}

export function validateEvaluation(record) {
  const errors = [];
  exact(record, TOP, "$", errors);
  if (errors.length) return errors;
  exact(record.roles, ROLE_KEYS, "$.roles", errors);
  exact(record.model, MODEL, "$.model", errors);
  exact(record.schedule, SCHEDULE, "$.schedule", errors);
  exact(record.faults, FAULTS, "$.faults", errors);
  exact(record.evidence, EVIDENCE, "$.evidence", errors);
  exact(record.oracle, ORACLE, "$.oracle", errors);
  exact(record.replay, REPLAY, "$.replay", errors);
  add(errors, record.schemaVersion !== "1.0.0", "E_VERSION", "$.schemaVersion");
  add(errors, !TRUTH_STATES.has(record.truthState), "E_TRUTH_STATE", "$.truthState");
  add(errors, record.runtimeAuthority !== "NONE", "E_RUNTIME_AUTHORITY", "$.runtimeAuthority");
  add(errors, record.truthEffect !== "NONE", "E_TRUTH_AUTHORITY", "$.truthEffect");

  const ids = [], domains = [];
  for (const key of ROLE_KEYS) {
    exact(record.roles[key], ROLE, `$.roles.${key}`, errors);
    ids.push(record.roles[key]?.id);
    domains.push(record.roles[key]?.controlDomain);
  }
  add(errors, new Set(ids).size !== ids.length, "E_ROLE_SELF_WITNESS", "$.roles");
  add(errors, new Set(domains).size !== domains.length, "E_CONTROL_DOMAIN_COLLISION", "$.roles");
  add(errors, record.haltObserved && ["SHADOW", "LIVE_CONTAINED"].includes(record.environment), "E_LIVE_UNDER_HALT", "$.environment");

  for (const [index, correspondence] of (record.model.correspondence ?? []).entries()) exact(correspondence, CORR, `$.model.correspondence[${index}]`, errors);
  add(errors, !record.model.correspondence?.length || !record.model.exclusions?.length, "E_MODEL_CORRESPONDENCE", "$.model");
  const requiredFaults = ["crash-before", "crash-after", "duplicate", "reorder", "drop", "lost-ack"];
  add(errors, requiredFaults.some((fault) => !record.faults.faultIds.includes(fault)), "E_FAULT_COVERAGE", "$.faults.faultIds");
  add(errors, record.evidence.committedBeforeMinimization !== true, "E_RAW_NOT_COMMITTED", "$.evidence.committedBeforeMinimization");
  add(errors, record.evidence.guestSoleWitness !== false, "E_GUEST_SOLE_WITNESS", "$.evidence.guestSoleWitness");
  add(errors, !Number.isInteger(record.oracle.mutationTotal) || record.oracle.mutationTotal < 1 || !Number.isInteger(record.oracle.mutationKilled) || record.oracle.mutationKilled < 0 || record.oracle.mutationKilled > record.oracle.mutationTotal, "E_MUTATION_ARITHMETIC", "$.oracle");

  for (const [index, control] of (record.negativeControls ?? []).entries()) {
    exact(control, CONTROL, `$.negativeControls[${index}]`, errors);
    add(errors, control.manifestDeclared !== true, "E_CONTROL_NOT_DECLARED", `$.negativeControls[${index}]`);
    add(errors, control.expectedPredicate !== control.observedPredicate, "E_NEGATIVE_CONTROL_MISSED", `$.negativeControls[${index}]`);
  }
  add(errors, !record.negativeControls?.length, "E_NEGATIVE_CONTROL_MISSING", "$.negativeControls");

  const axes = new Set();
  let hasPass = false;
  for (const [index, result] of (record.resultVector ?? []).entries()) {
    exact(result, RESULT, `$.resultVector[${index}]`, errors);
    add(errors, axes.has(result.axis), "E_DUPLICATE_AXIS", `$.resultVector[${index}].axis`);
    axes.add(result.axis);
    add(errors, !RESULT_STATUSES.has(result.status), "E_RESULT_STATUS", `$.resultVector[${index}].status`);
    add(errors, !EVIDENCE_CLASSES.has(result.evidenceClass), "E_EVIDENCE_CLASS", `$.resultVector[${index}].evidenceClass`);
    if (result.status === "PASS") {
      hasPass = true;
      add(errors, !result.evidenceRefs?.length, "E_PASS_WITHOUT_EVIDENCE", `$.resultVector[${index}].evidenceRefs`);
      add(errors, ["RUNTIME", "HUMAN"].includes(result.evidenceClass) && ["T0_STATIC", "T1_MODEL"].includes(record.truthState), "E_EVIDENCE_CLASS_PROMOTION", `$.resultVector[${index}]`);
    }
  }
  add(errors, hasPass && record.oracle.mutationKilled !== record.oracle.mutationTotal, "E_ORACLE_MUTATION_SURVIVED", "$.oracle");
  add(errors, !record.replay.samePredicate || record.replay.rawPredicate !== record.replay.minimizedPredicate, "E_REPLAY_PREDICATE_DRIFT", "$.replay");
  add(errors, ["T0_STATIC", "T1_MODEL"].includes(record.truthState) && !["RETAIN_STATIC", "CANDIDATE_FIXTURE", "BLOCKED_BY_HALT", "REJECTED"].includes(record.promotion), "E_PROMOTION", "$.promotion");
  return errors.sort((a, b) => (a.code + a.path).localeCompare(b.code + b.path));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const record = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const errors = validateEvaluation(record);
    console.log(JSON.stringify({ valid: errors.length === 0, errors }, null, 2));
    process.exitCode = errors.length ? 1 : 0;
  } catch (error) {
    console.error(JSON.stringify({ valid: false, error: String(error) }));
    process.exitCode = 2;
  }
}
