// Skill Graft Events — lib/skill-graft-events.ts
//
// Closes the "native fleet graft injects silently" gap: schemas/agent-harbor/
// v0/skill-graft.schema.json says grafts are "auditable facts with a reason
// and an outcome, not silent prompt injection", but before this module
// fleet-engine's craft-and-splice path (appendSkillGraftContext) never
// recorded anything. Two things are locked here:
//   1. buildSkillGraftEvent() (pure) produces schema-conformant records.
//   2. fleet-engine's wiring records one on a successful splice, through the
//      SAME emit()/onEvent transcript sink every other spawn fact uses, and
//      never lets a broken recorder break the spawn (fail-open).

import { jest } from '@jest/globals';
import { readFileSync as realReadFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse as realYamlParse, parseDocument as realParseDocument, LineCounter as RealLineCounter, isScalar as realIsScalar, isMap as realIsMap, isSeq as realIsSeq } from 'yaml';

const __dir = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dir, '..', '..', 'schemas', 'agent-harbor', 'v0', 'skill-graft.schema.json');
const SCHEMA = JSON.parse(realReadFileSync(SCHEMA_PATH, 'utf8'));

// ─── Mocks (must be set up before any import of fleet-engine.js) ────────────
// Mirrors tests/unit/fleet-engine.test.js's "Skill Graft wiring" harness —
// fleet-engine.ts transitively imports node:fs/node:child_process/yaml even
// on the fast (no skill_graft) path, so ESM module linking needs stubs.

const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockMkdirSync = jest.fn();

jest.unstable_mockModule('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  appendFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  mkdirSync: mockMkdirSync,
  chmodSync: jest.fn(),
  watch: jest.fn(() => ({ close: jest.fn() })),
  statSync: jest.fn(() => ({ mtimeMs: 0 })),
  readdirSync: jest.fn(() => []),
}));

const mockSpawn = jest.fn();
const mockExecSync = jest.fn();

jest.unstable_mockModule('node:child_process', () => ({
  spawn: mockSpawn,
  execSync: mockExecSync,
  execFileSync: jest.fn(),
  execFile: jest.fn((_cmd, _args, cb) => { if (typeof cb === 'function') cb(null, '', ''); }),
  spawnSync: jest.fn(() => ({ status: 1, stdout: '', stderr: '' })),
}));

jest.unstable_mockModule('yaml', () => ({
  parse: (text) => {
    try { return JSON.parse(text); } catch { return realYamlParse(text); }
  },
  parseDocument: realParseDocument,
  LineCounter:   RealLineCounter,
  isScalar:      realIsScalar,
  isMap:         realIsMap,
  isSeq:         realIsSeq,
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

const { buildSkillGraftEvent, SKILL_GRAFT_INITIAL_OUTCOME } = await import('../../lib/skill-graft-events.js');
const { createFleetRunner } = await import('../../lib/fleet-engine.js');
const TEST_DAEMON_URL = 'http://127.0.0.1:4319';
let previousFleetDaemonUrl;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(agentOverrides = {}) {
  return {
    name: 'test-fleet',
    limits: { budgetUsdPerDay: 5 },
    agents: [
      {
        name: 'test-agent',
        backend: 'claude-cli',
        prompt: 'Do something',
        schedule: undefined,
        trigger: undefined,
        worktree: false,
        singleton: false,
        ...agentOverrides,
      },
    ],
    watchers: [],
    channels: {},
  };
}

function makeGraftResult(overrides = {}) {
  return {
    query: 'Do something',
    scannedCount: 42,
    roots: [],
    shortlist: [
      { id: 'rag-retrieval-pattern-design', description: 'RAG chunking and hybrid search', category: 'AI', tags: [], similarity: 0.91 },
      { id: 'skill-architect', description: 'Design new skills', category: 'Meta', tags: [], similarity: 0.4 },
    ],
    top: [
      { id: 'rag-retrieval-pattern-design', description: 'RAG chunking and hybrid search', category: 'AI', tags: [], similarity: 0.91, body: '# RAG\n\nbody text', sourcePath: '/skills/rag/SKILL.md' },
    ],
    semanticTier: 'hybrid',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  previousFleetDaemonUrl = process.env.PD_URL;
  process.env.PD_URL = TEST_DAEMON_URL;
  mockExecSync.mockReturnValue('main');
  const mockChild = {
    pid: 1234,
    unref: jest.fn(),
    kill: jest.fn(),
    stdout: { on: jest.fn() },
    stderr: { on: jest.fn() },
    on: jest.fn(),
  };
  mockSpawn.mockReturnValue(mockChild);
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ agentId: 'abc', status: 'spawned' }),
  });
});

