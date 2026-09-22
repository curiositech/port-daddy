#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const TOP = ["schemaVersion", "capsuleId", "subject", "compiler", "inputManifestDigest", "policyDigest", "items", "retrievalJoins", "obligations", "translations", "omissions", "unknowns", "proposalNonce", "outputDigest", "admissionAuthority", "capabilityAuthority", "truthEffect"];
const SU = ["actorId", "predecessorBodyId", "proposedBodyId", "authorityEpoch", "repository", "taskId", "audience"];
const CO = ["compilerId", "policyVersion", "sourceManifestRef"];
const IT = ["itemId", "contentRef", "contentDigest", "trustClass", "instructionUse", "authorityRef", "provenanceRefs", "disclosureScope", "audience", "freshness", "revocationChecked", "integrityRef", "spaceId", "redaction", "obligationIds"];
const RJ = ["joinId", "querySpaceId", "candidateSpaceId", "policyRef", "status"];
const OB = ["obligationId", "statement", "status", "sourceRefs", "reason"];
const TR = ["kind", "sourceName", "targetName", "status", "authorityRef", "rationale"];
const OM = ["omissionId", "category", "reason", "policyRef"];
const RETRIEVAL_STATUSES = new Set(["MATCHED", "REJECTED_SPACE_MISMATCH"]);
const OBLIGATION_STATUSES = new Set(["COVERED", "OMITTED", "UNKNOWN"]);
const TRANSLATION_STATUSES = new Set(["EXACT", "NARROWED", "SUBSTITUTED", "OMITTED", "UNKNOWN"]);

function add(errors, condition, code, path) { if (condition) errors.push({ code, path }); }
function exact(value, fields, path, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) { errors.push({ code: "E_SHAPE", path }); return; }
  for (const field of fields) add(errors, !(field in value), "E_REQUIRED", `${path}.${field}`);
  for (const field of Object.keys(value)) add(errors, !fields.includes(field), "E_UNKNOWN_FIELD", `${path}.${field}`);
}

