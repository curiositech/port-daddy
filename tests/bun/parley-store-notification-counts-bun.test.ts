/**
 * Parley outbox receipts under the shipped bun:sqlite runtime.
 *
 * bun:sqlite includes quota-trigger ledger writes in Statement#run().changes.
 * A successful outbox INSERT therefore reports more than one mutation even
 * though exactly one notification row was inserted.
 */

import { createHash } from 'node:crypto';

import { describe, expect, test } from 'bun:test';

import { createParley } from '../../lib/parley.ts';
import { createParleyStore } from '../../lib/parley-store.ts';
import Database from '../../lib/sqlite-runtime.ts';

function stableJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate && typeof candidate === 'object') {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, normalize(nested)]),
      );
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

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

  test('preexisting exact and mismatched delivery keys fail closed and roll back the attempted turn', () => {
    const db = new Database(':memory:');
    try {
      const tenantId = 'bun-outbox-proof';
      const harbor = 'proof';
      const at = 1_700_000_000_000;
      const now = () => at;
      const store = createParleyStore({ db, tenantId, now });
      const parley = createParley({
        store,
        defaultHarbor: harbor,
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
        idempotencyKey: 'bun-preexisting-delivery-key',
      };
      const payload = stableJson({
        kind: 'parley_turn',
        harbor,
        parleyId: opened.parleyId,
        surface: opened.surface,
        channel: opened.channel,
        party: request.party,
        performative: request.performative,
        content: request.content,
        proposalId: null,
        evidenceRefs: [],
        at,
      });
      const deliveryKey = `parley_turn:${opened.parleyId}:1:aya`;
      db.prepare(`
        INSERT INTO parley_notification_outbox (
          tenant_id, harbor, parley_id, delivery_key, recipient_actor_id,
          inbox_target, from_actor_id, event_type, payload_json, payload_hash,
          state, attempts, available_at, lease_until, lease_token, last_error,
          created_at, delivered_at
        ) VALUES (?, ?, ?, ?, 'aya', 'aya', 'nora', 'parley_turn', ?, ?,
          'pending', 0, ?, NULL, NULL, NULL, ?, NULL)
      `).run(tenantId, harbor, opened.parleyId, deliveryKey, payload, hash(payload), at, at);

      expect(() => parley.respond(request)).toThrow(/notification keys collided/);
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM parley_turns
        WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
      `).get(tenantId, harbor, opened.parleyId)).toEqual({ count: 0 });
      expect(db.prepare(`
        SELECT delivery_key FROM parley_notification_outbox
        WHERE tenant_id = ? AND harbor = ? AND parley_id = ? AND event_type = 'parley_turn'
      `).all(tenantId, harbor, opened.parleyId)).toEqual([{ delivery_key: deliveryKey }]);

      db.prepare(`
        UPDATE parley_notification_outbox SET payload_hash = ?
        WHERE tenant_id = ? AND harbor = ? AND delivery_key = ?
      `).run('0'.repeat(64), tenantId, harbor, deliveryKey);
      expect(() => parley.respond(request)).toThrow(/outbox replay mismatch/);
      expect(db.prepare(`
        SELECT COUNT(*) AS count FROM parley_turns
        WHERE tenant_id = ? AND harbor = ? AND parley_id = ?
      `).get(tenantId, harbor, opened.parleyId)).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });
});
