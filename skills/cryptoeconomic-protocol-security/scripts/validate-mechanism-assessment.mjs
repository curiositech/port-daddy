#!/usr/bin/env node
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const TOP = ["schemaVersion", "assessmentId", "protocolSnapshotDigest", "repositoryAnchor", "truthState", "scope", "authorities", "assets", "assumptions", "scenarios", "defenses", "settlement", "unresolved", "runtimeAuthority", "settlementAuthority", "legalConclusion", "truthEffect"];
const AUTH = ["role", "principal", "controlDomain"];
const ASSET = ["assetId", "kind", "custodian", "lossBearer", "reachableLoss"];
const ASSUMPTION = ["assumptionId", "statement", "status", "falsifier"];
const SCENARIO = ["scenarioId", "family", "coalition", "target", "preconditions", "sequence", "informationAdvantage", "gain", "attackerCost", "victimLoss", "externality", "evidenceRefs", "controlDomains", "defenseIds", "residualSeverity", "falsifier", "reevaluationTrigger", "acceptedRisk"];
const DEFENSE = ["defenseId", "classes", "statement", "assumptions", "evidenceRefs", "falsifier"];
const SETTLEMENT = ["profile", "effectAuthority", "settlementAuthority", "evidenceClasses", "conflictTerminal", "compensationRequiresNewEffect"];
const QUANTITY = ["state", "low", "high", "unit", "sourceRefs"];

function add(errors, condition, code, path) { if (condition) errors.push({ code, path }); }
function exact(value, fields, path, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) { errors.push({ code: "E_SHAPE", path }); return; }
  for (const field of fields) add(errors, !(field in value), "E_REQUIRED", `${path}.${field}`);
  for (const field of Object.keys(value)) add(errors, !fields.includes(field), "E_UNKNOWN_FIELD", `${path}.${field}`);
}
function quantity(value, path, errors) {
  exact(value, QUANTITY, path, errors);
  if (!value) return;
  if (value.state === "UNKNOWN") add(errors, value.low !== null || value.high !== null, "E_UNKNOWN_PRETENDS_NUMERIC", path);
  if (["KNOWN", "BOUNDED"].includes(value.state)) {
    add(errors, !Number.isFinite(value.low) || !Number.isFinite(value.high) || value.low < 0 || value.high < value.low, "E_QUANTITY_RANGE", path);
    add(errors, !value.sourceRefs?.length, "E_QUANTITY_UNSOURCED", `${path}.sourceRefs`);
  }
  if (value.state === "KNOWN") add(errors, value.low !== value.high, "E_KNOWN_NOT_EXACT", path);
}

