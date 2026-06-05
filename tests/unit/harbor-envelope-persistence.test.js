/**
 * Unit tests for harbor envelope persistence + enforcement on lib/harbors.ts.
 *
 * These cover the wiring between the pure envelope module
 * (lib/harbor-envelope.ts) and the harbor store: storing an envelope on a
 * harbor, reading it back, and the membership-aware `assertWithinEnvelope`
 * capability check that downstream callers (routes, spawner) use.
 *
 * The invariant under test: enforcement is fail-closed end to end. A harbor
 * with no envelope set, a non-existent harbor, or a non-member agent all DENY.
 */

import { createTestDb } from '../setup-unit.js';
import { createHarbors } from '../../lib/harbors.js';

function freshHarbors() {
  return createHarbors(createTestDb());
}

describe('harbors: envelope persistence', () => {
  test('a new harbor has no envelope (getEnvelope returns null)', () => {
    const harbors = freshHarbors();
    harbors.create('proj');
    expect(harbors.getEnvelope('proj')).toBeNull();
  });

  test('setEnvelope stores and getEnvelope reads it back (normalized)', () => {
    const harbors = freshHarbors();
    harbors.create('proj');
    const res = harbors.setEnvelope('proj', {
      filesystem: ['/Users/erichowens/coding/port-daddy'],
      tools: ['Bash', 'Read'],
      budgetUsd: 25,
    });
    expect(res.success).toBe(true);
    const env = harbors.getEnvelope('proj');
    expect(env).not.toBeNull();
    expect(env.tools).toEqual(['Bash', 'Read']);
    expect(env.budgetUsd).toBe(25);
    // normalized: unspecified dimensions become deny-all (empty arrays)
    expect(env.skills).toEqual([]);
  });

  test('setEnvelope on a missing harbor fails', () => {
    const harbors = freshHarbors();
    const res = harbors.setEnvelope('ghost', { tools: ['*'] });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  test('envelope survives a re-read through a fresh module on the same db', () => {
    const db = createTestDb();
    const h1 = createHarbors(db);
    h1.create('proj');
    h1.setEnvelope('proj', { backends: ['claude'], budgetUsd: null });
    const h2 = createHarbors(db); // simulate daemon restart, same db
    const env = h2.getEnvelope('proj');
    expect(env.backends).toEqual(['claude']);
    expect(env.budgetUsd).toBeNull();
  });
});

describe('harbors: assertWithinEnvelope (fail-closed capability check)', () => {
  async function harborWithMember(envelope) {
    const harbors = freshHarbors();
    harbors.create('proj');
    if (envelope) harbors.setEnvelope('proj', envelope);
    await harbors.enter('proj', 'agent-1', { identity: 'proj:build' });
    return harbors;
  }

  test('non-existent harbor denies (boundary: membership)', () => {
    const harbors = freshHarbors();
    const v = harbors.assertWithinEnvelope('ghost', 'agent-1', { kind: 'tool', name: 'Bash' });
    expect(v.allowed).toBe(false);
    expect(v.boundary).toBe('membership');
  });

  test('non-member agent denies (boundary: membership)', async () => {
    const harbors = await harborWithMember({ tools: ['*'] });
    const v = harbors.assertWithinEnvelope('proj', 'stranger', { kind: 'tool', name: 'Bash' });
    expect(v.allowed).toBe(false);
    expect(v.boundary).toBe('membership');
  });

  test('member + harbor with no envelope set denies everything (deny-all default)', async () => {
    const harbors = await harborWithMember(null);
    const v = harbors.assertWithinEnvelope('proj', 'agent-1', { kind: 'tool', name: 'Bash' });
    expect(v.allowed).toBe(false);
    expect(v.boundary).toBe('tools');
  });

  test('member + permitted action allows', async () => {
    const harbors = await harborWithMember({ tools: ['Bash'], filesystem: ['/Users/erichowens/coding/port-daddy'] });
    expect(harbors.assertWithinEnvelope('proj', 'agent-1', { kind: 'tool', name: 'Bash' }).allowed).toBe(true);
    expect(harbors.assertWithinEnvelope('proj', 'agent-1', {
      kind: 'fs', op: 'write', path: '/Users/erichowens/coding/port-daddy/x.ts',
    }).allowed).toBe(true);
  });

  test('member + forbidden action denies with the right boundary', async () => {
    const harbors = await harborWithMember({ tools: ['Bash'] });
    const v = harbors.assertWithinEnvelope('proj', 'agent-1', { kind: 'fs', op: 'read', path: '/etc/passwd' });
    expect(v.allowed).toBe(false);
    expect(v.boundary).toBe('filesystem');
  });

  test('an expired harbor denies (boundary: membership)', async () => {
    const harbors = freshHarbors();
    harbors.create('temp', { expiresIn: -1 }); // already expired
    harbors.setEnvelope('temp', { tools: ['*'] });
    const v = harbors.assertWithinEnvelope('temp', 'agent-1', { kind: 'tool', name: 'Bash' });
    expect(v.allowed).toBe(false);
    expect(v.boundary).toBe('membership');
  });
});
