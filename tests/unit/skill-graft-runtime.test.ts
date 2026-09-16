import { describe, expect, test } from '@jest/globals';
import { resolveSkillGraftRuntime } from '../../lib/skill-graft-runtime.js';

describe('skill-graft runtime policy', () => {
  test('does not inherit the fleet default backend', () => {
    expect(resolveSkillGraftRuntime({ PD_FLEET_DEFAULT_BACKEND: 'ollama' })).toBeNull();
  });

  test('automatic warm-up rejects cloud backends even when explicitly configured', () => {
    const runtime = resolveSkillGraftRuntime({
      PD_SKILL_GRAFT_BACKEND: 'cloudflare',
      CLOUDFLARE_ACCOUNT_ID: 'test-account',
      CLOUDFLARE_API_TOKEN: 'test-token',
    }, { allowRemote: false });

    expect(runtime).toBeNull();
  });

  test.each([
    'https://ollama.example.com',
    '10.0.0.8:11434',
    'not a url',
  ])('automatic warm-up rejects non-loopback Ollama host %s', (host) => {
    expect(resolveSkillGraftRuntime({
      PD_SKILL_GRAFT_BACKEND: 'ollama',
      OLLAMA_HOST: host,
    }, { allowRemote: false })).toBeNull();
  });

  test.each([
    undefined,
    'http://localhost:11434',
    '127.0.0.1:11434',
    'http://[::1]:11434',
  ])('automatic warm-up permits loopback Ollama host %s', (host) => {
    const env: NodeJS.ProcessEnv = { PD_SKILL_GRAFT_BACKEND: 'ollama' };
    if (host) env.OLLAMA_HOST = host;

    expect(resolveSkillGraftRuntime(env, { allowRemote: false })).toMatchObject({
      backend: 'ollama',
    });
  });

  test('manual warm-up may use an explicitly configured cloud backend', () => {
    expect(resolveSkillGraftRuntime({
      PD_SKILL_GRAFT_BACKEND: 'cloudflare',
      CLOUDFLARE_ACCOUNT_ID: 'test-account',
      CLOUDFLARE_API_TOKEN: 'test-token',
    })).toMatchObject({ backend: 'cloudflare' });
  });
});
