import { describe, test, expect } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BACKEND_CATALOG,
  KNOWN_BACKEND_IDS,
  detectForcedCliBackend,
  detectForcedCliBackendValue,
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

  test('detectForcedCliBackend honors persisted selection when using process env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-backend-catalog-'));
    const path = join(dir, 'selection');
    try {
      writeFileSync(path, 'codex\n');
      expect(detectForcedCliBackend(process.env, { persistedPath: path })).toBe('cli:codex');
      expect(detectForcedCliBackendValue(process.env, { persistedPath: path })).toBe('codex');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('env selection wins over persisted selection', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-backend-catalog-'));
    const path = join(dir, 'selection');
    try {
      writeFileSync(path, 'codex\n');
      const env = { PD_USE_CLI_BACKEND: 'claude-code' };
      expect(detectForcedCliBackend(env, { persistedPath: path })).toBe('cli:claude-code');
      expect(detectForcedCliBackendValue(env, { persistedPath: path })).toBe('claude-code');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  test('includes the cli:gemini / cli:groq / cli:grok tube backends', () => {
    for (const id of ['cli:gemini', 'cli:groq', 'cli:grok']) {
      expect(KNOWN_BACKEND_IDS.has(id)).toBe(true);
      const entry = getBackendCatalogEntry(id);
      expect(entry).toBeDefined();
      expect(entry.costModel).toBe('subscription');
      expect(entry.models.length).toBeGreaterThan(0);
    }
    expect(getBackendCatalogEntry('cli:gemini').pdUseCliBackendValue).toBe('gemini');
    expect(getBackendCatalogEntry('cli:groq').pdUseCliBackendValue).toBe('groq');
    expect(getBackendCatalogEntry('cli:grok').pdUseCliBackendValue).toBe('grok');
  });

  test('detectForcedCliBackend maps gemini/groq/grok to cli:* ids', () => {
    expect(detectForcedCliBackend({ PD_USE_CLI_BACKEND: 'gemini' })).toBe('cli:gemini');
    expect(detectForcedCliBackend({ PD_USE_CLI_BACKEND: 'GROQ' })).toBe('cli:groq');
    expect(detectForcedCliBackend({ PD_USE_CLI_BACKEND: 'grok' })).toBe('cli:grok');
  });

  test('claude SDK ladder uses current undated model ids', () => {
    const claude = getBackendCatalogEntry('claude');
    expect(claude.models).toEqual([
      'claude-haiku-4-5',
      'claude-sonnet-4-6',
      'claude-opus-4-8',
    ]);
  });

  test('cli:claude-code model list uses current undated model ids', () => {
    const claudeCode = getBackendCatalogEntry('cli:claude-code');
    expect(claudeCode.models).toEqual([
      'claude-sonnet-4-6',
      'claude-opus-4-8',
      'claude-haiku-4-5',
    ]);
  });

  test('OpenAI metered backend has openai id and metered framing', () => {
    const openai = getBackendCatalogEntry('openai');
    expect(openai).toBeDefined();
    expect(openai.costModel).toBe('metered');
    expect(openai.models).toContain('gpt-5-mini');
  });
});
