import { describe, it, expect } from 'vitest';
import { fleetControlRequest, parseFleetControl } from '../src/fleet-pause-control.js';
import { memoryFleetControl } from './fleet-control-fixture.js';

describe('transactional Fleet pause authority', () => {
  it.each([undefined, null, false, 'false', {}, { paused: false }, { paused: 'false', revision: 1, pausedAt: 1 },
    { paused: false, revision: 0, pausedAt: 1 }, { paused: false, revision: 1.5, pausedAt: 1 }])(
    'never interprets invalid state %j as unpaused', value => {
      expect(parseFleetControl(value)).toMatchObject({ status: 'unknown', paused: null });
    });
  it('starts unknown, commits revisions, and fences an old unpaused admission after pause/resume', async () => {
    const { namespace } = memoryFleetControl();
    expect(await fleetControlRequest(namespace, '/read')).toMatchObject({ status: 'unknown' });
    expect(await fleetControlRequest(namespace, '/set', { paused: false })).toMatchObject({ status: 'unpaused', revision: 1 });
    expect(await fleetControlRequest(namespace, '/admit', { expectedRevision: 1 })).toMatchObject({ status: 'unpaused' });
    expect(await fleetControlRequest(namespace, '/set', { paused: true })).toMatchObject({ status: 'paused', revision: 2 });
    expect(await fleetControlRequest(namespace, '/admit', { expectedRevision: 1 })).toMatchObject({ status: 'unknown' });
    expect(await fleetControlRequest(namespace, '/set', { paused: false })).toMatchObject({ revision: 3 });
    expect(await fleetControlRequest(namespace, '/admit', { expectedRevision: 1 })).toMatchObject({ status: 'unknown' });
    expect(await fleetControlRequest(namespace, '/admit', { expectedRevision: 3 })).toMatchObject({ status: 'unpaused' });
  });
  it('serializes a concurrent pause before a subsequent admission', async () => {
    const { namespace } = memoryFleetControl({ paused: false, revision: 1, pausedAt: 1 });
    const paused = fleetControlRequest(namespace, '/set', { paused: true });
    const admission = fleetControlRequest(namespace, '/admit', { expectedRevision: 1 });
    expect(await paused).toMatchObject({ status: 'paused', revision: 2 });
    expect(await admission).toMatchObject({ status: 'unknown' });
  });
  it('never acknowledges a write that failed durable storage', async () => {
    const broken = { idFromName: () => 'global', get: () => ({ fetch: () => { throw new Error('storage unavailable'); } }) } as unknown as DurableObjectNamespace;
    expect(await fleetControlRequest(broken, '/set', { paused: false })).toMatchObject({ status: 'unknown' });
    expect(await fleetControlRequest(undefined, '/read')).toMatchObject({ status: 'unknown', reason: 'binding-missing' });
  });
  it('fences corrupt revision state rather than resetting it', async () => {
    const { namespace, values } = memoryFleetControl({ paused: false, revision: 4, pausedAt: 1 });
    values.delete('revision');
    expect(await fleetControlRequest(namespace, '/admit')).toMatchObject({ status: 'unknown' });
    expect(await fleetControlRequest(namespace, '/set', { paused: false })).toMatchObject({ status: 'unknown' });
  });
});