export function validateAssessment(record) {
  const errors = [];
  exact(record, TOP, "$", errors);
  if (errors.length) return errors;
  exact(record.settlement, SETTLEMENT, "$.settlement", errors);
  add(errors, record.schemaVersion !== "2.0.0", "E_VERSION", "$.schemaVersion");
  add(errors, record.runtimeAuthority !== "NONE", "E_RUNTIME_AUTHORITY", "$.runtimeAuthority");
  add(errors, record.settlementAuthority !== "NONE", "E_SETTLEMENT_AUTHORITY", "$.settlementAuthority");
  add(errors, record.legalConclusion !== "NONE", "E_LEGAL_CONCLUSION", "$.legalConclusion");
  add(errors, record.truthEffect !== "NONE", "E_TRUTH_AUTHORITY", "$.truthEffect");

  const roles = new Map();
  for (const [index, authority] of (record.authorities ?? []).entries()) {
    exact(authority, AUTH, `$.authorities[${index}]`, errors);
    add(errors, roles.has(authority.role), "E_DUPLICATE_AUTHORITY_ROLE", `$.authorities[${index}].role`);
    roles.set(authority.role, authority);
  }
  const effect = record.authorities.find((authority) => authority.principal === record.settlement.effectAuthority);
  const settlement = record.authorities.find((authority) => authority.principal === record.settlement.settlementAuthority);
  add(errors, !effect || !settlement, "E_SETTLEMENT_AUTHORITY_UNBOUND", "$.settlement");
  add(errors, effect && settlement && (effect.principal === settlement.principal || effect.controlDomain === settlement.controlDomain), "E_SETTLEMENT_NOT_DISJOINT", "$.settlement");
  add(errors, record.settlement.conflictTerminal !== "UNSETTLED", "E_CONFLICT_GREEN", "$.settlement.conflictTerminal");
  add(errors, record.settlement.compensationRequiresNewEffect !== true, "E_COMPENSATION_NOT_EFFECT", "$.settlement.compensationRequiresNewEffect");
  add(errors, record.settlement.profile === "NO_SETTLEMENT" && record.settlement.evidenceClasses.length > 0, "E_NO_SETTLEMENT_DRIFT", "$.settlement.evidenceClasses");
  add(errors, record.settlement.profile === "BOUNDED_SETTLEMENT" && record.settlement.evidenceClasses.length === 0, "E_SETTLEMENT_EVIDENCE_MISSING", "$.settlement.evidenceClasses");

  for (const [index, asset] of (record.assets ?? []).entries()) {
    exact(asset, ASSET, `$.assets[${index}]`, errors);
    quantity(asset.reachableLoss, `$.assets[${index}].reachableLoss`, errors);
  }
  for (const [index, assumption] of (record.assumptions ?? []).entries()) exact(assumption, ASSUMPTION, `$.assumptions[${index}]`, errors);

  const defenses = new Map();
  for (const [index, defense] of (record.defenses ?? []).entries()) {
    exact(defense, DEFENSE, `$.defenses[${index}]`, errors);
    add(errors, defenses.has(defense.defenseId), "E_DUPLICATE_DEFENSE", `$.defenses[${index}].defenseId`);
    defenses.set(defense.defenseId, defense);
    add(errors, !defense.assumptions?.length || !defense.falsifier, "E_DEFENSE_UNFALSIFIABLE", `$.defenses[${index}]`);
  }

  const scenarioIds = new Set();
  for (const [index, scenario] of (record.scenarios ?? []).entries()) {
    exact(scenario, SCENARIO, `$.scenarios[${index}]`, errors);
    add(errors, scenarioIds.has(scenario.scenarioId), "E_DUPLICATE_SCENARIO", `$.scenarios[${index}].scenarioId`);
    scenarioIds.add(scenario.scenarioId);
    for (const field of ["gain", "attackerCost", "victimLoss", "externality"]) quantity(scenario[field], `$.scenarios[${index}].${field}`, errors);
    const cited = scenario.defenseIds.map((id) => defenses.get(id)).filter(Boolean);
    add(errors, cited.length !== scenario.defenseIds.length, "E_DEFENSE_REFERENCE", `$.scenarios[${index}].defenseIds`);
    add(errors, scenario.defenseIds.length === 0 && !scenario.acceptedRisk, "E_RISK_UNOWNED", `$.scenarios[${index}]`);
    if (["HIGH", "CRITICAL"].includes(scenario.residualSeverity) && cited.length) {
      const strong = cited.some((defense) => defense.classes.some((kind) => ["STRUCTURAL", "CRYPTOGRAPHIC", "PROCEDURAL"].includes(kind)));
      add(errors, !strong, "E_HIGH_RISK_SOFT_DEFENSE_ONLY", `$.scenarios[${index}].defenseIds`);
    }
    add(errors, !scenario.falsifier || !scenario.reevaluationTrigger, "E_SCENARIO_UNFALSIFIABLE", `$.scenarios[${index}]`);
  }
  return errors.sort((a, b) => (a.code + a.path).localeCompare(b.code + b.path));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const record = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const errors = validateAssessment(record);
    console.log(JSON.stringify({ valid: errors.length === 0, errors }, null, 2));
    process.exitCode = errors.length ? 1 : 0;
  } catch (error) {
    console.error(JSON.stringify({ valid: false, error: String(error) }));
    process.exitCode = 2;
  }
}
