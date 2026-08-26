import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from '@jest/globals';
import Database from 'better-sqlite3';
import { createTool2VecReconciler } from '../../lib/skill-graft-reconciler.js';
import { createTool2VecStore } from '../../lib/skill-graft-tool2vec.js';
import type { SkillGraftRuntime } from '../../lib/skill-graft-runtime.js';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/tool2vec-reconciler');

function vector(text: string): number[] {
  const values = new Array(8).fill(0);
  for (let i = 0; i < text.length; i++) values[text.charCodeAt(i) % values.length] += 1;
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}

const embedder = {
  modelId: 'mock-embedder',
  async embed(texts: string[]) {
    return texts.map(vector);
  },
};

function runtime(
  complete: (prompt: string) => Promise<{ ok: boolean; text?: string; error?: string }>,
): SkillGraftRuntime {
  return {
    backend: 'ollama',
    model: 'mock-generator',
    client: {
      async complete(request) {
        const result = await complete(request.prompt);
        return { ...result, cached: false, fellBack: !result.ok };
      },
      stats: () => ({
        cacheHits: 0,
        semanticHits: 0,
        cacheMisses: 0,
        llmCalls: 0,
        llmFailures: 0,
        rateLimited: 0,
        timedOut: 0,
      }),
      clearCache() {},
    },
  };
}

function successfulRuntime(onCall?: () => void): SkillGraftRuntime {
  return runtime(async () => {
    onCall?.();
    return {
      ok: true,
      text: JSON.stringify({ queries: Array.from({ length: 15 }, (_, index) => `fixture task ${index}`) }),
    };
  });
}

function harness(overrides: {
  db?: Database.Database;
  runtime?: SkillGraftRuntime;
  ownerId?: string;
  isEmbedderAvailable?: () => boolean;
  now?: () => number;
} = {}) {
  const db = overrides.db ?? new Database(':memory:');
  const selectedRuntime = overrides.runtime ?? successfulRuntime();
  const store = createTool2VecStore({
    db,
    embedderModelId: embedder.modelId,
    generatorId: selectedRuntime.model,
  });
  return {
    db,
    reconciler: createTool2VecReconciler({
      projectRoot: fixtureRoot,
      roots: [{ label: 'fixture', path: fixtureRoot }],
      runtime: selectedRuntime,
      embedder,
      store,
      ownerId: overrides.ownerId,
      isEmbedderAvailable: overrides.isEmbedderAvailable ?? (() => true),
      now: overrides.now,
    }),
  };
}

describe('Tool2Vec reconciler', () => {
  test('resumes row-by-row after an interrupted first build without duplicate vectors', async () => {
    const abort = new AbortController();
    let calls = 0;
    const firstRuntime = successfulRuntime(() => {
      calls++;
      if (calls === 1) abort.abort();
    });
    const first = harness({ runtime: firstRuntime, ownerId: 'first' });

    const interrupted = await first.reconciler.reconcile({
      trigger: 'first-build',
      maxSkills: Number.POSITIVE_INFINITY,
      signal: abort.signal,
    });
    expect(interrupted.embedded).toBe(1);
    expect(interrupted.current).toBe(1);
    expect(interrupted.stoppedEarly).toBe(true);

    const resumed = harness({ db: first.db, runtime: successfulRuntime(() => { calls++; }), ownerId: 'restart' });
    const complete = await resumed.reconciler.reconcile({
      trigger: 'restart',
      maxSkills: Number.POSITIVE_INFINITY,
    });
    expect(complete.state).toBe('current');
    expect(complete.current).toBe(3);
    expect(complete.embedded).toBe(2);
    expect(calls).toBe(3);
    const rows = first.db.prepare('SELECT COUNT(*) AS count FROM skill_graft_tool2vec_centroids').get() as { count: number };
    expect(rows.count).toBe(3);
  });

  test('an active lease coalesces competing daemon/setup/manual callers', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const db = new Database(':memory:');
    const first = harness({
      db,
      ownerId: 'daemon',
      runtime: runtime(async () => {
        await blocked;
        return { ok: true, text: JSON.stringify({ queries: ['one task'] }) };
      }),
    });
    const second = harness({ db, ownerId: 'setup', runtime: successfulRuntime() });

    const running = first.reconciler.reconcile({ trigger: 'daemon-startup', maxSkills: 1 });
    await Promise.resolve();
    const sameOwnerRefused = await first.reconciler.reconcile({ trigger: 'daemon-tick', maxSkills: 1 });
    expect(sameOwnerRefused.acquired).toBe(false);
    expect(sameOwnerRefused.state).toBe('reconciling');
    const refused = await second.reconciler.reconcile({ trigger: 'setup', maxSkills: 1 });
    expect(refused.acquired).toBe(false);
    expect(refused.state).toBe('reconciling');
    release();
    await running;
  });

  test('lease renewal preserves the run start timestamp', async () => {
    let clock = 1_000;
    const selected = harness({
      now: () => clock,
      runtime: successfulRuntime(() => { clock += 1_000; }),
    });

    const completed = await selected.reconciler.reconcile({
      trigger: 'timestamp-contract',
      maxSkills: Number.POSITIVE_INFINITY,
    });

    expect(completed.lastStartedAt).toBe(1_000);
    expect(completed.lastCompletedAt).toBe(4_000);
  });

  test('status distinguishes cold, embedder-down, generator-down, and current', async () => {
    const cold = createTool2VecReconciler({
      projectRoot: fixtureRoot,
      roots: [{ label: 'fixture', path: fixtureRoot }],
      runtime: null,
      embedder,
      db: new Database(':memory:'),
      isEmbedderAvailable: () => true,
    });
    expect(cold.status().state).toBe('cold');

    const down = harness({ isEmbedderAvailable: () => false });
    expect(down.reconciler.status().state).toBe('embedder-down');

    const broken = harness({ runtime: runtime(async () => ({ ok: false, error: 'generator offline' })) });
    const failed = await broken.reconciler.reconcile({ trigger: 'test', maxSkills: 1 });
    expect(failed.state).toBe('generator-down');

    const badEmbedder = {
      modelId: 'broken-embedder',
      async embed(): Promise<number[][]> {
        throw new Error('native runtime failed');
      },
    };
    const embedderFailure = createTool2VecReconciler({
      projectRoot: fixtureRoot,
      roots: [{ label: 'fixture', path: fixtureRoot }],
      runtime: successfulRuntime(),
      embedder: badEmbedder,
      db: new Database(':memory:'),
      isEmbedderAvailable: () => true,
    });
    expect((await embedderFailure.reconcile({ trigger: 'test', maxSkills: 1 })).state).toBe('embedder-down');

    const warm = harness();
    const completed = await warm.reconciler.reconcile({ trigger: 'test', maxSkills: Number.POSITIVE_INFINITY });
    expect(completed.state).toBe('current');
    expect(completed.coveragePct).toBe(100);
  });
});
