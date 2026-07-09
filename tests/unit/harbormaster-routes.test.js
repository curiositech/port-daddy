import { jest } from '@jest/globals';
import Fastify from 'fastify';

const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockQueueSummary = jest.fn();
const mockSchemaHasDispatchColumns = jest.fn();
const mockCreateHarbormaster = jest.fn(() => ({
  queueSummary: mockQueueSummary,
  schemaHasDispatchColumns: mockSchemaHasDispatchColumns,
}));

jest.unstable_mockModule('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

jest.unstable_mockModule('../../lib/harbormaster.js', () => ({
  HARBORMASTER_ACTOR_ID: 'harbormaster',
  createHarbormaster: mockCreateHarbormaster,
}));

const { harbormasterPlugin, readPidFile } = await import('../../routes/harbormaster.js');

describe('harbormaster routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockQueueSummary.mockReturnValue({ queued: 2, blocked: 1, merged: 3, candidates: 1 });
    mockSchemaHasDispatchColumns.mockReturnValue(true);
  });

  test('GET /harbormaster/status returns queue summary and body liveness', async () => {
    const app = Fastify();
    await app.register(harbormasterPlugin, {
      deps: {
        db: { prepare: jest.fn() },
        harbormasterPidFile: '/tmp/pd-hm.pid',
      },
    });

    const res = await app.inject({ method: 'GET', url: '/harbormaster/status' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.actor).toBe('harbormaster');
    expect(body.body).toEqual({ pid: null, alive: false });
    expect(body.schemaReady).toBe(true);
    expect(body.queue).toEqual({ queued: 2, blocked: 1, merged: 3, candidates: 1 });
    expect(mockCreateHarbormaster).toHaveBeenCalledWith({ db: expect.any(Object) });
  });

  test('GET /harbormaster/status degrades explicitly when db is unavailable', async () => {
    const app = Fastify();
    await app.register(harbormasterPlugin, { deps: {} });

    const res = await app.inject({ method: 'GET', url: '/harbormaster/status' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      ok: false,
      actor: 'harbormaster',
      error: 'harbormaster status requires daemon db',
    });
  });

  test('readPidFile rejects missing, invalid, and non-positive pid files', () => {
    mockExistsSync.mockReturnValue(false);
    expect(readPidFile('/tmp/missing.pid')).toBeNull();

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not-a-pid\n');
    expect(readPidFile('/tmp/bad.pid')).toBeNull();

    mockReadFileSync.mockReturnValue('0\n');
    expect(readPidFile('/tmp/zero.pid')).toBeNull();
  });

  test('readPidFile parses a positive pid', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('12345\n');
    expect(readPidFile('/tmp/good.pid')).toBe(12345);
  });
});
