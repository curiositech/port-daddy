import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { getInstallationTokenCached } from '../src/github.js';
import { freshState, installGitHubFetch, memoryKV, type GitHubState } from './harness.js';

// A real RSA PKCS8 PEM so signJwt's Web Crypto import succeeds. The mint itself
// is faked by the GitHub fetch stub; this only exercises the JWT + cache path.
const PEM = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  type: 'pkcs8',
  format: 'pem',
}) as string;

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getInstallationTokenCached', () => {
  it('mints once, then serves a cache hit without a second mint', async () => {
    const kv = memoryKV();

    const t1 = await getInstallationTokenCached('app-1', PEM, 42, kv);
    expect(t1).toBe('tok-1');
    expect(state.tokenMints).toBe(1);

    // Second call for the same installation must hit KV, not GitHub.
    const t2 = await getInstallationTokenCached('app-1', PEM, 42, kv);
    expect(t2).toBe('tok-1');
    expect(state.tokenMints).toBe(1); // still 1 — no second mint
  });

  it('forceRefresh bypasses the cache and re-mints', async () => {
    const kv = memoryKV();
    await getInstallationTokenCached('app-1', PEM, 42, kv);
    expect(state.tokenMints).toBe(1);

    const t = await getInstallationTokenCached('app-1', PEM, 42, kv, true);
    expect(t).toBe('tok-2');
    expect(state.tokenMints).toBe(2);
  });
});
