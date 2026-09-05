/**
 * Coast Guard (ADR-0050) — pure-policy unit coverage.
 *
 * Confine + broker + cap, on by default. These tests lock the policy and the
 * honesty contract: the receipt must always carry the limits disclosure, the
 * broker must scrub the same allow-list secret-env owns, and the bypass env
 * must NEVER be named in any agent-facing string.
 */

import { describe, test, expect } from '@jest/globals';
import {
  buildSeatbeltProfile,
  defaultCrownJewels,
  scrubRawSecretsFromEnv,
  resolveCoastGuardPolicy,
  HONEST_LIMITS,
  DEFAULT_MAX_REQUESTS,
  COAST_GUARD_BYPASS_ENV,
} from '../../lib/coast-guard.js';
import { managedSecretKeys } from '../../lib/secret-env.js';

describe('defaultCrownJewels', () => {
  test('denies the canonical secret dirs under HOME', () => {
    const j = defaultCrownJewels('/home/op');
    expect(j.deniedDirs).toEqual(
      expect.arrayContaining([
        '/home/op/.ssh',
        '/home/op/.aws',
        '/home/op/.gnupg',
        '/home/op/.config/gcloud',
      ]),
    );
  });
});

describe('buildSeatbeltProfile', () => {
  const profile = buildSeatbeltProfile(defaultCrownJewels('/home/op'));

  test('allows by default, then carves denials', () => {
    expect(profile).toContain('(version 1)');
    expect(profile).toContain('(allow default)');
  });

  test('denies each crown-jewel dir by subpath', () => {
    expect(profile).toContain('(deny file-read* (subpath "/home/op/.ssh"))');
    expect(profile).toContain('(deny file-read* (subpath "/home/op/.aws"))');
    expect(profile).toContain('(deny file-read* (subpath "/home/op/.gnupg"))');
  });

  test('denies dotenv files anywhere under HOME via regex', () => {
    expect(profile).toMatch(/deny file-read\* \(regex #"\^\/home\/op.*\\.env/);
  });

  test('does not broadly re-allow dotenv examples under HOME', () => {
    expect(profile).not.toContain('(allow file-read*');
  });
});

describe('scrubRawSecretsFromEnv (the broker)', () => {
  test('removes every managed secret key from the child env', () => {
    const keys = managedSecretKeys();
    const env = { PATH: '/bin', HOME: '/home/op' };
    for (const k of keys) env[k] = `raw-${k}-value`;

    const { env: scrubbed, scrubbed: removed } = scrubRawSecretsFromEnv(env);

    for (const k of keys) {
      expect(scrubbed[k]).toBeUndefined();
    }
    expect(scrubbed.PATH).toBe('/bin'); // non-secret env preserved
    expect(removed.sort()).toEqual([...keys].sort());
  });

  test('reports only keys that were actually present', () => {
    const env = { ANTHROPIC_API_KEY: 'sk-abc', PATH: '/bin' };
    const { scrubbed } = scrubRawSecretsFromEnv(env);
    expect(scrubbed).toEqual(['ANTHROPIC_API_KEY']);
  });

  test('an env dump after scrub yields no raw key value', () => {
    const env = { OPENAI_API_KEY: 'sk-leak', GEMINI_API_KEY: 'g-leak' };
    const { env: scrubbed } = scrubRawSecretsFromEnv(env);
    const dump = Object.entries(scrubbed).map(([k, v]) => `${k}=${v}`).join('\n');
    expect(dump).not.toMatch(/sk-leak/);
    expect(dump).not.toMatch(/g-leak/);
  });

  test('ALSO scrubs NON-managed keys sourced from the dotenv (the operator secret store)', () => {
    // A non-managed secret loaded from .env.local must NOT survive in the agent
    // env just because it is not on the managed allow-list.
    const env = {
      PATH: '/bin',
      STRIPE_SECRET_KEY: 'sk_live_LEAK',
      DATABASE_URL: 'postgres://u:p@host/db',
      ANTHROPIC_API_KEY: 'sk-ant-LEAK',
    };
    const dotenvKeys = ['STRIPE_SECRET_KEY', 'DATABASE_URL'];
    const { env: scrubbed, scrubbed: removed } = scrubRawSecretsFromEnv(env, dotenvKeys);

    expect(scrubbed.STRIPE_SECRET_KEY).toBeUndefined();
    expect(scrubbed.DATABASE_URL).toBeUndefined();
    expect(scrubbed.ANTHROPIC_API_KEY).toBeUndefined(); // managed, also gone
    expect(scrubbed.PATH).toBe('/bin'); // non-secret preserved
    expect(removed).toEqual(expect.arrayContaining(['STRIPE_SECRET_KEY', 'DATABASE_URL', 'ANTHROPIC_API_KEY']));

    const dump = Object.entries(scrubbed).map(([k, v]) => `${k}=${v}`).join('\n');
    expect(dump).not.toMatch(/LEAK/);
    expect(dump).not.toMatch(/postgres:\/\//);
  });
});

describe('resolveCoastGuardPolicy', () => {
  test('ON by default', () => {
    const p = resolveCoastGuardPolicy({}, {});
    expect(p.enabled).toBe(true);
    expect(p.maxRequests).toBe(DEFAULT_MAX_REQUESTS);
  });

  test('per-spec opt-out disables it', () => {
    expect(resolveCoastGuardPolicy({ coastGuard: false }, {}).enabled).toBe(false);
  });

  test('operator escape-hatch env disables it', () => {
    const env = { [COAST_GUARD_BYPASS_ENV]: '1' };
    expect(resolveCoastGuardPolicy({}, env).enabled).toBe(false);
  });

  test('cap overrides are honored', () => {
    const p = resolveCoastGuardPolicy({ maxRequests: 3, maxBytes: 1024 }, {});
    expect(p.maxRequests).toBe(3);
    expect(p.maxBytes).toBe(1024);
  });
});

describe('honesty contract', () => {
  test('HONEST_LIMITS discloses the same-UID gap and the metering limit', () => {
    expect(HONEST_LIMITS).toMatch(/malicious same-UID/i);
    expect(HONEST_LIMITS).toMatch(/phase 4/i);
    expect(HONEST_LIMITS).toMatch(/MITM|dollar/i);
  });

  test('the bypass env var name is NEVER in the disclosure (no advertising the override)', () => {
    expect(HONEST_LIMITS).not.toContain(COAST_GUARD_BYPASS_ENV);
  });
});
