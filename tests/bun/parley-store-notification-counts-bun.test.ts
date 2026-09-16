/**
 * Parley outbox receipts under the shipped bun:sqlite runtime.
 *
 * bun:sqlite includes quota-trigger ledger writes in Statement#run().changes.
 * A successful outbox INSERT therefore reports more than one mutation even
 * though exactly one notification row was inserted.
 */

import { describe, expect, test } from 'bun:test';

import { createParley } from '../../lib/parley.ts';
import { createParleyStore } from '../../lib/parley-store.ts';
import Database from '../../lib/sqlite-runtime.ts';

describe('Parley notification receipts under bun:sqlite', () => {
  test('a three-party turn accepts trigger-inclusive changes and replays exactly once', () => {
    const db = new Database(':memory:');
    try {
      const now = () => 1_700_000_000_000;
      const store = createParleyStore({ db, tenantId: 'bun-outbox-proof', now });
      const parley = createParley({
        store,
        defaultHarbor: 'proof',
        now,
        agentInbox: {
          internal: {
            sendOnce() {
              return { success: true, messageId: 1 };
            },
          },
        },
      });
      const opened = parley.call({
        surface: 'src/checkout.ts',
        reason: 'three owners need one durable public decision',
        parties: ['nora', 'milo', 'aya'],
        calledBy: 'nora',
      });
      const request = {
        parleyId: opened.parleyId,
        party: 'nora',
        performative: 'propose' as const,
        content: 'reserve inventory before capture',
        idempotencyKey: 'bun-three-party-turn',
      };

      const first = parley.respond(request);
      const replay = parley.respond(request);

      expect(first).toMatchObject({
        turnSequence: 1,
        replayed: false,
        notified: ['aya', 'milo'],
        notifyFailures: [],
      });
      expect(replay).toMatchObject({ turnSequence: 1, replayed: true });
      expect(db.prepare(`
        SELECT delivery_key FROM parley_notification_outbox
        WHERE tenant_id = ? AND harbor = ? AND parley_id = ? AND event_type = 'parley_turn'
        ORDER BY delivery_key
      `).all('bun-outbox-proof', 'proof', opened.parleyId)).toEqual([
        { delivery_key: `parley_turn:${opened.parleyId}:1:aya` },
        { delivery_key: `parley_turn:${opened.parleyId}:1:milo` },
      ]);
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM parley_turns
        WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
      `).get('bun-outbox-proof', 'proof', opened.parleyId)).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });
});
