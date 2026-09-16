import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditThing } from '../scripts/audit_reconciliation.mjs';
import sample from '../examples/sample-input.json' with { type: 'json' };

const fresh = () => structuredClone(sample);
const ready = () => {
  const packet = fresh();
  packet.decision.status = 'ready';
  packet.decision.authorityVerified = true;
  return packet;
};
const script = fileURLToPath(new URL('../scripts/audit_reconciliation.mjs', import.meta.url));

test('synthetic sample passes without mutation, deterministically', () => {
  const packet = fresh();
  const before = structuredClone(packet);
  assert.deepEqual(auditThing(packet), { pass: true, findings: [], recommendations: [] });
  assert.deepEqual(packet, before);
  assert.deepEqual(auditThing(packet), auditThing(packet));
});

const failures = [
  ['halted execution', p => { p.decision.requestedExecution = true; }, 'AP-AUTHORITY'],
  ['halted paid work', p => { p.cost.paidWorkRequested = true; }, 'AP-AUTHORITY'],
  ['ready without authority', p => { p.decision.status = 'ready'; }, 'AP-AUTHORITY'],
  ['cross-scope evidence', p => { p.evidence[0].scopeId = 'another-scope'; }, 'AP-AUTHORITY'],
  ['unauthorized evidence', p => { p.evidence[0].authorized = false; }, 'AP-AUTHORITY'],
  ['unknown paid telemetry', p => { p.decision.halted = false; p.cost.paidWorkRequested = true; p.cost.aggregateReserved = true; p.cost.capUsd = 2; }, 'AP-AUTHORITY'],
  ['unreserved paid cost', p => { p.decision.halted = false; p.cost.paidWorkRequested = true; p.cost.telemetryKnown = true; p.cost.capUsd = 2; }, 'AP-AUTHORITY'],
  ['zero paid cap', p => { p.decision.halted = false; p.cost.paidWorkRequested = true; p.cost.telemetryKnown = true; p.cost.aggregateReserved = true; }, 'AP-AUTHORITY'],
  ['solo independence claim', p => { p.method.claimsIndependent = true; }, 'AP-EVIDENCE'],
  ['unsealed independent mode', p => { p.method.mode = 'independent'; }, 'AP-EVIDENCE'],
  ['different frozen inputs', p => { p.method.mode = 'independent'; p.method.sealedBeforeSharing = true; p.method.sameFrozenInput = false; }, 'AP-EVIDENCE'],
  ['inference promoted', p => { p.evidence[0].warrant = 'inference'; }, 'AP-EVIDENCE'],
  ['missing premise promoted', p => { p.evidence[0].warrant = 'missing'; }, 'AP-EVIDENCE'],
  ['verified with no premise', p => { p.findings[0].evidenceIds = []; }, 'AP-EVIDENCE'],
  ['alleged verified observation', p => { p.findings[1].warrant = 'verified_observation'; }, 'AP-EVIDENCE'],
  ['verified hypothesis', p => { p.findings[0].warrant = 'hypothesis'; }, 'AP-EVIDENCE'],
  ['stale state preview', p => { p.preview.stateRevision = 11; }, 'AP-RECONCILIATION'],
  ['stale source preview', p => { p.preview.sourceHead = 'earlier-head'; }, 'AP-RECONCILIATION'],
  ['stale proposal preview', p => { p.preview.proposalDigest = 'earlier'; }, 'AP-RECONCILIATION'],
  ['unavailable preview', p => { p.preview.available = false; }, 'AP-RECONCILIATION'],
  ['erased dissent', p => { p.dissent = []; }, 'AP-RECONCILIATION'],
];
for (const [name, mutate, expected] of failures) {
  test(`schema-valid failure: ${name}`, () => {
    const packet = fresh();
    mutate(packet);
    const result = auditThing(packet);
    assert.equal(result.pass, false);
    assert.ok(result.findings.some(item => item.id === expected));
    assert.ok(result.recommendations.length > 0);
  });
}

for (const disposition of ['open', 'escalate', 'defer', 'accept']) {
  test(`ready state cannot hide active blocker through ${disposition}`, () => {
    const packet = ready();
    packet.findings[0].blocking = true;
    packet.findings[0].disposition = disposition;
    assert.ok(auditThing(packet).findings.some(item => item.id === 'AP-RECONCILIATION'));
  });
}

test('draft can retain an open allegation while halted without requesting work', () => {
  const packet = fresh();
  packet.findings[1].disposition = 'open';
  packet.findings[1].blocking = true;
  assert.equal(auditThing(packet).pass, true);
});
test('fully declared independent method is not itself a violation or proof', () => {
  const packet = fresh();
  Object.assign(packet.method, { mode: 'independent', claimsIndependent: true, sealedBeforeSharing: true });
  assert.equal(auditThing(packet).pass, true);
});
test('rejecting a blocker requires dissent even in ready state', () => {
  const packet = ready();
  packet.findings[1].blocking = true;
  assert.equal(auditThing(packet).pass, true);
  packet.dissent = [];
  assert.equal(auditThing(packet).pass, false);
});

const malformed = [
  ['null input', () => null],
  ['missing section', p => { delete p.scope; return p; }],
  ['unknown property', p => { p.cost.extra = true; return p; }],
  ['misspelled enum', p => { p.decision.status = 'approved'; return p; }],
  ['nonboolean halt', p => { p.decision.halted = 'true'; return p; }],
  ['negative revision', p => { p.scope.revision = -1; return p; }],
  ['unsafe integer', p => { p.scope.revision = Number.MAX_SAFE_INTEGER + 1; return p; }],
  ['NaN cap', p => { p.cost.capUsd = NaN; return p; }],
  ['infinite cap', p => { p.cost.capUsd = Infinity; return p; }],
  ['blank owner', p => { p.decision.owner = ' '; return p; }],
  ['duplicate evidence', p => { p.evidence.push(p.evidence[0]); return p; }],
  ['duplicate finding', p => { p.findings.push(p.findings[0]); return p; }],
  ['duplicate dissent', p => { p.dissent.push(p.dissent[0]); return p; }],
  ['unknown evidence', p => { p.findings[0].evidenceIds = ['absent']; return p; }],
  ['duplicate premise', p => { p.findings[0].evidenceIds.push('exception-record'); return p; }],
  ['unknown dissent finding', p => { p.dissent[0].findingId = 'absent'; return p; }],
  ['empty affected outcomes', p => { p.preview.affectedOutcomes = []; return p; }],
];
for (const [name, mutate] of malformed) {
  test(`malformed throws: ${name}`, () => assert.throws(() => auditThing(mutate(fresh())), TypeError));
}

test('CLI sample exits 0 with JSON', () => {
  const path = fileURLToPath(new URL('../examples/sample-input.json', import.meta.url));
  const result = spawnSync(process.execPath, [script, path], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).pass, true);
});
test('CLI missing and unreadable input exit 1 with stderr', () => {
  for (const args of [[], ['/this-fixture-does-not-exist.json']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.includes('Reconciliation audit:'));
  }
});
test('CLI policy failure exits 1 without temporary files', () => {
  const packet = fresh();
  packet.decision.requestedExecution = true;
  const result = spawnSync(process.execPath, [script, '/dev/stdin'], { input: JSON.stringify(packet), encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).pass, false);
});
test('CLI malformed JSON exits 1 with stderr', () => {
  const result = spawnSync(process.execPath, [script, '/dev/stdin'], { input: '{', encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.includes('Reconciliation audit:'));
});
