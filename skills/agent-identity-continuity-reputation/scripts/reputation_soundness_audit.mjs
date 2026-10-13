#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Ajv2020 = require('ajv/dist/2020');
const schema = JSON.parse(readFileSync(new URL('../schemas/reputation-plan.schema.json', import.meta.url)));
const validate = new Ajv2020({allErrors: true, strict: false}).compile(schema);
const topologyFor = {elo: 'pairwise', trueskill: 'team-or-draw', bandit: 'context-action-reward', none: 'none'};
const plain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function auditReputationDesign(plan) {
  if (!plain(plan)) throw new TypeError('plan must be a JSON object matching schemas/reputation-plan.schema.json');
  const findings = [];
  const recommendations = [];
  const fail = (id, severity, message, recommendation) => {
    findings.push({id, severity, message});
    if (recommendation) recommendations.push(recommendation);
  };
  if (!validate(plan)) {
    for (const error of validate.errors ?? []) fail('schema-invalid-plan', 'critical', (error.instancePath || '/') + ' ' + (error.message || 'fails schema') + '.', 'Provide required declarations with allowed values.');
  }
  if (!findings.length) {
    const {identity, continuity, outcome, estimator, newcomerPolicy, judge, sanctions} = plan;
    if (identity.authentication === 'not-established') fail('authentication-not-established', 'high', 'Credential control is not established in the supplied plan.', 'State the authentication boundary; an alias is not credential control.');
    if (identity.revocation !== 'checked-before-session-use') fail('revocation-replay-risk', 'high', 'Revocation is not checked before session use.', 'Add revocation-before-lease-use and test revoked-key replay.');
    if (identity.recovery !== 'issuer-authorized' || continuity.successorRule !== 'issuer-rebind-required') fail('unbounded-successor-link', 'high', 'Successor credentials are not constrained to issuer-authorized rebind.', 'Treat unlinked credentials as new or unattributed.');
    if (continuity.outcomeLedger !== 'declared-attributed-record') fail('no-attributed-outcome-record', 'high', 'No declared attributed outcome record.', 'Separate memory/checkpoint from an outcome record with actor, task, evaluator and receipt.');
    if (outcome.observationStatus !== 'observed-with-receipt') fail('declared-not-observed', 'medium', 'Outcome evidence is declared but not observed by this audit.', 'Inspect the referenced receipt before making a delivery claim.');
    if (estimator.inputTopology !== topologyFor[estimator.kind]) fail('estimator-topology-mismatch', 'high', 'Estimator kind and input topology differ.', 'Use pairwise for Elo, team/draw for TrueSkill, context/action/reward for a bandit.');
    if (estimator.kind !== 'none' && (!plan.representsUncertainty || !['model-posterior', 'separate-exploration-policy'].includes(estimator.uncertaintyStatus))) fail('uncertainty-policy-incoherent', 'high', 'An active estimator lacks the matching detailed uncertainty or exploration policy.', 'For Elo or a bandit declare a separate exploration policy; for TrueSkill declare a model posterior.');
    if (estimator.kind === 'none' && (plan.representsUncertainty || estimator.uncertaintyStatus !== 'not-applicable' || estimator.calibrationStatus !== 'not-applicable')) fail('none-estimator-incoherent', 'high', 'No-estimator plans must use none topology, not-applicable detailed statuses, and representsUncertainty false.', 'Keep no-estimator plans explicit rather than inventing uncertainty or calibration.');
    if (estimator.kind === 'trueskill' && estimator.calibrationStatus !== 'held-out-evaluated') fail('posterior-not-empirically-calibrated', 'medium', 'TrueSkill posterior lacks held-out calibration evidence.', 'Report calibration=not-estimated until representative held-out evaluation exists.');
    if (estimator.kind === 'bandit' && estimator.uncertaintyStatus !== 'separate-exploration-policy') fail('bandit-exploration-unspecified', 'high', 'Bandit selection lacks declared exploration/propensity status.', 'Record context, action, reward, propensity and missing counterfactual boundary.');
    if (newcomerPolicy.kind === 'none' || newcomerPolicy.resetRisk !== 'analyzed' || newcomerPolicy.exclusionRisk !== 'analyzed') fail('newcomer-policy-incomplete', 'high', 'Newcomer policy does not analyze reset and exclusion risk.', 'Evaluate a setting-specific entry, probation, exposure, dues, or issuance policy.');
    if (judge.present && judge.protocol !== 'pairwise-order-swap') fail('judge-position-control-missing', 'high', 'Present judge lacks pairwise order swap.', 'Run both orders and record disagreement as tie or abstention.');
    if (judge.present && judge.calibrationStatus !== 'human-labeled-evaluated') fail('judge-calibration-not-estimated', 'medium', 'Judge lacks a human-labeled calibration result.', 'Record judge/rubric/version and calibration or retain not-estimated.');
    if (sanctions.appeal !== 'declared' || sanctions.incentiveStatus !== 'setting-specific-analysis') fail('sanction-basis-incomplete', 'medium', 'Sanction basis lacks appeal or setting-specific analysis.', 'Name authority, appeal, and incentive comparison.');
  }
  const pass = findings.every((f) => !['critical', 'high'].includes(f.severity));
  if (pass) recommendations.push('Supplied plan is structurally valid with no critical/high consistency finding. It does not prove observed delivery, cryptographic enforcement, authentication, calibration, or runtime behavior.');
  return {pass, findings, recommendations, scope: 'supplied-declaration-consistency-only'};
}
function inputArg(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: reputation_soundness_audit.mjs --input <file>.json');
  return argv[i + 1];
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { const result = auditReputationDesign(JSON.parse(readFileSync(inputArg(process.argv.slice(2)), 'utf8'))); process.stdout.write(JSON.stringify(result, null, 2) + '\n'); if (!result.pass) process.exitCode = 1; }
  catch (error) { process.stderr.write('reputation_soundness_audit: ' + error.message + '\n'); process.exit(1); }
}
