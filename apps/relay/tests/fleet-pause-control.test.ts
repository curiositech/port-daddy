import { describe, it, expect } from 'vitest';
import {
  commitFleetResume,
  fleetControlRequest,
  parseFleetControl,
  prepareFleetResume,
} from '../src/fleet-pause-control.js';
import { memoryFleetControl } from './fleet-control-fixture.js';

async function resume(
  namespace: DurableObjectNamespace,
  expectedRevision: number,
  requestId: string,
) {
  const preparation = await prepareFleetResume(namespace, { expectedRevision, requestId });
  if (preparation.status !== 'prepared') return preparation;
  return commitFleetResume(namespace, {
    expectedRevision,
    requestId,
    targetRevision: preparation.targetRevision,
  });
}

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
    expect(await resume(namespace, 1, 'initial-resume')).toMatchObject({ status: 'unpaused', revision: 2 });
    expect(await fleetControlRequest(namespace, '/admit', { expectedRevision: 2 })).toMatchObject({ status: 'unpaused' });
    expect(await fleetControlRequest(namespace, '/set', { paused: true })).toMatchObject({ status: 'paused', revision: 3 });
    expect(await fleetControlRequest(namespace, '/admit', { expectedRevision: 2 })).toMatchObject({ status: 'unknown' });
    expect(await resume(namespace, 3, 'resume-two')).toMatchObject({ revision: 4 });
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
  it('keeps the canonical object paused until an exact prepared resume commits', async () => {
    const { namespace } = memoryFleetControl({ paused: true, revision: 4, pausedAt: 1 });
    const preparation = await prepareFleetResume(namespace, {
      expectedRevision: 4,
      requestId: 'prepared-not-on',
    });
    expect(preparation).toMatchObject({
      status: 'prepared',
      revision: 4,
      targetRevision: 5,
    });
    expect(await fleetControlRequest(namespace, '/read')).toMatchObject({
      status: 'paused',
      revision: 4,
    });
    expect(await fleetControlRequest(namespace, '/admit', {
      runId: 'owner/repo/prepared-not-on',
    })).toMatchObject({ status: 'paused', revision: 4 });
    expect(await commitFleetResume(namespace, {
      expectedRevision: 4,
      requestId: 'prepared-not-on',
      targetRevision: preparation.status === 'prepared' ? preparation.targetRevision : 0,
    })).toMatchObject({ status: 'unpaused', revision: 5 });
  });
  it('converges distinct concurrent resume requests for the same paused epoch', async () => {
    const { namespace } = memoryFleetControl({ paused: true, revision: 1, pausedAt: 1 });
    const [first, second] = await Promise.all([
      resume(namespace, 1, 'concurrent-resume-a'),
      resume(namespace, 1, 'concurrent-resume-b'),
    ]);
    expect(first).toMatchObject({ status: 'unpaused', revision: 2 });
    expect(second).toMatchObject({ status: 'unpaused', revision: 2 });
    expect(await fleetControlRequest(namespace, '/read'))
      .toMatchObject({ status: 'unpaused', revision: 2 });
  });
  it('an emergency pause supersedes a prepared resume before commit', async () => {
    const { namespace } = memoryFleetControl({ paused: true, revision: 9, pausedAt: 1 });
    const preparation = await prepareFleetResume(namespace, {
      expectedRevision: 9,
      requestId: 'pause-wins',
    });
    expect(preparation.status).toBe('prepared');
    expect(await fleetControlRequest(namespace, '/set', { paused: true }))
      .toMatchObject({ status: 'paused', revision: 10 });
    expect(await commitFleetResume(namespace, {
      expectedRevision: 9,
      requestId: 'pause-wins',
      targetRevision: preparation.status === 'prepared' ? preparation.targetRevision : 0,
    })).toMatchObject({ status: 'unknown', reason: 'revision-changed' });
    expect(await fleetControlRequest(namespace, '/read'))
      .toMatchObject({ status: 'paused', revision: 10 });
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
    await resume(namespace, 2, 'resume');
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
    expect(await resume(namespace, 7, 'resume-after-paused-observation'))
      .toMatchObject({ status: 'unpaused', revision: 8 });
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
    expect(await resume(namespace, 1, 'resume-once')).toMatchObject({ revision: 2, status: 'unpaused' });
    expect(await resume(namespace, 1, 'resume-once')).toMatchObject({ revision: 2, status: 'unpaused' });
    await fleetControlRequest(namespace, '/set', { paused: true });
    expect(await resume(namespace, 1, 'resume-once')).toMatchObject({ status: 'unknown', reason: 'resume-superseded' });
    expect(await resume(namespace, 1, 'delayed-resume')).toMatchObject({ status: 'unknown', reason: 'revision-changed' });
    expect(await fleetControlRequest(namespace, '/read')).toMatchObject({ status: 'paused', revision: 3 });
    expect(await fleetControlRequest(namespace, '/set', { paused: false })).toMatchObject({ status: 'unknown' });
  });
});
