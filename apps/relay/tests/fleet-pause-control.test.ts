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
    expect(await fleetControlRequest(namespace, '/set', { paused: false, expectedRevision: 0, requestId: 'initial-resume' })).toMatchObject({ status: 'unknown' });
    expect(await fleetControlRequest(namespace, '/set', { paused: true })).toMatchObject({ status: 'paused', revision: 1 });
    expect(await fleetControlRequest(namespace, '/set', { paused: false, expectedRevision: 1, requestId: 'initial-resume' })).toMatchObject({ status: 'unpaused', revision: 2 });
    expect(await fleetControlRequest(namespace, '/admit', { expectedRevision: 2 })).toMatchObject({ status: 'unpaused' });
    expect(await fleetControlRequest(namespace, '/set', { paused: true })).toMatchObject({ status: 'paused', revision: 3 });
    expect(await fleetControlRequest(namespace, '/admit', { expectedRevision: 2 })).toMatchObject({ status: 'unknown' });
    expect(await fleetControlRequest(namespace, '/set', { paused: false, expectedRevision: 3, requestId: 'resume-two' })).toMatchObject({ revision: 4 });
    expect(await fleetControlRequest(namespace, '/admit', { expectedRevision: 2 })).toMatchObject({ status: 'unknown' });
    expect(await fleetControlRequest(namespace, '/admit', { expectedRevision: 4 })).toMatchObject({ status: 'unpaused' });
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

  it('persists a run epoch across fresh admission callers and all continuation messages', async () => {
    const { namespace } = memoryFleetControl({ paused: false, revision: 1, pausedAt: 1 });
    expect(await fleetControlRequest(namespace, '/admit', { runId: 'owner/repo/run:one' })).toMatchObject({ revision: 1 });
    await fleetControlRequest(namespace, '/set', { paused: true });
    await fleetControlRequest(namespace, '/set', { paused: false, expectedRevision: 2, requestId: 'resume' });
    expect(await fleetControlRequest(namespace, '/admit', { runId: 'owner/repo/run:one' })).toMatchObject({
      status: 'unknown', reason: 'run-revision-changed',
    });
    expect(await fleetControlRequest(namespace, '/admit', { runId: 'owner/repo/run:two' })).toMatchObject({ revision: 3 });
  });

  it('binds a delivery whose first observation is paused and refuses to rebind it after resume', async () => {
    const { namespace } = memoryFleetControl({ paused: true, revision: 7, pausedAt: 1 });
    expect(await fleetControlRequest(namespace, '/admit', {
      runId: 'owner/repo/run:first-seen-paused',
    })).toMatchObject({ status: 'paused', revision: 7 });
    expect(await fleetControlRequest(namespace, '/set', {
      paused: false,
      expectedRevision: 7,
      requestId: 'resume-after-paused-observation',
    })).toMatchObject({ status: 'unpaused', revision: 8 });
    expect(await fleetControlRequest(namespace, '/admit', {
      expectedRevision: 8,
      runId: 'owner/repo/run:first-seen-paused',
    })).toMatchObject({ status: 'unknown', reason: 'run-revision-changed' });
    expect(await fleetControlRequest(namespace, '/admit', {
      expectedRevision: 8,
      runId: 'owner/repo/run:fresh-after-resume',
    })).toMatchObject({ status: 'unpaused', revision: 8 });
  });

  it('replayed and delayed resumes cannot override a newer emergency pause', async () => {
    const { namespace } = memoryFleetControl({ paused: true, revision: 1, pausedAt: 1 });
    const resume = { paused: false, expectedRevision: 1, requestId: 'resume-once' };
    expect(await fleetControlRequest(namespace, '/set', resume)).toMatchObject({ revision: 2, status: 'unpaused' });
    expect(await fleetControlRequest(namespace, '/set', resume)).toMatchObject({ revision: 2, status: 'unpaused' });
    await fleetControlRequest(namespace, '/set', { paused: true });
    expect(await fleetControlRequest(namespace, '/set', resume)).toMatchObject({ status: 'unknown', reason: 'resume-superseded' });
    expect(await fleetControlRequest(namespace, '/set', { ...resume, requestId: 'delayed-resume' })).toMatchObject({ status: 'unknown', reason: 'revision-changed' });
    expect(await fleetControlRequest(namespace, '/read')).toMatchObject({ status: 'paused', revision: 3 });
    expect(await fleetControlRequest(namespace, '/set', { paused: false })).toMatchObject({ status: 'unknown' });
  });
});
