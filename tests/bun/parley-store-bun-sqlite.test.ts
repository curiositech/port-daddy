/**
 * Regression coverage for Store0 automatic admission in the shipped Bun SQLite
 * runtime. Bun counts quota-trigger side effects in statement `changes`, while
 * Node's better-sqlite3 reports only the direct record write. The purpose is
 * to prove that a canonical automatic Parley still commits its record, receipt,
 * and quota ledger through the real Bun transaction rather than relying on the
 * Node-only count convention.
 */

import { describe, expect, test } from 'bun:test';

import Database from '../../lib/sqlite-runtime.ts';
import { createParley } from '../../lib/parley.ts';
import { createParleyStore } from '../../lib/parley-store.ts';
import {
  CONFLICT_SIGNAL_PRODUCERS,
  conflictSignalId,
  shouldConvene,
} from '../../lib/parley-trigger.ts';
import {
  PARLEY_AUTO_TRIGGER_POLICY,
  parleySignalLineageKey,
} from '../../lib/parley-auto-trigger.ts';

const TENANT = 'bun-store0-tenant';
const HARBOR = 'bun-store0-harbor';
const NOW = 1_700_000_000_000;

function automaticSignal() {
  const identity = {
    checkpoint: 'claim' as const,
    kind: 'claim_overlap' as const,
    surface: 'lib/parley-store.ts#insertRecord',
    parties: ['bun-agent-a', 'bun-agent-b'],
    evidenceRefs: ['claim:bun-store0-quota-trigger'],
  };
  return {
    schemaVersion: 1 as const,
    signalId: conflictSignalId(identity),
    kind: identity.kind,
    checkpoint: identity.checkpoint,
    shape: 'contract-net' as const,
    parties: identity.parties,
    surface: identity.surface,
    magnitude: 1,
    confidence: 1,
    reason: 'two live Bun agents hold the exact same structural claim',
    evidenceRefs: identity.evidenceRefs,
    provenance: {
      producer: CONFLICT_SIGNAL_PRODUCERS.claimConflict,
      trustTier: 'INTERNAL' as const,
      producedAt: NOW,
    },
  };
}

/**
 * Build the only automatic admission shape accepted by Store0. Keeping this
 * fixture at the Parley facade preserves the production call path: Store0
 * creates its own signal reservation, canonical record, receipt, and triggers.
 *
 * @returns A fresh canonical automatic admission input for the Bun runtime.
 */
function automaticAdmission() {
  const signal = automaticSignal();
  const lineageKey = parleySignalLineageKey(signal);
  return {
    harbor: HARBOR,
    signal,
    lineageKey,
    decision: shouldConvene(signal, { mode: 'automatic' }),
    terminalState: 'fired' as const,
    reason: `automatic Bun admission for ${signal.signalId}`,
    call: {
      surface: signal.surface,
      reason: signal.reason,
      participants: signal.parties.map((actorId, index) => ({
        actorId,
        inboxTarget: `inbox-${actorId}`,
        sessionId: `session-${actorId}-${index}`,
        lineageRootSessionId: `root-${actorId}-${index}`,
      })),
      trigger: 'claim_overlap' as const,
      harbor: HARBOR,
      automatic: {
        idempotencyKey: signal.signalId,
        signalId: signal.signalId,
        lineageKey,
        checkpoint: signal.checkpoint,
        kind: signal.kind,
        shape: signal.shape,
        evidenceRefs: [...signal.evidenceRefs],
        confidence: signal.confidence,
        magnitude: signal.magnitude,
        origin: null,
      },
    },
    policy: PARLEY_AUTO_TRIGGER_POLICY,
  };
}

describe('Store0 automatic admission under bun:sqlite quota triggers', () => {
  test('commits the canonical record and receipt even when record quota triggers write ledger rows', () => {
    expect(process.versions.bun).toBeDefined();

    const db = new Database(':memory:');
    try {
      const store = createParleyStore({ db, tenantId: TENANT, now: () => NOW });
      const parley = createParley({ store, defaultHarbor: HARBOR, now: () => NOW });

      const admitted = parley.admitAutomatic(automaticAdmission());

      expect(admitted).toMatchObject({
        replayed: false,
        terminalState: 'fired',
        parley: {
          harbor: HARBOR,
          automatic: { signalId: automaticSignal().signalId },
        },
      });
      expect(admitted.receiptInserted).toBeTrue();
      expect(store.inspectCounts(HARBOR)).toMatchObject({
        parley_records: 1,
        parley_auto_signals: 1,
        parley_auto_terminal_receipts: 1,
        parley_notification_outbox: 2,
      });
      expect(db.prepare(`
        SELECT retained_records, retained_signals, retained_outbox
        FROM parley_quota_ledger
        WHERE tenant_id = ? AND harbor = ?
      `).get(TENANT, HARBOR)).toEqual({
        retained_records: 1,
        retained_signals: 1,
        retained_outbox: 2,
      });
    } finally {
      db.close();
    }
  });
});
