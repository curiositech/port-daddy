/**
 * Unit Tests: telos-salvage capsule persistence wiring (Item 1).
 *
 * The self-salvage capsule previously had no persistence home. This exercises the
 * additive store on the resurrection queue (attachSalvageCapsule / getSalvageCapsule)
 * that the server.ts agent:dead handler reads as untrusted respawn context, plus the
 * normalizeSelfSalvage producer contract that feeds it.
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createResurrection } from '../../lib/resurrection.js';
import { normalizeSelfSalvage } from '../../lib/telos-salvage.js';

let db: any;
let resurrection: ReturnType<typeof createResurrection>;

beforeEach(() => {
  db = createTestDb();
  resurrection = createResurrection(db);
});
afterEach(() => { db.close(); });

// Force a dead agent into the resurrection queue so there is a row to attach to.
function queueDead(agentId: string) {
  const res = resurrection.check({ id: agentId, name: agentId, lastHeartbeat: 0, status: 'ready' });
  expect(res.status).toBe('dead');
}

describe('normalizeSelfSalvage producer', () => {
  test('a partial + doable capsule with a nextPlan should queue and produces a capsule', () => {
    const result = normalizeSelfSalvage({ telosVerdict: 'partial', doable: 'yes', nextPlan: ['fix parser'] });
    expect(result.success).toBe(true);
    expect(result.shouldQueue).toBe(true);
    expect(result.capsule).toBeTruthy();
    expect(result.capsule!.nextPlan[0]).toBe('fix parser');
  });
});

describe('resurrection capsule store', () => {
  test('attach then get round-trips the capsule through metadata', () => {
    queueDead('dead-1');
    const { capsule } = normalizeSelfSalvage({ telosVerdict: 'partial', doable: 'yes', nextPlan: ['fix parser'] });

    const attached = resurrection.attachSalvageCapsule('dead-1', capsule as any);
    expect(attached.success).toBe(true);

    const read = resurrection.getSalvageCapsule('dead-1');
    expect(read).toBeTruthy();
    expect((read as any).nextPlan[0]).toBe('fix parser');
    // Trusted verdict discriminant survives the round-trip.
    expect((read as any).telosVerdict).toBe('partial');
  });

  test('attach preserves pre-existing metadata (notes) rather than clobbering it', () => {
    // Queue with notes so metadata already has content.
    const res = resurrection.check({ id: 'dead-2', name: 'dead-2', lastHeartbeat: 0, status: 'ready', notes: ['keep me'] });
    expect(res.status).toBe('dead');

    resurrection.attachSalvageCapsule('dead-2', { nextPlan: ['x'] } as any);

    const listed = resurrection.list({ limit: 10 }).agents.find((a: any) => a.id === 'dead-2');
    expect(listed?.notes).toContain('keep me');
    expect(resurrection.getSalvageCapsule('dead-2')).toBeTruthy();
  });

  test('getSalvageCapsule returns undefined for an unknown agent and when none attached', () => {
    expect(resurrection.getSalvageCapsule('never-existed')).toBeUndefined();
    queueDead('dead-3');
    expect(resurrection.getSalvageCapsule('dead-3')).toBeUndefined();
  });

  test('attachSalvageCapsule fails cleanly when the agent is not queued', () => {
    const result = resurrection.attachSalvageCapsule('not-queued', { nextPlan: ['x'] } as any);
    expect(result.success).toBe(false);
  });
});
