/**
 * Execute the actual CLI module with inert I/O boundaries. These fixtures never
 * admit an actor, read a context, contact a daemon, or use a real credential.
 */
import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../../cli/commands/sugar.ts', import.meta.url), 'utf8');
const quoteSource = readFileSync(new URL('../../lib/shell-quote.ts', import.meta.url), 'utf8');
const typesSource = readFileSync(new URL('../../cli/types.ts', import.meta.url), 'utf8');
const SYNTHETIC = "fixture-only-actor.credential-'\\-not-valid";
const NOW = 123456789;

function evaluate(code, bindings = {}, dependencies = {}) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, {
    module, exports: module.exports,
    require(name) {
      if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected module: ${name}`);
      return dependencies[name];
    },
    ...bindings,
  });
  return module.exports;
}

const quote = evaluate(quoteSource);
const types = evaluate(typesSource);

function fixture({ response, ok = true, env = {}, persistenceError } = {}) {
  const events = [];
  const stdout = [];
  const stderr = [];
  const writes = [];
  const data = response ?? {
    success: true,
    agentId: 'fixture-agent', sessionId: 'fixture-session', actorId: 'fixture-actor',
    agentName: 'Fixture Agent', sessionName: 'Fixture Session',
    identity: 'fixture:cli', actorIdentity: { verified: true, actorId: 'fixture-actor' },
    lifecycle: 'durable', resumed: false, roadmapLink: 'fixture-roadmap',
    worktree: { id: 'fixture-world', branch: 'codex/fixture' },
    fileClaims: ['fixture.ts'], credential: SYNTHETIC,
  };
  const unexpected = () => { throw new Error('Unexpected external boundary'); };
  const pdFetch = jest.fn(async () => { events.push('fetch'); return { ok, json: async () => data }; });
  const log = (...args) => { events.push('stdout'); stdout.push(args.join(' ')); };
  const error = (...args) => stderr.push(args.join(' '));
  const dependencies = {
    'node:child_process': { spawn: unexpected },
    '../../lib/maritime.js': { highlightChannel: (value) => value },
    '../../lib/client.js': { default: unexpected },
    '../utils/fetch.js': { pdFetch, PORT_DADDY_URL: 'http://fixture.invalid' },
    '../utils/actor-credential.js': { ensureCliActorCredential: unexpected, resolveCliActorCredential: unexpected },
    '../types.js': types,
    '../utils/output.js': { IS_TTY: false, relativeTime: unexpected },
    '../utils/prompt.js': { canPrompt: () => false, promptText: unexpected, promptSelect: unexpected,
      promptIdentity: unexpected, promptConfirm: unexpected, printRoger: unexpected },
    './services.js': { autoIdentityFromPackageJson: unexpected },
    '../../lib/shell-quote.js': quote,
    '../utils/ui.js': { lineworkEnabled: () => false, success: error, warn: error },
    '../utils/current-context.js': {
      clearCurrentContext: unexpected, readCurrentContext: unexpected, resolveCurrentContext: unexpected,
      writeCurrentContext(value) {
        events.push('persist');
        if (persistenceError) throw persistenceError;
        writes.push(value);
      },
    },
    '../utils/session-worktree-policy.js': {
      resolveCliSessionWorktreePolicy: () => ({ success: true }),
      attachCliSessionWorktreePolicy: (body) => { body.worktree = { id: 'fixture-world' }; },
    },
    '../../lib/db.js': { initDatabase: unexpected },
    '../../lib/dispatch/queue.js': { createDispatchQueue: unexpected },
    '../../lib/dispatch/auto-merge.js': { checkAndCompleteDispatch: unexpected },
    '../../lib/semantic-resolver.js': { DEFAULT_SEMANTIC_REVIEW_THRESHOLD: 0.5 },
  };
  const exports = evaluate(source, {
    console: { log, error },
    process: { env: { CI: '1', ...env }, stdout: { isTTY: false }, stdin: { isTTY: false },
      stderr: { isTTY: false, write: error }, exit: unexpected },
    Date: class extends Date { static now() { return NOW; } },
    URLSearchParams,
  }, dependencies);
  return {
    data, events, stdout, stderr, writes, pdFetch,
    run: (options = {}) => exports.handleBegin('Fixture purpose', [], {
      lifecycle: 'durable', roadmap: 'fixture-roadmap', identity: 'fixture:cli', ...options,
    }),
  };
}

function expectPrivateOnly(test) {
  expect([...test.stdout, ...test.stderr].join('\n')).not.toContain(SYNTHETIC);
  expect(test.stderr).toEqual([]);
}

describe('begin public output and private admission persistence', () => {
  test.each([{ json: true }, { j: true }])('fresh JSON %j omits the credential, preserving every public field', async (options) => {
    const test = fixture();
    const original = structuredClone(test.data);
    await test.run(options);
    const { credential, ...publicResult } = original;
    expect(JSON.parse(test.stdout[0])).toEqual(publicResult);
    expect(JSON.parse(test.stdout[0])).not.toHaveProperty('credential');
    expect(test.data).toEqual(original);
    expect(test.writes).toEqual([{
      agentId: 'fixture-agent', sessionId: 'fixture-session',
      agentName: 'Fixture Agent', sessionName: 'Fixture Session',
      purpose: 'Fixture purpose', identity: 'fixture:cli', startedAt: NOW, credential,
    }]);
    expect(test.events).toEqual(['fetch', 'persist', 'stdout']);
    expectPrivateOnly(test);
  });

  test.each([undefined, null, '', { token: SYNTHETIC }])('credential value %j never enters JSON', async (credential) => {
    const test = fixture({ response: { success: true, agentId: 'fixture-agent', sessionId: 'fixture-session', credential } });
    await test.run({ json: true });
    expect(JSON.parse(test.stdout[0])).toEqual({ success: true, agentId: 'fixture-agent', sessionId: 'fixture-session' });
    expect(test.writes[0].credential).toBeNull();
    expectPrivateOnly(test);
  });

  test.each(['PD_ACTOR_CREDENTIAL', 'PORT_DADDY_ACTOR_CREDENTIAL'])('resumed response retains the private %s fallback only', async (key) => {
    const response = { success: true, resumed: true, agentId: 'fixture-agent', sessionId: 'fixture-session' };
    const test = fixture({ response, env: { [key]: ` ${SYNTHETIC} ` } });
    await test.run({ json: true });
    expect(JSON.parse(test.stdout[0])).toEqual(response);
    expect(test.writes[0].credential).toBe(SYNTHETIC);
    expectPrivateOnly(test);
  });

  test('fresh credential persistence takes precedence over both environment fallbacks', async () => {
    const test = fixture({ env: { PD_ACTOR_CREDENTIAL: 'fixture-old-a', PORT_DADDY_ACTOR_CREDENTIAL: 'fixture-old-b' } });
    await test.run({ json: true });
    expect(test.writes[0].credential).toBe(SYNTHETIC);
    expectPrivateOnly(test);
  });

  test('HTTP rejection does not persist or dump a credential-bearing response', async () => {
    const test = fixture({ ok: false, response: { success: false, error: 'Fixture refusal', credential: SYNTHETIC } });
    await expect(test.run({ json: true })).rejects.toThrow('Fixture refusal');
    expect(test.writes).toEqual([]);
    expect(test.stdout).toEqual([]);
    expectPrivateOnly(test);
  });

  test('private persistence failure cannot emit a successful public result', async () => {
    const test = fixture({ persistenceError: new Error('Fixture persistence refusal') });
    await expect(test.run({ json: true })).rejects.toThrow('Fixture persistence refusal');
    expect(test.events).toEqual(['fetch', 'persist']);
    expect(test.stdout).toEqual([]);
    expectPrivateOnly(test);
  });

  test.each([{ quiet: true }, { q: true }])('quiet %j keeps only the agent identifier', async (options) => {
    const test = fixture();
    await test.run(options);
    expect(test.stdout).toEqual(['fixture-agent']);
    expect(test.writes[0].credential).toBe(SYNTHETIC);
    expectPrivateOnly(test);
  });

  test.each(['/bin/zsh', '/usr/local/bin/fish'])('intentional explicit exports remain quoted for %s', async (shell) => {
    const test = fixture({ env: { PD_EMIT_EXPORTS: '1', SHELL: shell } });
    await test.run();
    const fish = shell.endsWith('/fish');
    expect(test.stdout).toEqual(fish ? [
      `set -x PD_AGENT_ID ${quote.fishShellQuote('fixture-agent')}`,
      `set -x PD_SESSION_ID ${quote.fishShellQuote('fixture-session')}`,
      `set -x PD_ACTOR_CREDENTIAL ${quote.fishShellQuote(SYNTHETIC)}`,
    ] : [
      `export PD_AGENT_ID=${quote.posixShellQuote('fixture-agent')}`,
      `export PD_SESSION_ID=${quote.posixShellQuote('fixture-session')}`,
      `export PD_ACTOR_CREDENTIAL=${quote.posixShellQuote(SYNTHETIC)}`,
    ]);
    expect(test.writes[0].credential).toBe(SYNTHETIC);
    expect(test.stderr).toEqual([]);
  });

  test('JSON retains precedence over explicit exports and quiet without exposing credentials', async () => {
    const test = fixture({ env: { PD_EMIT_EXPORTS: '1', SHELL: '/bin/zsh' } });
    await test.run({ json: true, quiet: true });
    expect(test.stdout).toHaveLength(1);
    expect(JSON.parse(test.stdout[0])).toMatchObject({ agentId: 'fixture-agent', sessionId: 'fixture-session' });
    expect(JSON.parse(test.stdout[0])).not.toHaveProperty('credential');
    expectPrivateOnly(test);
  });
});