export function validateContextIR(record) {
  const errors = [];
  exact(record, TOP, "$", errors);
  if (errors.length) return errors;
  exact(record.subject, SU, "$.subject", errors);
  exact(record.compiler, CO, "$.compiler", errors);
  add(errors, record.schemaVersion !== "1.0.0", "E_VERSION", "$.schemaVersion");
  add(errors, record.admissionAuthority !== "NONE", "E_ADMISSION_AUTHORITY", "$.admissionAuthority");
  add(errors, record.capabilityAuthority !== "NONE", "E_CAPABILITY_AUTHORITY", "$.capabilityAuthority");
  add(errors, record.truthEffect !== "NONE", "E_TRUTH_AUTHORITY", "$.truthEffect");

  const items = new Map();
  for (const [index, item] of (record.items ?? []).entries()) {
    exact(item, IT, `$.items[${index}]`, errors);
    add(errors, items.has(item.itemId), "E_DUPLICATE_ITEM", `$.items[${index}].itemId`);
    items.set(item.itemId, item);
    add(errors, !Array.isArray(item.provenanceRefs) || item.provenanceRefs.length === 0, "E_PROVENANCE_MISSING", `$.items[${index}].provenanceRefs`);
    if (item.instructionUse === "DIRECTIVE_ELIGIBLE") {
      add(errors, item.trustClass !== "CURRENT_OPERATOR_DIRECTIVE", "E_UNTRUSTED_DIRECTIVE", `$.items[${index}].trustClass`);
      add(errors, item.audience !== record.subject.audience, "E_DIRECTIVE_AUDIENCE", `$.items[${index}].audience`);
      add(errors, item.freshness !== "CURRENT" || !item.revocationChecked || !item.authorityRef || !item.integrityRef, "E_DIRECTIVE_AUTHORITY", `$.items[${index}]`);
    }
    add(errors, item.trustClass !== "CURRENT_OPERATOR_DIRECTIVE" && item.instructionUse === "DIRECTIVE_ELIGIBLE", "E_TRUTH_AS_AUTHORITY", `$.items[${index}].instructionUse`);
    if (item.trustClass === "SECRET_HANDLE") {
      add(errors, item.redaction !== "OPAQUE_HANDLE" || item.instructionUse !== "FORBIDDEN" || !item.contentRef.startsWith("opaque://"), "E_RAW_SECRET", `$.items[${index}]`);
    }
  }

  for (const [index, join] of (record.retrievalJoins ?? []).entries()) {
    exact(join, RJ, `$.retrievalJoins[${index}]`, errors);
    add(errors, !RETRIEVAL_STATUSES.has(join.status), "E_RETRIEVAL_STATUS", `$.retrievalJoins[${index}].status`);
    const same = join.querySpaceId === join.candidateSpaceId;
    add(errors, join.status === "MATCHED" && !same, "E_VECTOR_SPACE_MIX", `$.retrievalJoins[${index}]`);
    add(errors, join.status === "REJECTED_SPACE_MISMATCH" && same, "E_FALSE_SPACE_REJECTION", `$.retrievalJoins[${index}]`);
  }

  const obligations = new Map();
  for (const [index, obligation] of (record.obligations ?? []).entries()) {
    exact(obligation, OB, `$.obligations[${index}]`, errors);
    add(errors, !OBLIGATION_STATUSES.has(obligation.status), "E_OBLIGATION_STATUS", `$.obligations[${index}].status`);
    add(errors, obligations.has(obligation.obligationId), "E_DUPLICATE_OBLIGATION", `$.obligations[${index}].obligationId`);
    obligations.set(obligation.obligationId, obligation);
    if (obligation.status === "COVERED") {
      add(errors, obligation.sourceRefs.length === 0 || obligation.sourceRefs.some((id) => !items.has(id)), "E_OBLIGATION_UNSUPPORTED", `$.obligations[${index}].sourceRefs`);
      add(errors, !obligation.sourceRefs.some((id) => items.get(id)?.obligationIds.includes(obligation.obligationId)), "E_OBLIGATION_NOT_BOUND", `$.obligations[${index}]`);
    } else add(errors, !obligation.reason, "E_OMISSION_REASON", `$.obligations[${index}].reason`);
  }
  for (const [index, item] of (record.items ?? []).entries()) {
    for (const obligationId of item.obligationIds) add(errors, !obligations.has(obligationId), "E_UNKNOWN_OBLIGATION", `$.items[${index}].obligationIds`);
  }

  for (const [index, translation] of (record.translations ?? []).entries()) {
    exact(translation, TR, `$.translations[${index}]`, errors);
    add(errors, !TRANSLATION_STATUSES.has(translation.status), "E_TRANSLATION_STATUS", `$.translations[${index}].status`);
    add(errors, !translation.rationale, "E_TRANSLATION_RATIONALE", `$.translations[${index}].rationale`);
    add(errors, ["OMITTED", "UNKNOWN"].includes(translation.status) && translation.targetName !== null, "E_TRANSLATION_TARGET", `$.translations[${index}].targetName`);
  }
  for (const [index, omission] of (record.omissions ?? []).entries()) exact(omission, OM, `$.omissions[${index}]`, errors);
  add(errors, record.obligations.some((obligation) => obligation.status === "OMITTED") && record.omissions.length === 0, "E_OMISSION_NOT_RECEIPTED", "$.omissions");
  return errors.sort((a, b) => (a.code + a.path).localeCompare(b.code + b.path));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const record = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const errors = validateContextIR(record);
    console.log(JSON.stringify({ valid: errors.length === 0, errors }, null, 2));
    process.exitCode = errors.length ? 1 : 0;
  } catch (error) {
    console.error(JSON.stringify({ valid: false, error: String(error) }));
    process.exitCode = 2;
  }
}
