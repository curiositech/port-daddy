// Purser contract obligation 9 (PR #8889): a partial cache eviction must never
// re-enable network access without the explicit opt-in. Repaired in place per
// the purser stack protocol: the original authoring omitted every import and
// helper, and asserted the GATE error message on a cached-but-corrupt model —
// but the gate fires only when the model is NOT cached. For a cached partial
// eviction the enforced invariant is stronger and different: the policy pins
// `allowRemoteModels=false`, so the load fails on the corrupt local artifacts
// (any error) with ZERO network attempts — it must never quietly re-download.
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '../../setup-unit.js';
import {
  ALLOW_MODEL_DOWNLOAD_ENV,
  DEFAULT_SEMANTIC_MODEL_ID,
  createSemanticResolver,
  isEmbeddingModelCached,
  resolveRemoteModelPolicy,
} from '../../../lib/semantic-resolver.js';

function emptyCacheDir(): string {
  return mkdtempSync(join(tmpdir(), 'pd-purser-eviction-'));
}

function partiallyEvictedCache(): string {
  const cacheDir = emptyCacheDir();
  const modelDir = join(cacheDir, ...DEFAULT_SEMANTIC_MODEL_ID.split('/'));
  mkdirSync(modelDir, { recursive: true });
  const files = ['config.json', 'tokenizer.json', 'model.safetensors'];
  for (const f of files) writeFileSync(join(modelDir, f), '{}');
  unlinkSync(join(modelDir, files[0]));
  return cacheDir;
}

describe('cache eviction resilience', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('partial eviction does not reenable network without opt-in', async () => {
    const cacheDir = partiallyEvictedCache();
    // Dir still exists with 2 files → counts as cached, policy stays local-only.
    expect(isEmbeddingModelCached(cacheDir, DEFAULT_SEMANTIC_MODEL_ID)).toBe(true);
    const policy = resolveRemoteModelPolicy(cacheDir, DEFAULT_SEMANTIC_MODEL_ID, {});
    expect(policy).toEqual({ allowRemote: false, cached: true, mode: 'local-cache-only' });

    // The corrupt local artifacts make the load fail — and it must fail
    // WITHOUT a single network attempt (allowRemoteModels is pinned false),
    // never by silently re-downloading the evicted file.
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const db = createTestDb();
    const resolver = createSemanticResolver(db, { cacheDir });
    await expect(resolver.embed('test')).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    db.close();
  });

  test('opt-in enables remote even with partial eviction', () => {
    const cacheDir = partiallyEvictedCache();
    const policy = resolveRemoteModelPolicy(cacheDir, DEFAULT_SEMANTIC_MODEL_ID, {
      [ALLOW_MODEL_DOWNLOAD_ENV]: '1',
    });
    expect(policy).toEqual({ allowRemote: true, cached: true, mode: 'remote-allowed' });
  });
});
