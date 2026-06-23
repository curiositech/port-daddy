// tests/unit/transformers-cache-dir.test.js
//
// The ONE stable embedding-model cache dir (ADR-0061), shared by the resolver, the
// daemon, the shipwright skill index, and the install-time prefetch — so prefetch
// writes where the runtime reads, regardless of cwd / launchd / worktree.

import { describe, test, expect } from '@jest/globals';

const { defaultTransformersCacheDir } = await import('../../lib/semantic-resolver.js');

describe('defaultTransformersCacheDir', () => {
  const prev = process.env.PD_TRANSFORMERS_CACHE_DIR;
  afterEach(() => {
    if (prev === undefined) delete process.env.PD_TRANSFORMERS_CACHE_DIR;
    else process.env.PD_TRANSFORMERS_CACHE_DIR = prev;
  });

  test('defaults to a stable ~/.port-daddy/transformers-cache (not cwd/repo-relative)', () => {
    delete process.env.PD_TRANSFORMERS_CACHE_DIR;
    const dir = defaultTransformersCacheDir();
    expect(dir).toMatch(/\.port-daddy[/\\]transformers-cache$/);
    // Must NOT be cwd-relative — that's the bug this fixes (daemon cwd != repo).
    expect(dir).not.toMatch(/\.cache[/\\]transformers$/);
  });

  test('honors PD_TRANSFORMERS_CACHE_DIR override', () => {
    process.env.PD_TRANSFORMERS_CACHE_DIR = '/custom/models';
    expect(defaultTransformersCacheDir()).toBe('/custom/models');
  });
});
