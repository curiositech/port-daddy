import { jest, test, beforeEach, afterEach, expect } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const order = [];
const injectHooks = jest.fn(async () => { order.push('hooks'); });
const dispose = jest.fn();
let confined = true;
const wrap = jest.fn(async input => {
  order.push('wrap');
  return { ...input, confined, receipt: () => ({ confined, mechanism: 'fixture' }), dispose };
});
const spawn = jest.fn(() => {
  order.push('spawn');
  const child = new EventEmitter();
  child.stdout = Readable.from([JSON.stringify({ type: 'result', result: 'captured answer', usage: { input_tokens: 2, output_tokens: 3 } }) + '\n']);
  child.stderr = Readable.from([]);
  child.kill = jest.fn();
  setTimeout(() => child.emit('close', 0), 0);
  return child;
});
jest.unstable_mockModule('node:child_process', () => ({ spawn, execSync: jest.fn(), execFileSync: jest.fn(), execFile: jest.fn((_a, _b, _c, cb) => cb?.(null, '', '')) }));
jest.unstable_mockModule('../../lib/spawner/coast-guard-runner.js', () => ({ withCoastGuard: wrap }));
jest.unstable_mockModule('../../lib/squid/adapter.js', () => ({ ClaudeCliSquidAdapter: class { injectHooks = injectHooks; } }));
const { createSpawner } = await import('../../lib/spawner.js');
const { captureWorkspaceIdentity } = await import('../../lib/workspace-identity.js');
let root;
const snapshot = Object.fromEntries(['PD_CLI_CLAUDE_CODE_BIN', 'ANTHROPIC_API_KEY', 'PD_COAST_GUARD_OFF'].map(key => [key, process.env[key]]));

beforeEach(() => {
  jest.clearAllMocks(); order.length = 0; confined = true;
  root = mkdtempSync(join(homedir(), 'coding/tmp/pd-alias-parity-'));
  writeFileSync(join(root, '.git'), 'gitdir: /fixture/.git/worktrees/worker\n');
  const binary = join(root, 'claude'); writeFileSync(binary, '#!/bin/sh\nexit 1\n'); chmodSync(binary, 0o755);
  process.env.PD_CLI_CLAUDE_CODE_BIN = binary;
  process.env.ANTHROPIC_API_KEY = 'fixture-inherited-must-not-leak';
  delete process.env.PD_COAST_GUARD_OFF;
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }), text: async () => 'OK' }));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [key, value] of Object.entries(snapshot)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
});
const makeSpawner = () => createSpawner({ enforceTranscriptPolicy: false, enforceTelemetryPolicy: false, telemetryBypassApproval: { humanConfirmed: true, confirmedBy: 'jest', reason: 'Hermetic alias parity fixture' } });

test.each(['codex', 'cli:codex', 'cli:agy', 'gemini'])('%s rejects Claude-only options before side effects or misleading history', async backend => {
  for (const option of [{ permissionMode: 'bypassPermissions' }, { injectSquidHooks: true }, { injectSquidHooks: false }]) {
    const spawner = makeSpawner();
    const result = await spawner.spawn({ backend, task: 'x', workdir: root, ...option });
    expect(result.error).toMatch(/supported only by Claude CLI aliases|permissionMode was removed/);
    expect(result.executionIntent).toBeUndefined();
    expect(spawner.list()).toHaveLength(0);
  }
  expect(injectHooks).not.toHaveBeenCalled();
  expect(wrap).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
});

test.each(['claude-cli', 'cli:claude-code'])('%s fails closed when requested hook installation fails after wrapper admission', async backend => {
  injectHooks.mockImplementationOnce(async () => { order.push('hooks'); throw new Error('hook installation denied'); });
  const result = await makeSpawner().spawn({ backend, task: 'x', workdir: root, injectSquidHooks: true, executionIntent: 'autonomous' });
  expect(result.error).toContain('hook installation denied');
  expect(order).toEqual(['wrap', 'hooks']);
  expect(spawn).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledTimes(1);
});

