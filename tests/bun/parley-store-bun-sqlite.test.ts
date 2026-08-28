/**
 * Regression coverage for Store0 automatic Sugar Parleys in the shipped Bun
 * SQLite runtime. Bun counts quota-trigger side effects in statement `changes`,
 * while Node's better-sqlite3 reports only direct writes. The purpose is to
 * prove that a canonical session-begin convergence commits its record, receipt,
 * natural-language turn, and quota ledger through the real Bun transaction
 * without mistaking trigger effects for replayed notification keys.
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
    checkpoint: 'session_begin' as const,
    kind: 'task_convergence' as const,
    surface: 'session-begin:lib/sugar-parley.ts#resolveTogether',
    parties: ['bun-agent-a', 'bun-agent-b'],
    evidenceRefs: ['semantic:bun-store0-overlap', 'session:bun-store0-a', 'session:bun-store0-b'],
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
    reason: 'two live Bun agents converged on one bounded Sugar coordination surface',
    evidenceRefs: identity.evidenceRefs,
    provenance: {
      producer: CONFLICT_SIGNAL_PRODUCERS.sessionBeginConvergence,
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
      trigger: 'swarm_fit' as const,
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
        origin: 'sugar-parley',
      },
    },
    policy: PARLEY_AUTO_TRIGGER_POLICY,
  };
}

describe('Store0 automatic Sugar admission under bun:sqlite quota triggers', () => {
  test('commits one typed natural-language turn and replay when outbox quota triggers write ledger rows', () => {
    expect(process.versions.bun).toBeDefined();

    const db = new Database(':memory:');
    try {
      const store = createParleyStore({ db, tenantId: TENANT, now: () => NOW });
      const deliveries: Array<{
        target: string;
        content: unknown;
        options: { from?: string; type?: string; contentType?: string; deliveryKey: string };
      }> = [];
      const parley = createParley({
        store,
        defaultHarbor: HARBOR,
        now: () => NOW,
        agentInbox: {
          internal: {
            sendOnce(target, content, options) {
              deliveries.push({ target, content, options });
              return { success: true };
            },
          },
        },
      });

      const admitted = parley.admitAutomatic(automaticAdmission());
      const record = admitted.parley;
      if (!record) throw new Error('expected automatic Sugar admission to create a Parley');

      expect(admitted).toMatchObject({
        replayed: false,
        terminalState: 'fired',
        parley: {
          harbor: HARBOR,
          automatic: { signalId: automaticSignal().signalId, origin: 'sugar-parley' },
        },
      });
      expect(admitted.receiptInserted).toBeTrue();
      expect(admitted.notificationFailures).toEqual([]);
      expect(deliveries).toHaveLength(2);

      deliveries.length = 0;
      const message = {
        parleyId: record.parleyId,
        harbor: HARBOR,
        party: 'bun-agent-a',
        message: 'I will own the durable receipt while you take the follow-up implementation.',
        idempotencyKey: 'bun-sugar-message:one',
      };
      const response = parley.respondSugarParleyMessage(message);

      expect(response).toMatchObject({
        turn: {
          party: 'bun-agent-a',
          performative: 'inform',
          content: message.message,
        },
        turnSequence: 1,
        replayed: false,
        notified: ['bun-agent-b'],
        notifyFailures: [],
      });
      expect(deliveries).toEqual([
        expect.objectContaining({
          target: 'inbox-bun-agent-b',
          options: expect.objectContaining({
            type: 'sugar_parley_message',
            contentType: 'json',
            deliveryKey: `parley_turn:${record.parleyId}:1:bun-agent-b`,
          }),
          content: expect.objectContaining({
            kind: 'sugar_parley_message',
            schemaVersion: 1,
            origin: 'sugar-parley',
            parleyId: record.parleyId,
            message: message.message,
            turnSequence: 1,
          }),
        }),
      ]);
      expect(store.inspectCounts(HARBOR)).toMatchObject({
        parley_records: 1,
        parley_auto_signals: 1,
        parley_auto_terminal_receipts: 1,
        parley_turns: 1,
        parley_notification_outbox: 3,
      });
      expect(db.prepare(`
        SELECT retained_records, retained_signals, retained_turns, retained_outbox
        FROM parley_quota_ledger
        WHERE tenant_id = ? AND harbor = ?
      `).get(TENANT, HARBOR)).toEqual({
        retained_records: 1,
        retained_signals: 1,
        retained_turns: 1,
        retained_outbox: 3,
      });

      const replay = parley.respondSugarParleyMessage(message);
      expect(replay).toMatchObject({
        turnSequence: 1,
        replayed: true,
        notified: [],
        notifyFailures: [],
      });
      expect(deliveries).toHaveLength(1);
      expect(store.inspectCounts(HARBOR)).toMatchObject({
        parley_turns: 1,
        parley_notification_outbox: 3,
      });
    } finally {
      db.close();
    }
  });
});
