// tests/unit/cli-tube-backends-launch.test.js
//
// Regression coverage for the three bugs that kept cli:claude-code and cli:codex
// from ever completing a spawn through the daemon (see PR #408):
//   1. usage dropped from the cli-tube stream → "did not return token counts"
//   2. codex unfindable on a bare-PATH daemon (nvm/volta version dirs missing)
//   3. the backend-name placeholder model ("claude-code") — unpriceable + rejected

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { extractClaudeCodeUsage } = await import('../../lib/spawner/cli-claude-code-transcript.js');
const { cliBinDirs } = await import('../../lib/cli-bin-dirs.js');
const { buildArgs } = await import('../../lib/spawner/backends/cli-tube.js');
const { resolveFleetAgentRuntime } = await import('../../lib/fleet-engine.js');
const { DEFAULT_OPERATOR_CLAUDE_MODEL, DEFAULT_OPERATOR_CODEX_MODEL } = await import('../../lib/backend-telemetry-policy.js');

describe('extractClaudeCodeUsage — stream-json result usage', () => {
  test('reads input/output/cache tokens from the terminal result event', () => {
    const raw = [
      '{"type":"system","subtype":"init"}',
      '{"type":"assistant","message":{"content":[]}}',
      '{"type":"result","subtype":"success","result":"ok","usage":{"input_tokens":3,"output_tokens":4,"cache_read_input_tokens":16862,"cache_creation_input_tokens":37656}}',
    ].join('\n');
    const u = extractClaudeCodeUsage(raw);
    // cache_creation is freshly-written (billed) input, folded into inputTokens
    expect(u.inputTokens).toBe(3 + 37656);
    expect(u.outputTokens).toBe(4);
    expect(u.cachedInputTokens).toBe(16862);
  });

  test('returns {} when no result/usage is present (caller estimates)', () => {
    expect(extractClaudeCodeUsage('')).toEqual({});
    expect(extractClaudeCodeUsage('{"type":"assistant"}\nnot json')).toEqual({});
  });

  test('never throws on malformed lines', () => {
    expect(() => extractClaudeCodeUsage('{bad\n{"type":"result"}')).not.toThrow();
  });
});

describe('cliBinDirs — finds npm-global CLIs under node version managers', () => {
  const realHome = process.env.HOME;
  let home;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pd-binhome-'));
    process.env.HOME = home;
    delete process.env.PD_CLI_BIN_DIRS;
  });
  afterEach(() => {
    process.env.HOME = realHome;
    try { rmSync(home, { recursive: true, force: true }); } catch { /* noop */ }
  });

  test('enumerates ~/.nvm/versions/node/<ver>/bin (where codex/grok install)', () => {
    const nvmBin = join(home, '.nvm', 'versions', 'node', 'v22.17.1', 'bin');
    mkdirSync(nvmBin, { recursive: true });
    expect(cliBinDirs()).toContain(nvmBin);
  });

  test('always includes the per-user + homebrew fixed dirs', () => {
    const dirs = cliBinDirs();
    expect(dirs).toContain(join(home, '.local', 'bin'));
    expect(dirs).toContain('/opt/homebrew/bin');
  });

  test('honors the PD_CLI_BIN_DIRS override first', () => {
    process.env.PD_CLI_BIN_DIRS = '/custom/a:/custom/b';
    const dirs = cliBinDirs();
    expect(dirs[0]).toBe('/custom/a');
    expect(dirs[1]).toBe('/custom/b');
  });
});

describe('resolveFleetAgentRuntime — cli backend default model is rate-backed', () => {
  test('cli:claude-code with no model → operator Claude default (not the placeholder)', () => {
    const r = resolveFleetAgentRuntime({ backend: 'cli:claude-code' });
    expect(r.model).toBe(DEFAULT_OPERATOR_CLAUDE_MODEL);
    expect(r.model).not.toBe('claude-code');
  });

  test('cli:codex with no model → operator Codex default', () => {
    const r = resolveFleetAgentRuntime({ backend: 'cli:codex' });
    expect(r.model).toBe(DEFAULT_OPERATOR_CODEX_MODEL);
  });

  test('cli:agy with no model leaves model unset for the CLI account default', () => {
    const r = resolveFleetAgentRuntime({ backend: 'cli:agy' });
    expect(r.model).toBeUndefined();
  });

  test('cli:agy synthetic placeholders are treated as unset, not real models', () => {
    for (const model of ['agy', 'agy-cli', 'agy-default']) {
      const r = resolveFleetAgentRuntime({ backend: 'cli:agy', model });
      expect(r.model).toBeUndefined();
    }
  });

  test('a leaked backend-name placeholder model is replaced', () => {
    const r = resolveFleetAgentRuntime({ backend: 'cli:claude-code', model: 'claude-code' });
    expect(r.model).toBe(DEFAULT_OPERATOR_CLAUDE_MODEL);
  });

  test('an explicit real model is preserved', () => {
    const r = resolveFleetAgentRuntime({ backend: 'cli:claude-code', model: 'sonnet' });
    expect(r.model).toBe('sonnet');
  });
});

describe('cli-tube buildArgs — placeholder model never reaches the CLI', () => {
  test('claude-code placeholder maps to a real default model arg', () => {
    const { args } = buildArgs('claude-code', 'hi', undefined, 'claude-code');
    const i = args.indexOf('--model');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(args[i + 1]).toBe('sonnet');
    expect(args).not.toContain('claude-code'); // the bare backend name is never a model arg
  });

  test('codex placeholder drops --model (CLI uses its account default)', () => {
    const { args } = buildArgs('codex', 'hi', undefined, 'codex');
    expect(args).not.toContain('--model');
  });

  test('agy placeholder drops --model (CLI uses its account default)', () => {
    const { args } = buildArgs('agy', 'hi', undefined, 'agy-cli');
    expect(args).toEqual(['--print', 'hi']);
  });

  test('a real explicit model is forwarded unchanged', () => {
    const { args } = buildArgs('claude-code', 'hi', undefined, 'claude-haiku-4-5-20251001');
    const i = args.indexOf('--model');
    expect(args[i + 1]).toBe('claude-haiku-4-5-20251001');
  });
});
