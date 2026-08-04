import { describe, expect, test } from '@jest/globals';

import Database from '../../lib/sqlite-runtime.js';
import {
  HARNESS_CONTINUATION_MATRIX_SCHEMA,
  buildHarnessContinuationMatrix,
  collectHarnessConformanceWitnesses,
  renderHarnessContinuationMatrix,
} from '../../lib/harness-conformance.js';

function catalogEntry(id, adapter) {
  return {
    id,
    name: id,
    costModel: 'local',
    framing: 'fixture',
    description: 'fixture',
    models: [],
    adapter,
  };
}

function adapter(family, overrides = {}) {
  return {
    family,
    spawn: { transport: 'agent-cli' },
    resume: { native: false, scope: 'none' },
    acceptsInitialPrompt: true,
    interactiveChannels: ['terminal'],
    transcript: { format: 'custom', owner: 'port-daddy', stability: 'internal' },
    authModes: ['local-none'],
    limitations: ['fixture'],
    ...overrides,
  };
}

describe('harness continuation conformance matrix', () => {
  test('expands the executable catalog into an honest 17 by 17 compatibility matrix', () => {
    const report = buildHarnessContinuationMatrix({ now: new Date('2026-07-15T00:00:00.000Z') });

    expect(report.schema).toBe(HARNESS_CONTINUATION_MATRIX_SCHEMA);
    expect(report.evidencePolicy).toMatchObject({
      numericBadgeGranted: false,
      selfReportCanAdvance: false,
      discoveryProvesRuntime: false,
    });
    expect(report.summary).toMatchObject({
      adapterFamilies: 17,
      paths: 289,
      nativePaths: 4,
      handoffPaths: 285,
      unsupportedPaths: 0,
      witnessedPaths: 0,
    });
    expect(report.compatibility.find((cell) => (
      cell.sourceFamily === 'codex-cli' && cell.targetFamily === 'codex-cli'
    ))).toMatchObject({ autoMode: 'native', native: 'declared', handoff: 'declared' });
    expect(report.compatibility.find((cell) => (
      cell.sourceFamily === 'claude-code' && cell.targetFamily === 'codex-cli'
    ))).toMatchObject({ autoMode: 'handoff', native: 'unsupported', handoff: 'declared' });
    expect(report.compatibility.find((cell) => (
      cell.sourceFamily === 'aider' && cell.targetFamily === 'aider'
    ))).toMatchObject({ autoMode: 'handoff' });
    expect(report.adapters.find((row) => row.family === 'aider').predicates['native-resume']).toMatchObject({
      status: 'unsupported',
      detail: expect.stringContaining('stable native session identity'),
    });
  });

  test('keeps discovery, durable witnesses, freshness, and mechanical declarations separate', () => {
    const catalog = [
      catalogEntry('source', adapter('source-family', {
        resume: { native: true, scope: 'session' },
      })),
      catalogEntry('target', adapter('target-family')),
    ];
    const discovery = {
      probedAt: '2026-07-15T00:00:00.000Z',
      sideEffectFree: true,
      evidenceLevel: 'discovery-only',
      provesCapabilities: false,
      counts: { discovered: 1, unavailable: 0, unverified: 2, 'not-supported': 0 },
      adapters: [{
        family: 'source-family',
        backendIds: ['source'],
        executablePath: '/usr/bin/source',
        spawn: { status: 'discovered', detail: 'help only' },
        resume: { status: 'unverified', detail: 'not exercised' },
        transcript: { status: 'unverified', detail: 'not parsed' },
      }],
    };
    const report = buildHarnessContinuationMatrix({
      catalog,
      discovery,
      now: new Date('2026-07-15T00:00:00.000Z'),
      staleAfterMs: 60_000,
      witnesses: [
        {
          capability: 'spawn',
          adapterFamily: 'source-family',
          witnessId: 'tx-source',
          observedAt: '2026-07-14T23:59:30.000Z',
          detail: 'completed durable transcript',
        },
        {
          capability: 'live-interaction',
          adapterFamily: 'source-family',
          witnessId: 'control-source',
          observedAt: '2026-07-14T23:59:20.000Z',
          detail: 'completed exact-session control receipt',
        },
        {
          capability: 'native-resume',
          adapterFamily: 'source-family',
          sourceAdapterFamily: 'source-family',
          witnessId: 'continuation-native',
          observedAt: '2026-07-14T23:59:00.000Z',
          detail: 'completed native continuation',
        },
        {
          capability: 'handoff',
          adapterFamily: 'target-family',
          sourceAdapterFamily: 'source-family',
          witnessId: 'continuation-handoff',
          observedAt: '2026-07-14T00:00:00.000Z',
          detail: 'completed successor handoff',
        },
      ],
    });

    const source = report.adapters.find((row) => row.family === 'source-family');
    const target = report.adapters.find((row) => row.family === 'target-family');
    expect(source.predicates.catalog.status).toBe('declared');
    expect(source.predicates.discovery).toMatchObject({ status: 'discovered', basis: 'side-effect-free-help' });
    expect(source.predicates.spawn).toMatchObject({
      status: 'witnessed',
      basis: 'durable-transcript',
      freshness: 'fresh',
      witnessId: 'tx-source',
    });
    expect(source.predicates['live-interaction']).toMatchObject({
      status: 'witnessed',
      basis: 'control-receipt',
      freshness: 'fresh',
      witnessId: 'control-source',
    });
    expect(target.predicates.handoff).toMatchObject({
      status: 'witnessed',
      basis: 'continuation-receipt',
      freshness: 'stale',
    });
    expect(report.compatibility.find((cell) => (
      cell.sourceFamily === 'source-family' && cell.targetFamily === 'target-family'
    ))).toMatchObject({
      autoMode: 'handoff',
      witness: expect.objectContaining({ witnessId: 'continuation-handoff', freshness: 'stale' }),
    });
  });

  test('collects only completed daemon-owned transcripts and continuation receipts', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE fleet_transcripts (
        id TEXT PRIMARY KEY,
        backend TEXT NOT NULL,
        effective_backend TEXT,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER
      );
      CREATE TABLE agent_continuations (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        source_adapter TEXT NOT NULL,
        target_adapter TEXT NOT NULL,
        status TEXT NOT NULL,
        completed_at INTEGER
      );
    `);
    db.prepare('INSERT INTO fleet_transcripts VALUES (?, ?, ?, ?, ?, ?)').run(
      'tx-complete', 'source', 'source', 'completed', 1000, 2000,
    );
    db.prepare('INSERT INTO fleet_transcripts VALUES (?, ?, ?, ?, ?, ?)').run(
      'tx-running', 'source', 'source', 'running', 3000, null,
    );
    db.prepare('INSERT INTO fleet_transcripts VALUES (?, ?, ?, ?, ?, ?)').run(
      'tx-corrupt-time', 'target', 'target', 'completed', Number.MAX_VALUE, Number.MAX_VALUE,
    );
    db.prepare('INSERT INTO agent_continuations VALUES (?, ?, ?, ?, ?, ?)').run(
      'continuation-complete', 'handoff', 'source-family', 'target-family', 'completed', 4000,
    );
    db.prepare('INSERT INTO agent_continuations VALUES (?, ?, ?, ?, ?, ?)').run(
      'continuation-failed', 'native', 'source-family', 'source-family', 'failed', 5000,
    );

    const witnesses = collectHarnessConformanceWitnesses(db, [
      catalogEntry('source', adapter('source-family')),
      catalogEntry('target', adapter('target-family')),
    ]);

    expect(witnesses).toEqual([
      expect.objectContaining({ capability: 'spawn', witnessId: 'tx-complete', adapterFamily: 'source-family' }),
      expect.objectContaining({
        capability: 'handoff',
        witnessId: 'continuation-complete',
        sourceAdapterFamily: 'source-family',
        adapterFamily: 'target-family',
      }),
    ]);
    db.close();
  });

  test('renders a compact indexed N by N grid without implying runtime proof', () => {
    const report = buildHarnessContinuationMatrix({
      catalog: [
        catalogEntry('one', adapter('one', { resume: { native: true, scope: 'session' } })),
        catalogEntry('two', adapter('two')),
      ],
      now: new Date('2026-07-15T00:00:00.000Z'),
    });
    const rendered = renderHarnessContinuationMatrix(report);

    expect(rendered).toContain('01 one');
    expect(rendered).toContain('02 two');
    expect(rendered).toContain('N = same-family native session path is mechanically available');
    expect(rendered).toContain('Symbols describe mechanics only');
  });
});