test.each(['claude-cli', 'cli:claude-code'])('%s retains primary proof failure and wrapper cleanup failure', async backend => {
  confined = false;
  dispose.mockImplementationOnce(() => { throw new Error('wrapper cleanup denied'); });
  const result = await makeSpawner().spawn({ backend, task: 'x', workdir: root, executionIntent: 'autonomous', injectSquidHooks: true });
  expect(result.error).toContain('did not establish external confinement');
  expect(result.error).toContain('wrapper cleanup denied');
  expect(injectHooks).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
});

test.each(['claude-cli', 'cli:claude-code'])('%s preserves explicit mode, selected prompt, hooks, cwd, resume and caller env', async backend => {
  const spawner = makeSpawner();
  const result = await spawner.spawn({ backend, task: 'selected guidance only', model: 'explicit-model', workdir: root,
    executionIntent: 'autonomous', allowedTools: 'Read,Edit', injectSquidHooks: true,
    env: { EXPLICIT_MARKER: 'kept', PATH: '/explicit/bin:/usr/bin' },
    nativeResume: { adapterFamily: 'claude-code', sessionId: '22222222-2222-4222-8222-222222222222', workspaceIdentity: captureWorkspaceIdentity(root) },
  });
  expect(result.error).toBeNull();
  expect(result.executionIntent).toBe('autonomous');
  expect(spawner.list().find(agent => agent.agentId === result.agentId)).toMatchObject({ executionIntent: 'autonomous', coastGuard: { confined: true } });
  expect(result.output).toContain('captured answer');
  expect(order).toEqual(['wrap', 'hooks', 'spawn']);
  expect(injectHooks).toHaveBeenCalledWith(root);
  const [cmd, args, options] = spawn.mock.calls[0];
  expect(cmd).toBe(join(root, 'claude'));
  expect(options.cwd).toBe(root);
  expect(options.env.EXPLICIT_MARKER).toBe('kept');
  expect(options.env.PATH).toContain('/explicit/bin');
  expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(args).toContain('--dangerously-skip-permissions');
  expect(args).toContain('--disable-slash-commands');
  expect(args).toContain('--resume');
  expect(args).toContain('Read,Edit');
  expect(args.at(-1)).toBe('selected guidance only');
  expect(args[args.indexOf('--output-format') + 1]).toBe(backend === 'claude-cli' ? 'json' : 'stream-json');
  expect(dispose).toHaveBeenCalledTimes(1);
});

test.each(['claude-cli', 'cli:claude-code'])('%s admits only explicitly supplied provider key, never inherited key', async backend => {
  await makeSpawner().spawn({ backend, task: 'x', workdir: root, env: { ANTHROPIC_API_KEY: 'explicit-fixture-key' } });
  // Assert pre-broker input: the real Coast Guard still independently scrubs managed secrets.
  expect(wrap.mock.calls[0][0].env.ANTHROPIC_API_KEY).toBe('explicit-fixture-key');
});

test.each(['claude-cli', 'cli:claude-code'])('%s rejects removed permissionMode before hook or child mutation', async backend => {
  const result = await makeSpawner().spawn({ backend, task: 'x', workdir: root, permissionMode: 'acceptEdits', injectSquidHooks: true });
  expect(result.error).toContain('permissionMode was removed');
  expect(injectHooks).not.toHaveBeenCalled();
  expect(spawn).not.toHaveBeenCalled();
});

test.each(['claude-cli', 'cli:claude-code'])('%s preserves manual intent and shared model default', async backend => {
  await makeSpawner().spawn({ backend, task: 'x', workdir: root, executionIntent: 'manual' });
  const args = spawn.mock.calls[0][1];
  expect(args).not.toContain('--permission-mode');
  expect(args).toContain('--disable-slash-commands');
  expect(args).not.toContain('--dangerously-skip-permissions');
  expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
});

test.each(['claude-cli', 'cli:claude-code'])('%s rejects false or missing actual wrapper proof before spawn', async backend => {
  for (const proof of [false, undefined]) {
    confined = proof;
    const result = await makeSpawner().spawn({ backend, task: 'must not run', workdir: root, executionIntent: 'autonomous', injectSquidHooks: true });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('did not establish external confinement');
  }
  expect(spawn).not.toHaveBeenCalled();
  expect(injectHooks).not.toHaveBeenCalled();
  expect(dispose).toHaveBeenCalledTimes(2);
});
