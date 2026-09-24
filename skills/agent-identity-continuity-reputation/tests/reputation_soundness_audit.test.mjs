import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {auditReputationDesign} from '../scripts/reputation_soundness_audit.mjs';

const base = JSON.parse(readFileSync(new URL('../examples/sample-input.json', import.meta.url)));
const check = (name, patch, expected = false) => test(name, () => {
  const p = structuredClone(base); patch(p);
  assert.equal(auditReputationDesign(p).pass, expected, name);
});
const cli = (value) => spawnSync(process.execPath, [new URL('../scripts/reputation_soundness_audit.mjs', import.meta.url).pathname, '--input', '/dev/stdin'], {input: value, encoding: 'utf8'});

check('baseline including extra property passes', () => {}, true);
check('invalid estimator shape rejects', (p) => { p.estimator = 'made-up'; });
check('missing judge rejects', (p) => { delete p.judge; });
check('missing uncertainty rejects', (p) => { delete p.estimator.uncertaintyStatus; });
check('missing newcomer rejects', (p) => { p.newcomerPolicy = false; });
check('unmitigated judge rejects', (p) => { p.judge = {present: true, protocol: 'other-declared', calibrationStatus: 'not-estimated'}; });
check('blank required issuer actor credential session oracle evaluator receipt objective authority reject', (p) => {
  p.identity.issuerNamespace = ' '; p.identity.actorId = ' '; p.identity.credentialId = ' ';
  p.identity.sessionId = ' '; p.outcome.oracleRef = ' '; p.outcome.evaluatorRef = ' ';
  p.outcome.receiptRef = ' '; p.newcomerPolicy.objective = ' '; p.sanctions.authority = ' ';
});
check('nonfinite value rejects safely', (p) => { p.identity.actorId = Infinity; });
check('null nested identity rejects safely', (p) => { p.identity = null; });
check('declared not observed is scope warning only', (p) => { p.outcome.observationStatus = 'declared-not-observed'; }, true);
check('Elo cannot use not-established uncertainty', (p) => { p.estimator.uncertaintyStatus = 'not-established'; });
check('Elo cannot use not-applicable uncertainty', (p) => { p.estimator.uncertaintyStatus = 'not-applicable'; });
check('TrueSkill requires model posterior and active uncertainty', (p) => { p.estimator = {kind: 'trueskill', inputTopology: 'team-or-draw', uncertaintyStatus: 'separate-exploration-policy', calibrationStatus: 'not-estimated'}; });
check('bandit requires exploration policy and active uncertainty', (p) => { p.estimator = {kind: 'bandit', inputTopology: 'context-action-reward', uncertaintyStatus: 'not-established', calibrationStatus: 'not-estimated'}; });
check('none is a valid explicit no-estimator state', (p) => {
  p.estimator = {kind: 'none', inputTopology: 'none', uncertaintyStatus: 'not-applicable', calibrationStatus: 'not-applicable'};
  p.representsUncertainty = false;
  p.judge = {present: false, protocol: 'not-applicable', calibrationStatus: 'not-applicable'};
}, true);
check('none cannot invent uncertainty', (p) => {
  p.estimator = {kind: 'none', inputTopology: 'none', uncertaintyStatus: 'not-applicable', calibrationStatus: 'not-applicable'};
});
test('CLI exits zero for passing declaration and nonzero for schema, policy, and malformed input', () => {
  assert.equal(cli(JSON.stringify(base)).status, 0);
  assert.notEqual(cli(JSON.stringify({...base, estimator: 'bad'})).status, 0);
  const policy = structuredClone(base); policy.identity.authentication = 'not-established';
  assert.notEqual(cli(JSON.stringify(policy)).status, 0);
  assert.notEqual(cli('{ malformed').status, 0);
});
check('TrueSkill coherent posterior state passes', (p) => {
  p.estimator = {kind: 'trueskill', inputTopology: 'team-or-draw', uncertaintyStatus: 'model-posterior', calibrationStatus: 'not-estimated'};
}, true);
check('bandit coherent exploration state passes', (p) => {
  p.estimator = {kind: 'bandit', inputTopology: 'context-action-reward', uncertaintyStatus: 'separate-exploration-policy', calibrationStatus: 'not-estimated'};
}, true);
check('absent judge cannot claim a judge protocol', (p) => {
  p.judge = {present: false, protocol: 'pairwise-order-swap', calibrationStatus: 'not-applicable'};
});
check('present judge cannot use not-applicable calibration', (p) => {
  p.judge = {present: true, protocol: 'pairwise-order-swap', calibrationStatus: 'not-applicable'};
});
test('CLI keeps zero exit for an intentional medium scope warning', () => {
  const p = structuredClone(base); p.outcome.observationStatus = 'declared-not-observed';
  assert.equal(cli(JSON.stringify(p)).status, 0);
});
