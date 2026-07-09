import { jest, beforeEach, describe, expect, test } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createTranscripts } from '../../lib/transcripts.js';
import { TRANSCRIPT_EMERGENCY_KIND } from '../../lib/transcript-emergency.js';

const mockSpawn = jest.fn(() => ({ unref: jest.fn() }));
const mockSpawnSync = jest.fn(() => ({ status: 1, stdout: '', stderr: '' }));

jest.unstable_mockModule('node:child_process', () => ({
  spawn: mockSpawn,
  spawnSync: mockSpawnSync,
  execSync: jest.fn(() => ''),
  execFileSync: jest.fn(),
  execFile: jest.fn((_cmd, _args, cb) => { if (typeof cb === 'function') cb(null, '', ''); }),
}));

const { operatorPlugin, __resetGuardCachesForTest } = await import('../../routes/operator.js');

function buildApp(deps = {}) {
  const app = Fastify();
  return {
    app,
    register: () => app.register(operatorPlugin, {
      deps: {
        logger: { info: jest.fn(), error: jest.fn() },
        agents: { list: jest.fn(() => ({ agents: [] })) },
        sessions: {
          list: jest.fn(() => ({ sessions: [] })),
          listAllActiveClaims: jest.fn(() => ({ claims: [] })),
        },
        resurrection: { list: jest.fn(() => ({ agents: [] })) },
        spawner: { list: jest.fn(() => []) },
        activityLog: { getRecent: jest.fn(() => ({ entries: [] })) },
        ...deps,
      },
    }),
  };
}

describe('/operator/state transcript emergency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetGuardCachesForTest();
  });

  test('surfaces transcript_emergency in needsYou when live transcript flow stalls', async () => {
    const db = createTestDb();
    const transcripts = createTranscripts(db);
    const now = Date.now();
    const startedAt = now - 10_000;
    const id = transcripts.start({
      ship: 'spawn:cli:codex',
      spawned_agent_id: 'spawned-stalled-hitl',
      trigger: 'manual',
      backend: 'cli:codex',
      model: 'codex-cli',
      started_at: startedAt,
    });
    transcripts.appendMessage(id, {
      role: 'assistant',
      content: 'last stale delta',
      timestamp: startedAt,
    });

    const { app, register } = buildApp({
      transcripts,
      spawner: {
        list: jest.fn(() => [{
          agentId: 'spawned-stalled-hitl',
          backend: 'cli:codex',
          status: 'running',
          startedAt,
          completedAt: null,
        }]),
      },
    });
    await register();

    const res = await app.inject({
      method: 'GET',
      url: '/operator/state?project=port-daddy&stallAfterMs=1',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.transcriptEmergency.hitlEmergency).toBe(true);
    const emergency = body.needsYou.find((item) => item.code === 'transcript_emergency');
    expect(emergency).toEqual(expect.objectContaining({
      label: expect.stringContaining('Transcript emergency'),
      action: '/transcripts/emergency',
      meta: expect.objectContaining({
        kinds: expect.arrayContaining([TRANSCRIPT_EMERGENCY_KIND.LOCAL_SPAWNER]),
      }),
    }));

    await app.close();
    db.close();
  });
});
