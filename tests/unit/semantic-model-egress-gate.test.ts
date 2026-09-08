/**
 * Egress gate for the local embedding model (issue #2460 / ADR-0101 local-only mode).
 *
 * The semantic resolver historically set `env.allowRemoteModels = true`
 * unconditionally, so the first semantic operation on an uncached machine
 * phoned huggingface.co even in local-only mode. These tests prove the fix:
 *
 *   (a) DEFAULT mode performs no remote fetch: with no opt-in and no cached
 *       model, the embedder loader throws BEFORE `@huggingface/transformers`
 *       is imported, and `globalThis.fetch` is never called;
 *   (b) the explicit `PORT_DADDY_ALLOW_MODEL_DOWNLOAD=1` opt-in enables the
 *       remote path (and the standard `TRANSFORMERS_OFFLINE` veto beats it);
 *   (c) when the model is unavailable, the EXISTING degraded labeling
 *       surfaces: resolver events persist `decision: 'error'`, and the
 *       durable-agent-roster expertise search returns `degraded: true`
 *       while the lexical/BM25 path keeps returning hits.
 *
 * Deliberately never imports `@huggingface/transformers`: the whole point of
 * the gate is that the default path must not need it.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '../setup-unit.js';
import { closeDatabase, initDatabase } from '../../lib/db.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';
import { createDurableAgentRoster } from '../../lib/durable-agent-roster.js';
import {
  ALLOW_MODEL_DOWNLOAD_ENV,
  DEFAULT_SEMANTIC_MODEL_ID,
  createSemanticResolver,
  isEmbeddingModelCached,
  isRemoteModelDownloadAllowed,
  resolveRemoteModelPolicy,
} from '../../lib/semantic-resolver.js';

const SAVED_ENV_KEYS = [ALLOW_MODEL_DOWNLOAD_ENV, 'TRANSFORMERS_OFFLINE', 'PD_TRANSFORMERS_CACHE_DIR'] as const;

let savedEnv: Record<string, string | undefined>;
let scratchDirs: string[];

beforeEach(() => {
  savedEnv = {};
  for (const key of SAVED_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  scratchDirs = [];
});

afterEach(() => {
  for (const key of SAVED_ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  for (const dir of scratchDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  jest.restoreAllMocks();
});

function emptyCacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pd-egress-gate-'));
  scratchDirs.push(dir);
  return dir;
}

function cachedModelDir(modelId = DEFAULT_SEMANTIC_MODEL_ID): string {
  const dir = emptyCacheDir();
  const modelDir = join(dir, ...modelId.split('/'));
  mkdirSync(modelDir, { recursive: true });
  writeFileSync(join(modelDir, 'config.json'), '{}');
  return dir;
}

// ── the pure policy (the decision the loaders enforce) ───────────────────────

describe('isRemoteModelDownloadAllowed', () => {
  test('defaults to false — no opt-in means no remote fetch', () => {
    expect(isRemoteModelDownloadAllowed({})).toBe(false);
    expect(isRemoteModelDownloadAllowed(process.env)).toBe(false);
  });

  test.each([
    ['1', true],
    ['0', false],
    ['', false],
    ['true', false], // only the repo-conventional literal "1" opts in
    [' 1 ', true], // whitespace-tolerant, same as other PORT_DADDY_ALLOW_* flags
  ])('%j → %s', (value, expected) => {
    expect(isRemoteModelDownloadAllowed({ [ALLOW_MODEL_DOWNLOAD_ENV]: value })).toBe(expected);
  });

  test.each(['1', 'true', 'YES', 'on'])('TRANSFORMERS_OFFLINE=%s vetoes even an explicit opt-in', (offline) => {
    expect(
      isRemoteModelDownloadAllowed({ [ALLOW_MODEL_DOWNLOAD_ENV]: '1', TRANSFORMERS_OFFLINE: offline }),
    ).toBe(false);
  });

  test('TRANSFORMERS_OFFLINE=0 does not veto the opt-in', () => {
    expect(
      isRemoteModelDownloadAllowed({ [ALLOW_MODEL_DOWNLOAD_ENV]: '1', TRANSFORMERS_OFFLINE: '0' }),
    ).toBe(true);
  });
});

describe('isEmbeddingModelCached', () => {
  test('false for a missing or empty model directory', () => {
    const dir = emptyCacheDir();
    expect(isEmbeddingModelCached(dir, DEFAULT_SEMANTIC_MODEL_ID)).toBe(false);
    mkdirSync(join(dir, ...DEFAULT_SEMANTIC_MODEL_ID.split('/')), { recursive: true });
    expect(isEmbeddingModelCached(dir, DEFAULT_SEMANTIC_MODEL_ID)).toBe(false);
  });

  test('true once the model directory has artifacts (prefetch layout)', () => {
    const dir = cachedModelDir();
    expect(isEmbeddingModelCached(dir, DEFAULT_SEMANTIC_MODEL_ID)).toBe(true);
  });
});

describe('resolveRemoteModelPolicy — the behavior matrix', () => {
  test('default + uncached → unavailable (fail fast, zero network)', () => {
    const policy = resolveRemoteModelPolicy(emptyCacheDir(), DEFAULT_SEMANTIC_MODEL_ID, {});
    expect(policy).toEqual({ allowRemote: false, cached: false, mode: 'unavailable' });
  });

  test('default + cached → local-cache-only (cache reads are not egress)', () => {
    const policy = resolveRemoteModelPolicy(cachedModelDir(), DEFAULT_SEMANTIC_MODEL_ID, {});
    expect(policy).toEqual({ allowRemote: false, cached: true, mode: 'local-cache-only' });
  });

  test('opt-in + uncached → remote-allowed (explicit consent enables the download)', () => {
    const policy = resolveRemoteModelPolicy(emptyCacheDir(), DEFAULT_SEMANTIC_MODEL_ID, {
      [ALLOW_MODEL_DOWNLOAD_ENV]: '1',
    });
    expect(policy).toEqual({ allowRemote: true, cached: false, mode: 'remote-allowed' });
  });

  test('opt-in + cached → remote-allowed (opt-in may refresh missing artifacts)', () => {
    const policy = resolveRemoteModelPolicy(cachedModelDir(), DEFAULT_SEMANTIC_MODEL_ID, {
      [ALLOW_MODEL_DOWNLOAD_ENV]: '1',
    });
    expect(policy.mode).toBe('remote-allowed');
    expect(policy.allowRemote).toBe(true);
  });

  test('opt-in + TRANSFORMERS_OFFLINE=0 + uncached → remote-allowed (0 is not a veto)', () => {
    const policy = resolveRemoteModelPolicy(emptyCacheDir(), DEFAULT_SEMANTIC_MODEL_ID, {
      [ALLOW_MODEL_DOWNLOAD_ENV]: '1',
      TRANSFORMERS_OFFLINE: '0',
    });
    expect(policy).toEqual({ allowRemote: true, cached: false, mode: 'remote-allowed' });
  });

  test('opt-in + TRANSFORMERS_OFFLINE + uncached → unavailable (offline always wins)', () => {
    const policy = resolveRemoteModelPolicy(emptyCacheDir(), DEFAULT_SEMANTIC_MODEL_ID, {
      [ALLOW_MODEL_DOWNLOAD_ENV]: '1',
      TRANSFORMERS_OFFLINE: '1',
    });
    expect(policy).toEqual({ allowRemote: false, cached: false, mode: 'unavailable' });
  });
});

// ── the resolver enforces the policy with zero network ───────────────────────

describe('semantic resolver — default mode never phones huggingface.co', () => {
  test('embed() rejects with an actionable gate error and fetch is never called', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const db = createTestDb();
    const cacheDir = emptyCacheDir();
    const resolver = createSemanticResolver(db, { cacheDir });

    await expect(resolver.embed('typography hierarchy')).rejects.toThrow(
      /remote model\s+download is disabled by default/,
    );
    await expect(resolver.embed('typography hierarchy')).rejects.toThrow(
      new RegExp(ALLOW_MODEL_DOWNLOAD_ENV),
    );
    const error = await resolver.embed('typography hierarchy').catch(failure => failure);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ retryable: false, details: { reason: 'model_download_disabled' } });
    expect(error.message).not.toContain(cacheDir);
    expect(error.message).not.toContain(DEFAULT_SEMANTIC_MODEL_ID);
    expect(fetchSpy).not.toHaveBeenCalled();
    db.close();
  });

  test('observeAliases degrades to a persisted error decision instead of fetching', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const db = createTestDb();
    const cacheDir = emptyCacheDir();
    const resolver = createSemanticResolver(db, { cacheDir });

    resolver.observeAliases({
      projectDir: '/x',
      harbor: 'h',
      sourceType: 'memory',
      sourceId: 's-1',
      agentId: 'a',
      aliases: [{ raw: 'raw term', canonical: 'canon term', tokens: ['canon', 'term'], fingerprint: 'fp-1' }],
    });
    await resolver.flush();

    const events = resolver.listResolutions();
    expect(events).toHaveLength(1);
    expect(events[0].decision).toBe('error');
    expect(String(events[0].metadata?.error)).toMatch(/disabled by default/);
    expect(JSON.stringify(events[0].metadata)).not.toContain(cacheDir);
    expect(JSON.stringify(events[0].metadata)).not.toContain(DEFAULT_SEMANTIC_MODEL_ID);
    expect(fetchSpy).not.toHaveBeenCalled();
    db.close();
  });
});

// ── the roster labels the lexical fallback degraded ──────────────────────────

describe('expertise retrieval degrades (and says so) when the model is gated off', () => {
  let rosterDb: DatabaseInstance;

  beforeEach(() => {
    rosterDb = initDatabase({ inMemory: true });
  });

  afterEach(() => closeDatabase(rosterDb));

  test('search returns degraded: true with lexical hits and no network attempt', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const resolverDb = createTestDb();
    const resolver = createSemanticResolver(resolverDb, { cacheDir: emptyCacheDir() });
    const service = createDurableAgentRoster(rosterDb, {
      resolver,
      gitleaksRunner: () => ({ findings: [] }),
      now: () => new Date('2026-08-22T12:00:00.000Z'),
    });

    const created = await service.create({
      slug: 'portdaddy-typography-expert',
      scope: { kind: 'system' as const },
      remit: 'Own typography systems and dense operator interface hierarchy.',
      instructions: 'Inspect existing visual language before changing interface typography.',
      skills: ['swiss-modern-website-design'],
      tools: ['read'],
      backendPreferences: [{ backend: 'cli:codex', model: 'gpt-5' }],
      permissionPolicy: { filesystem: 'repo' as const, network: 'restricted' as const },
      triggers: [{ kind: 'manual' as const, label: 'Operator summons the specialist' }],
    });
    // Profile indexing could not embed — surfaced as a warning, not a failure.
    expect(created.warnings.join(' ')).toMatch(/indexing is pending/);

    const result = await service.search('typography');
    expect(result.degraded).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/labeled degraded/);
    // The lexical/BM25 path still works: the expert is found without embeddings.
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].agent.profile.slug).toBe('portdaddy-typography-expert');
    expect(result.hits[0].evidence.sources).toEqual(['bm25']);
    expect(fetchSpy).not.toHaveBeenCalled();
    resolverDb.close();
  });
});
