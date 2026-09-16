import { defineConfig } from 'vitest/config';

/**
 * Plain Node vitest — the same posture the fleet-executor suite proved out.
 *
 * WHY NOT MINIFLARE: the Steward scaffold's logic is charter/ledger/inbox state
 * machinery over two tiny interfaces (Durable Object storage and D1), both of
 * which the tests fake directly in tests/harness.ts. Booting workerd would buy
 * fidelity we don't yet exercise (alarms are invoked by calling `alarm()` in
 * tests) at the price of slow, flaky CI. When the tick starts doing real model
 * calls and cross-Worker fetches (P1 PR 2+), revisit with pool-workers.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