afterEach(() => {
  jest.useRealTimers();
  if (previousFleetDaemonUrl === undefined) delete process.env.PD_URL;
  else process.env.PD_URL = previousFleetDaemonUrl;
});

// ─── buildSkillGraftEvent (pure) ─────────────────────────────────────────────

describe('buildSkillGraftEvent', () => {
  test('produces one record per fully-spliced (top) skill, validating against the schema required fields', () => {
    const result = makeGraftResult();
    const events = buildSkillGraftEvent({
      agentNodeId: 'test-fleet:fleet:test-agent',
      result,
      grantedBy: 'fleet-ship:test-fleet:fleet:test-agent',
      newId: () => 'fixed-id',
      now: () => '2026-08-19T00:00:00.000Z',
    });

    expect(events).toHaveLength(1);
    const [event] = events;

    // Programmatic schema conformance: every field the schema requires
    // must be present (non-undefined) on the built record.
    for (const field of SCHEMA.required) {
      expect(event[field]).not.toBeUndefined();
    }
    expect(event.schema).toBe(SCHEMA.properties.schema.const);
    expect(SCHEMA.properties.level.enum).toContain(event.level);
    expect(SCHEMA.properties.outcome.enum).toContain(event.outcome);

    expect(event.agentNodeId).toBe('test-fleet:fleet:test-agent');
    expect(event.skillName).toBe('rag-retrieval-pattern-design');
    expect(event.level).toBe('full');
    expect(event.grantedBy).toBe('fleet-ship:test-fleet:fleet:test-agent');
    expect(event.outcome).toBe('pending');
    expect(event.outcome).toBe(SKILL_GRAFT_INITIAL_OUTCOME);
    expect(event.createdAt).toBe('2026-08-19T00:00:00.000Z');
    expect(event.graftId).toBe('graft_fixed-id');

    // reason = task-match rationale: this skill's id, its similarity, the
    // ranking tier, and the sibling ids it was shortlisted alongside.
    expect(event.reason).toContain('rag-retrieval-pattern-design');
    expect(event.reason).toContain('0.910');
    expect(event.reason).toContain('hybrid');
    expect(event.reason).toContain('skill-architect');
  });

  test('one record per top entry when multiple skills were fully spliced', () => {
    const result = makeGraftResult({
      top: [
        { id: 'rag-retrieval-pattern-design', description: 'd1', category: 'AI', tags: [], similarity: 0.91, body: 'b1', sourcePath: '/a' },
        { id: 'skill-architect', description: 'd2', category: 'Meta', tags: [], similarity: 0.4, body: 'b2', sourcePath: '/b' },
      ],
    });
    const events = buildSkillGraftEvent({
      agentNodeId: 'node-1',
      result,
      grantedBy: 'fleet-ship:node-1',
    });
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.skillName)).toEqual(['rag-retrieval-pattern-design', 'skill-architect']);
    // graftIds are unique even with the real default id generator.
    expect(new Set(events.map((e) => e.graftId)).size).toBe(2);
    expect(events.every((e) => e.level === 'full')).toBe(true);
  });

  test('returns [] when nothing was fully spliced (top empty) — a shortlist mention is not a graft', () => {
    const result = makeGraftResult({ top: [] });
    const events = buildSkillGraftEvent({
      agentNodeId: 'node-1',
      result,
      grantedBy: 'fleet-ship:node-1',
    });
    expect(events).toEqual([]);
  });

  test('a lexical-only (BM25) match with similarity 0 reports "lexical match", not a misleading 0.000', () => {
    const result = makeGraftResult({
      semanticTier: 'lexical-only',
      top: [{ id: 'skill-architect', description: 'd', category: 'Meta', tags: [], similarity: 0, body: 'b', sourcePath: '/b' }],
    });
    const [event] = buildSkillGraftEvent({ agentNodeId: 'node-1', result, grantedBy: 'fleet-ship:node-1' });
    expect(event.reason).toContain('lexical match');
    expect(event.reason).not.toContain('0.000');
  });

  test('default newId/now produce a well-formed graftId and an ISO createdAt', () => {
    const result = makeGraftResult();
    const [event] = buildSkillGraftEvent({ agentNodeId: 'node-1', result, grantedBy: 'fleet-ship:node-1' });
    expect(event.graftId).toMatch(/^graft_[0-9a-f-]{36}$/);
    expect(new Date(event.createdAt).toISOString()).toBe(event.createdAt);
  });
});

