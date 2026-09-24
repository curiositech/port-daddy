import assert from 'node:assert/strict';
import test from 'node:test';
import { CostLedger } from '../examples/cost-ledger.mjs';

const period = '2026-09';
const rate = 'rate:dated-revision-1';
function ledger(overrides = {}) {
  return new CostLedger({ policyRevision: 'policy:v1', currency: 'USD',
    periodLimitsMicros: { [period]: 10_000_000, '2026-10': 10_000_000 },
    requestLimitMicros: 4_000_000, ...overrides });
}
function reserve(l, id, amount) { return l.reserve({ period, operationId: id, amountMicros: amount, rateRevision: rate }); }

test('serialized local fixture rejects the second competing reservation at the boundary', async () => {
  // Raise only the per-request ceiling so the 6m seeded settlement is admissible.
  const boundary = ledger({ requestLimitMicros: 7_000_000 });
  boundary.reserve({ period, operationId: 'prior', amountMicros: 6_000_000, rateRevision: rate });
  boundary.submit(period, 'prior'); boundary.settle(period, 'prior', 6_000_000, 'settle:prior');
  const results = await Promise.all([
    boundary.reserve({ period, operationId: 'left', amountMicros: 3_500_000, rateRevision: rate }),
    boundary.reserve({ period, operationId: 'right', amountMicros: 3_500_000, rateRevision: rate }),
  ]);
  assert.deepEqual(results.map((r) => r.kind).sort(), ['DENIED', 'RESERVED']);
  assert.equal(boundary.usage(period), 9_500_000);
});

test('timeout keeps full hold; reconciliation settles and releases unused reservation', () => {
  const l = ledger();
  assert.equal(reserve(l, 'request-1', 3_500_000).kind, 'RESERVED');
  l.submit(period, 'request-1');
  assert.equal(l.markUnknown(period, 'request-1').kind, 'UNKNOWN');
  assert.equal(l.usage(period), 3_500_000);
  assert.equal(l.markUnknown(period, 'request-1').replay, true);
  assert.equal(l.settle(period, 'request-1', 2_900_000, 'provider:receipt-1').kind, 'SETTLED');
  assert.equal(l.usage(period), 2_900_000);
});

test('same operation replay is idempotent while changed reservation or settlement is rejected', () => {
  const l = ledger();
  assert.equal(reserve(l, 'request-1', 3_000_000).kind, 'RESERVED');
  assert.equal(reserve(l, 'request-1', 3_000_000).replay, true);
  assert.equal(reserve(l, 'request-1', 2_000_000).reason, 'IDEMPOTENCY_KEY_CONFLICT');
  l.submit(period, 'request-1'); l.settle(period, 'request-1', 2_500_000, 'provider:receipt-1');
  assert.equal(l.settle(period, 'request-1', 2_500_000, 'provider:receipt-1').replay, true);
  assert.equal(l.settle(period, 'request-1', 1_000_000, 'provider:receipt-2').reason, 'SETTLEMENT_REPLAY_CONFLICT');
});

test('overrun counts against period usage; only requests within the remaining cap are admitted', () => {
  const l = ledger();
  reserve(l, 'request-1', 2_000_000); l.submit(period, 'request-1');
  assert.equal(l.settle(period, 'request-1', 4_500_000, 'provider:receipt-1').kind, 'OVERRUN');
  assert.equal(l.usage(period), 4_500_000);
  assert.equal(reserve(l, 'request-2', 4_000_000).kind, 'RESERVED');
  assert.equal(reserve(l, 'request-3', 2_000_000).kind, 'DENIED');
});

test('period rollover, missing policy, request ceiling, and pre-submit cancellation are explicit', () => {
  const l = ledger();
  assert.equal(l.reserve({ period, operationId: 'large', amountMicros: 4_000_001, rateRevision: rate }).reason, 'REQUEST_LIMIT');
  assert.equal(l.reserve({ period: '2026-11', operationId: 'no-policy', amountMicros: 1, rateRevision: rate }).reason, 'PERIOD_POLICY_MISSING');
  assert.equal(reserve(l, 'cancel', 1_000_000).kind, 'RESERVED');
  assert.equal(l.cancelBeforeSubmit(period, 'cancel').kind, 'CANCELLED');
  assert.equal(l.usage(period), 0);
  assert.equal(l.submit(period, 'cancel').reason, 'INVALID_SUBMIT_STATE');
  assert.equal(l.reserve({ period: '2026-10', operationId: 'new-period', amountMicros: 1_000_000, rateRevision: rate }).kind, 'RESERVED');
});
