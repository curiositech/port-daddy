/** No real registry adapters, filesystem fixtures, network or subprocesses. */
import { beforeEach, expect, jest, test } from '@jest/globals';
const available = jest.fn<() => Promise<{ ready: boolean }>>();
const dispatch = jest.fn<() => Promise<object>>();
const triggerAvailable = jest.fn<() => Promise<{ ready: boolean }>>();
const stop = jest.fn<() => Promise<void>>();
const start = jest.fn<any>();
const resolveTrigger = jest.fn(() => ({ source: { available: triggerAvailable, start }, spec: { kind: 'file' } }));
const resolveOutput = jest.fn((_target, payload) => ({
  sink: { available, dispatch }, payload: { ...payload, sink: 'file', type: 'append' },
}));
jest.unstable_mockModule('../../lib/fleet/triggers/index.js', () => ({
  buildTriggerRegistry: () => new Map(), resolveTrigger,
}));
jest.unstable_mockModule('../../lib/fleet/outputs/index.js', () => ({
  buildOutputRegistry: () => new Map(), resolveOutput,
}));
jest.unstable_mockModule('../../lib/fleet/consent-gate.js', () => ({
  getSharedConsentGate: () => ({ assertAllowed: jest.fn() }),
}));
const { IoDispatch } = await import('../../lib/fleet/io-dispatch.js');
const payload = { body: 'synthetic output', pii: 'low' as const };
beforeEach(() => {
  jest.clearAllMocks();
  available.mockImplementation(async () => ({ ready: true }));
  dispatch.mockImplementation(async () => ({}));
  triggerAvailable.mockImplementation(async () => ({ ready: true }));
  stop.mockImplementation(async () => {});
  start.mockImplementation(async () => ({ stop }));
});

test('positive fixture dispatches an admitted output', async () => {
  expect((await new IoDispatch({ runtimeAllowed: () => true }).dispatchOutput('file:fixture', payload)).ok).toBe(true);
  expect(dispatch).toHaveBeenCalledTimes(1);
});

test.each([false, undefined])('denies %s before even resolving or probing output adapters', async (allowed) => {
  const bridge = new IoDispatch({ runtimeAllowed: () => allowed as boolean });
  expect(await bridge.dispatchOutput('file:fixture', payload)).toMatchObject({ ok: false, reason: expect.stringContaining('Off') });
  expect(resolveOutput).not.toHaveBeenCalled();
  expect(available).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});

test('Off during awaited availability prevents dispatch and stays latched', async () => {
  let allowed = true;
  const bridge = new IoDispatch({ runtimeAllowed: () => allowed });
  available.mockImplementationOnce(async () => { allowed = false; return { ready: true }; });
  expect((await bridge.dispatchOutput('file:first', payload)).ok).toBe(false);
  allowed = true;
  expect((await bridge.dispatchOutput('file:second', payload)).ok).toBe(false);
  expect(available).toHaveBeenCalledTimes(1);
  expect(dispatch).not.toHaveBeenCalled();
});

test('Off after an admitted output prevents the next target, without claiming recall', async () => {
  let allowed = true;
  dispatch.mockImplementationOnce(async () => { allowed = false; return {}; });
  const results = await new IoDispatch({ runtimeAllowed: () => allowed })
    .dispatchOutputs(['file:first', 'file:second'], payload);
  expect(results.map((result) => result.ok)).toEqual([true, false]);
  expect(dispatch).toHaveBeenCalledTimes(1);
});

test('throwing control observation latches instead of escaping the output bridge', async () => {
  let throwing = true;
  const bridge = new IoDispatch({ runtimeAllowed: () => {
    if (throwing) throw new Error('synthetic unavailable control');
    return true;
  } });
  expect((await bridge.dispatchOutput('file:first', payload)).ok).toBe(false);
  throwing = false;
  expect((await bridge.dispatchOutput('file:second', payload)).ok).toBe(false);
  expect(dispatch).not.toHaveBeenCalled();
});

test('trigger positive control starts only the synthetic source and forwards admitted events', async () => {
  const onFire = jest.fn();
  const result = await new IoDispatch({ runtimeAllowed: () => true }).startTrigger('file:fixture', onFire);
  expect(result.started).toBe(true);
  start.mock.calls[0][1]({ id: 'fixture-event' });
  expect(onFire).toHaveBeenCalledTimes(1);
});

test('Off refuses triggers before source resolution or availability probes', async () => {
  expect((await new IoDispatch({ runtimeAllowed: () => false }).startTrigger('file:fixture', jest.fn())).started).toBe(false);
  expect(resolveTrigger).not.toHaveBeenCalled();
  expect(triggerAvailable).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});

test('Off during trigger availability prevents source startup', async () => {
  let allowed = true;
  triggerAvailable.mockImplementationOnce(async () => { allowed = false; return { ready: true }; });
  expect((await new IoDispatch({ runtimeAllowed: () => allowed }).startTrigger('file:fixture', jest.fn())).started).toBe(false);
  expect(start).not.toHaveBeenCalled();
});

test('Off during admitted startup disposes the late handle and suppresses callbacks', async () => {
  let allowed = true;
  const onFire = jest.fn();
  start.mockImplementationOnce(async (_spec: unknown, onEvent: (event: object) => void) => {
    allowed = false;
    onEvent({ id: 'in-flight-event' });
    return { stop };
  });
  expect((await new IoDispatch({ runtimeAllowed: () => allowed }).startTrigger('file:fixture', onFire)).started).toBe(false);
  expect(stop).toHaveBeenCalledTimes(1);
  allowed = true; // Removing a marker does not revive this bridge's callbacks.
  start.mock.calls[0][1]({ id: 'late-event' });
  expect(onFire).not.toHaveBeenCalled();
});

test('late shutdown failure is explicit and retains the handle for cleanup', async () => {
  let allowed = true;
  start.mockImplementationOnce(async () => { allowed = false; return { stop }; });
  stop.mockRejectedValueOnce(new Error('synthetic stop failure'));
  expect(await new IoDispatch({ runtimeAllowed: () => allowed }).startTrigger('file:fixture', jest.fn()))
    .toMatchObject({ started: false, reason: expect.stringContaining('cleanup failed'), cleanupHandle: { stop } });
});