// ─── fleet-engine wiring ──────────────────────────────────────────────────────

describe('fleet-engine skill-graft event recording', () => {
  test('a successful craft-and-splice records one skill_graft_recorded event through the existing emit() sink', async () => {
    const craft = jest.fn().mockResolvedValue(makeGraftResult());
    const onEvent = jest.fn();
    const config = makeConfig({ skillGraft: true });
    const runner = createFleetRunner(config, '/tmp/proj', { skillGraft: { craft }, onEvent });

    await runner.hailAgent('test-agent', { source: 'manual' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const recorded = onEvent.mock.calls.map((call) => call[0]).filter((event) => event.type === 'skill_graft_recorded');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toEqual(expect.objectContaining({
      type: 'skill_graft_recorded',
      agent: 'test-agent',
      identity: 'test-fleet:fleet:test-agent',
      project: 'test-fleet',
    }));
    expect(recorded[0].details.grafts).toHaveLength(1);
    expect(recorded[0].details.grafts[0]).toEqual(expect.objectContaining({
      schema: 'pd.agent-harbor.skill-graft.v0',
      agentNodeId: 'test-fleet:fleet:test-agent',
      skillName: 'rag-retrieval-pattern-design',
      level: 'full',
      outcome: 'pending',
      grantedBy: 'fleet-ship:test-fleet:fleet:test-agent',
    }));
    for (const field of SCHEMA.required) {
      expect(recorded[0].details.grafts[0][field]).not.toBeUndefined();
    }

    // The spawn itself still went through with the grafted task, unaffected
    // by the (separate) event-recording call.
    const spawnCall = global.fetch.mock.calls.find((c) => String(c[0]).includes('/spawn'));
    expect(spawnCall).toBeDefined();
    const body = JSON.parse(spawnCall[1].body);
    expect(body.task).toContain('rag-retrieval-pattern-design');
  });

  test('no event is recorded when craft() shortlists but splices nothing (top empty)', async () => {
    const craft = jest.fn().mockResolvedValue(makeGraftResult({ top: [] }));
    const onEvent = jest.fn();
    const config = makeConfig({ skillGraft: true });
    const runner = createFleetRunner(config, '/tmp/proj', { skillGraft: { craft }, onEvent });

    await runner.hailAgent('test-agent', { source: 'manual' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const recorded = onEvent.mock.calls.map((call) => call[0]).filter((event) => event.type === 'skill_graft_recorded');
    expect(recorded).toHaveLength(0);
  });

  test('spawn survives a throwing recorder: a broken onEvent sink fails open with a logged warning', async () => {
    const craft = jest.fn().mockResolvedValue(makeGraftResult());
    const onEvent = jest.fn((event) => {
      if (event.type === 'skill_graft_recorded') throw new Error('recorder exploded');
    });
    const config = makeConfig({ skillGraft: true });
    const runner = createFleetRunner(config, '/tmp/proj', { skillGraft: { craft }, onEvent });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await runner.hailAgent('test-agent', { source: 'manual' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The recording failure is caught and logged, not thrown up the stack.
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('skill-graft event recording failed for agent "test-agent"'),
      expect.stringContaining('recorder exploded'),
    );

    // The spawn (with the already-rendered grafted task) still happened.
    const spawnCall = global.fetch.mock.calls.find((c) => String(c[0]).includes('/spawn'));
    expect(spawnCall).toBeDefined();
    const body = JSON.parse(spawnCall[1].body);
    expect(body.task).toContain('rag-retrieval-pattern-design');

    // And the rest of the normal spawn-lifecycle events still fired.
    const types = onEvent.mock.calls.map((call) => call[0].type);
    expect(types).toContain('agent_started');
    expect(types).toContain('agent_completed');

    errSpy.mockRestore();
  });
});
