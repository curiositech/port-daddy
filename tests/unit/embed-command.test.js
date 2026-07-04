// tests/unit/embed-command.test.js
//
// `pd embed` is the ONE local embedding surface for skills and matching code
// (ADR-0061 shared cache; hybrid-search policy: BM25-only search is banned in
// skills/NLP — lexical + this embedder, fused). These tests cover the cache
// detection that setup/doctor/embed all key off, WITHOUT downloading a model.

import { describe, test, expect, afterEach } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { isEmbeddingModelCached } = await import('../../cli/commands/embed.js');
const { DEFAULT_SEMANTIC_MODEL_ID } = await import('../../lib/semantic-resolver.js');

describe('isEmbeddingModelCached', () => {
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function tempCache() {
    const dir = mkdtempSync(join(tmpdir(), 'pd-embed-test-'));
    dirs.push(dir);
    return dir;
  }

  test('false for an empty cache dir', () => {
    expect(isEmbeddingModelCached(tempCache())).toBe(false);
  });

  test('false for a nonexistent cache dir', () => {
    expect(isEmbeddingModelCached('/nonexistent/pd-embed-cache')).toBe(false);
  });

  test('false when the model dir exists but is empty', () => {
    const cache = tempCache();
    mkdirSync(join(cache, ...DEFAULT_SEMANTIC_MODEL_ID.split('/')), { recursive: true });
    expect(isEmbeddingModelCached(cache)).toBe(false);
  });

  test('true when the model dir has artifacts', () => {
    const cache = tempCache();
    const modelDir = join(cache, ...DEFAULT_SEMANTIC_MODEL_ID.split('/'));
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(modelDir, 'config.json'), '{}');
    expect(isEmbeddingModelCached(cache)).toBe(true);
  });

  test('a different model id does not count as cached', () => {
    const cache = tempCache();
    const modelDir = join(cache, 'SomeOrg', 'other-model');
    mkdirSync(modelDir, { recursive: true });
    writeFileSync(join(modelDir, 'config.json'), '{}');
    expect(isEmbeddingModelCached(cache)).toBe(false);
  });
});
