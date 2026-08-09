import { describe, test, expect } from '@jest/globals';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BACKEND_CATALOG,
  CLI_BACKEND_SELECTION_PATH,
  KNOWN_BACKEND_IDS,
  detectForcedCliBackend,
  detectForcedCliBackendValue,
  getBackendCatalogEntry,
  harnessAdapterCapabilityRows,
  recommendedBackendIds,
  renderHarnessAdapterMarkdown,
  resolveEffectiveSpawnBackend,
} from '../../lib/backend-catalog.js';
import { renderHarnessContinuationMatrix } from '../../lib/harness-conformance.js';

describe('backend-catalog', () => {
  test('includes the cli-tube backends introduced in PR #109', () => {
    expect(KNOWN_BACKEND_IDS.has('cli:claude-code')).toBe(true);
    expect(KNOWN_BACKEND_IDS.has('cli:codex')).toBe(true);
    expect(KNOWN_BACKEND_IDS.has('cli:agy')).toBe(true);
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

    const agy = getBackendCatalogEntry('cli:agy');
    expect(agy).toBeDefined();
    expect(agy.costModel).toBe('subscription');
    expect(agy.framing).toMatch(/agy/i);
    expect(agy.pdUseCliBackendValue).toBe('agy');
    // Do not advertise a synthetic default model. The agy CLI should receive
    // no --model flag unless the operator explicitly picks a real agy model id.
    expect(agy.models).toEqual([]);
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

  test('every backend declares a shell-free N:N adapter contract', () => {
    for (const entry of BACKEND_CATALOG) {
      expect(entry.adapter.family).toMatch(/^[a-z0-9-]+$/);
      expect(entry.adapter.acceptsInitialPrompt).toBe(true);
      expect(entry.adapter.authModes.length).toBeGreaterThan(0);
      expect(entry.adapter.limitations.length).toBeGreaterThan(0);
      for (const command of [entry.adapter.spawn.command, entry.adapter.resume.command]) {
        if (!command) continue;
        expect(command.executable).not.toMatch(/\s|[;&|]/);
        expect(command.args).not.toContain('-c');
        expect(command.args.join(' ')).not.toMatch(/\s(?:&&|\|\||;)\s/);
      }
    }
  });

  test('capability rows collapse provider routes onto one adapter family', () => {
    const rows = harnessAdapterCapabilityRows();
    expect(rows.length).toBeLessThan(BACKEND_CATALOG.length);
    expect(rows.find((row) => row.family === 'claude-code')).toMatchObject({
      backendIds: ['cli:claude-code', 'claude-cli'],
      resume: 'session',
      transcript: 'harness:claude-jsonl',
    });
    expect(rows.find((row) => row.family === 'codex-cli')).toMatchObject({
      backendIds: ['cli:codex', 'codex'],
      resume: 'session',
      transcript: 'harness:codex-rollout-jsonl',
    });
    expect(rows.find((row) => row.family === 'cloudflare-workers-ai')).toMatchObject({
      resume: 'handoff-only',
      transcript: 'port-daddy:port-daddy-jsonl',
    });
    expect(rows.find((row) => row.family === 'aider')).toMatchObject({ resume: 'history' });
  });

  test('ADR-0118 generated adapter table matches the executable catalog', () => {
    const adr = readFileSync(new URL('../../docs/adr/0118-harness-adapter-contract.md', import.meta.url), 'utf8');
    const beginMarker = '<!-- BEGIN GENERATED HARNESS ADAPTER TABLE -->';
    const endMarker = '<!-- END GENERATED HARNESS ADAPTER TABLE -->';
    const begin = adr.indexOf(beginMarker);
    const end = adr.indexOf(endMarker);
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(begin);
    const checkedIn = adr.slice(begin + beginMarker.length, end).trim();
    expect(checkedIn).toBe(renderHarnessAdapterMarkdown().trim());
  });

  test('ADR-0118 generated N by N matrix matches executable continuation rules', () => {
    const adr = readFileSync(new URL('../../docs/adr/0118-harness-adapter-contract.md', import.meta.url), 'utf8');
    const beginMarker = '<!-- BEGIN GENERATED HARNESS CONTINUATION MATRIX -->';
    const endMarker = '<!-- END GENERATED HARNESS CONTINUATION MATRIX -->';
    const begin = adr.indexOf(beginMarker);
    const end = adr.indexOf(endMarker);
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(begin);
    const checkedIn = adr.slice(begin + beginMarker.length, end).trim();
    expect(checkedIn).toBe(`\`\`\`text\n${renderHarnessContinuationMatrix().trim()}\n\`\`\``);
  });

  test('detectForcedCliBackend maps env values to catalog ids', () => {
    expect(detectForcedCliBackend({ PD_USE_CLI_BACKEND: 'claude-code' })).toBe(
      'cli:claude-code',
    );
    expect(detectForcedCliBackend({ PD_USE_CLI_BACKEND: 'claude' })).toBe(
      'cli:claude-code',
    );
    expect(detectForcedCliBackend({ PD_USE_CLI_BACKEND: 'CODEX' })).toBe('cli:codex');
    expect(detectForcedCliBackend({ PD_USE_CLI_BACKEND: 'agy' })).toBe('cli:agy');
    expect(detectForcedCliBackend({ PD_USE_CLI_BACKEND: 'antigravity' })).toBe('cli:agy');
    expect(detectForcedCliBackend({})).toBeNull();
    expect(detectForcedCliBackend({ PD_USE_CLI_BACKEND: '' })).toBeNull();
    expect(detectForcedCliBackend({ PD_USE_CLI_BACKEND: 'bogus' })).toBeNull();
  });

  test('detectForcedCliBackend honors an explicit persisted selection path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-backend-catalog-'));
    const path = join(dir, 'selection');
    try {
      writeFileSync(path, 'codex\n');
      expect(detectForcedCliBackend({}, { persistedPath: path })).toBe('cli:codex');
      expect(detectForcedCliBackendValue({}, { persistedPath: path })).toBe('codex');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('PD_USE_CLI_BACKEND=none hard-disables the override, including the persisted fallback', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-backend-catalog-'));
    const path = join(dir, 'selection');
    try {
      writeFileSync(path, 'codex\n');
      // Every off value beats a valid persisted selection.
      for (const off of ['none', 'off', 'disabled', 'disable', '0', 'false', 'NONE', ' Off ']) {
        expect(detectForcedCliBackend({ PD_USE_CLI_BACKEND: off }, { persistedPath: path })).toBeNull();
        expect(detectForcedCliBackendValue({ PD_USE_CLI_BACKEND: off }, { persistedPath: path })).toBeNull();
      }
      // ...while unset still falls through to the persisted selection.
      expect(detectForcedCliBackend({}, { persistedPath: path })).toBe('cli:codex');
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

  test('resolveEffectiveSpawnBackend reports whether a forced backend came from env or persisted selection', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-backend-catalog-'));
    const path = join(dir, 'selection');
    try {
      writeFileSync(path, 'codex\n');

      expect(resolveEffectiveSpawnBackend('openai', {}, { persistedPath: path })).toMatchObject({
        requestedBackend: 'openai',
        backend: 'cli:codex',
        forcedBackend: 'cli:codex',
        forcedSource: 'persisted',
        forced: true,
      });
      expect(resolveEffectiveSpawnBackend('openai', { PD_USE_CLI_BACKEND: 'agy' }, { persistedPath: path })).toMatchObject({
        requestedBackend: 'openai',
        backend: 'cli:agy',
        forcedBackend: 'cli:agy',
        forcedSource: 'env',
        forced: true,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('invalid persisted selection path types do not fall back to the default file', () => {
    const hadDefault = existsSync(CLI_BACKEND_SELECTION_PATH);
    const savedDefault = hadDefault ? readFileSync(CLI_BACKEND_SELECTION_PATH, 'utf-8') : null;
    try {
      writeFileSync(CLI_BACKEND_SELECTION_PATH, 'codex\n');
      expect(detectForcedCliBackend(process.env, { persistedPath: 7 })).toBeNull();
    } finally {
      if (hadDefault) writeFileSync(CLI_BACKEND_SELECTION_PATH, savedDefault);
      else rmSync(CLI_BACKEND_SELECTION_PATH, { force: true });
    }
  });

  test('oversized persisted backend selection files are ignored', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pd-backend-catalog-'));
    const path = join(dir, 'selection');
    try {
      writeFileSync(path, `${'codex'.repeat(40)}\n`);
      expect(detectForcedCliBackend({}, { persistedPath: path })).toBeNull();
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
    expect(detectForcedCliBackendValue({ PD_USE_CLI_BACKEND: 'Antigravity' })).toBe('agy');
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
