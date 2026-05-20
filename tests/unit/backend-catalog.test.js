import { describe, test, expect } from '@jest/globals';
import {
  BACKEND_CATALOG,
  KNOWN_BACKEND_IDS,
  detectForcedCliBackend,
  getBackendCatalogEntry,
  recommendedBackendIds,
} from '../../lib/backend-catalog.js';

describe('backend-catalog', () => {
  test('includes the cli-tube backends introduced in PR #109', () => {
    expect(KNOWN_BACKEND_IDS.has('cli:claude-code')).toBe(true);
    expect(KNOWN_BACKEND_IDS.has('cli:codex')).toBe(true);
  });

  test('cli-tube entries advertise the free-via-subscription framing', () => {
    const claudeCode = getBackendCatalogEntry('cli:claude-code');
    expect(claudeCode).toBeDefined();
    expect(claudeCode.costModel).toBe('subscription');
    expect(claudeCode.framing).toMatch(/Claude Max/i);
    expect(claudeCode.pdUseCliBackendValue).toBe('claude-code');
    expect(claudeCode.recommended).toBe(true);

    const codex = getBackendCatalogEntry('cli:codex');
    expect(codex).toBeDefined();
    expect(codex.costModel).toBe('subscription');
    expect(codex.framing).toMatch(/ChatGPT Pro/i);
    expect(codex.pdUseCliBackendValue).toBe('codex');
    expect(codex.recommended).toBe(true);
  });

  test('all entries expose a non-empty framing string', () => {
    for (const entry of BACKEND_CATALOG) {
      expect(typeof entry.framing).toBe('string');
      expect(entry.framing.length).toBeGreaterThan(0);
    }
  });

  test('all entries have a costModel from the allowed set', () => {
    const allowed = new Set(['subscription', 'metered', 'local', 'cli']);
    for (const entry of BACKEND_CATALOG) {
      expect(allowed.has(entry.costModel)).toBe(true);
    }
  });

  test('detectForcedCliBackend maps env values to catalog ids', () => {
    expect(detectForcedCliBackend({ PD_USE_CLI_BACKEND: 'claude-code' })).toBe(
      'cli:claude-code',
    );
    expect(detectForcedCliBackend({ PD_USE_CLI_BACKEND: 'claude' })).toBe(
      'cli:claude-code',
    );
    expect(detectForcedCliBackend({ PD_USE_CLI_BACKEND: 'CODEX' })).toBe('cli:codex');
    expect(detectForcedCliBackend({})).toBeNull();
    expect(detectForcedCliBackend({ PD_USE_CLI_BACKEND: '' })).toBeNull();
    expect(detectForcedCliBackend({ PD_USE_CLI_BACKEND: 'bogus' })).toBeNull();
  });

  test('recommendedBackendIds surfaces subscription + local options', () => {
    const recs = recommendedBackendIds();
    expect(recs).toContain('cli:claude-code');
    expect(recs).toContain('cli:codex');
    expect(recs).toContain('ollama');
    expect(recs).not.toContain('claude'); // metered SDK shouldn't be in recommended set
    expect(recs).not.toContain('openai');
  });

  test('getBackendCatalogEntry returns undefined for unknown id', () => {
    expect(getBackendCatalogEntry('definitely-not-a-backend')).toBeUndefined();
  });

  test('OpenAI metered backend has openai id and metered framing', () => {
    const openai = getBackendCatalogEntry('openai');
    expect(openai).toBeDefined();
    expect(openai.costModel).toBe('metered');
    expect(openai.models).toContain('gpt-5-mini');
  });
});
