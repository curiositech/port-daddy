import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearCurrentContext,
  getContextDir,
  getContextPathForSlot,
  getLegacyContextPath,
  readCurrentContext,
  resolveCurrentContext,
  resolveContextSlot,
  writeCurrentContext,
} from '../../cli/utils/current-context.js';

// Every env var resolveContextSlot() consults, so tests get a clean slate
// regardless of which agent harness (if any) is actually running them —
// e.g. this suite runs fine under Claude Code, which sets CLAUDE_CODE_SESSION_ID
// in the ambient environment and would otherwise leak into the "headless
// fallback" tests below.
const CONTEXT_ENV_VARS = [
  'PORT_DADDY_CONTEXT_SLOT',
  'PORT_DADDY_CONTEXT_DIR',
  'CODEX_THREAD_ID',
  'CLAUDE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ID',
  'CURSOR_SESSION_ID',
  'AIDER_SESSION_ID',
  'COPILOT_SESSION_ID',
  'TERM_SESSION_ID',
  'PD_AGENT_ID',
  'PD_SESSION_ID',
];

describe('current-context helper', () => {
  let projectDir;
  let originalEnv;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'pd-current-context-'));
    originalEnv = {};
    for (const name of CONTEXT_ENV_VARS) {
      originalEnv[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of CONTEXT_ENV_VARS) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  });

  it('isolates context by slot while keeping a legacy pointer', () => {
    process.env.PORT_DADDY_CONTEXT_SLOT = 'shell-a';
    writeCurrentContext({
      agentId: 'agent-a',
      sessionId: 'session-a',
      purpose: 'slot a',
      identity: 'port-daddy',
    }, projectDir);

    process.env.PORT_DADDY_CONTEXT_SLOT = 'shell-b';
    writeCurrentContext({
      agentId: 'agent-b',
      sessionId: 'session-b',
      purpose: 'slot b',
      identity: 'port-daddy',
    }, projectDir);

    process.env.PORT_DADDY_CONTEXT_SLOT = 'shell-a';
    expect(readCurrentContext(projectDir)?.sessionId).toBe('session-a');

    process.env.PORT_DADDY_CONTEXT_SLOT = 'shell-b';
    expect(readCurrentContext(projectDir)?.sessionId).toBe('session-b');

    expect(getContextPathForSlot('shell-a', projectDir)).not.toBe(getContextPathForSlot('shell-b', projectDir));
    expect(readCurrentContext(projectDir)?.contextSlot).toBe('shell-b');
    expect(getLegacyContextPath(projectDir)).toContain('.portdaddy/current.json');
  });

  it('restores the legacy pointer to another slot when clearing the current slot', () => {
    process.env.PORT_DADDY_CONTEXT_SLOT = 'shell-a';
    writeCurrentContext({
      agentId: 'agent-a',
      sessionId: 'session-a',
      purpose: 'slot a',
      identity: 'port-daddy',
    }, projectDir);

    process.env.PORT_DADDY_CONTEXT_SLOT = 'shell-b';
    writeCurrentContext({
      agentId: 'agent-b',
      sessionId: 'session-b',
      purpose: 'slot b',
      identity: 'port-daddy',
    }, projectDir);

    clearCurrentContext(projectDir);

    const legacySlot = process.env.PORT_DADDY_CONTEXT_SLOT;
    process.env.PORT_DADDY_CONTEXT_SLOT = 'shell-a';
    expect(readCurrentContext(projectDir)?.sessionId).toBe('session-a');
    process.env.PORT_DADDY_CONTEXT_SLOT = legacySlot;
    expect(readCurrentContext(projectDir)).toBeNull();
  });

  it('uses Codex thread identity as the stable non-interactive slot', () => {
    delete process.env.PORT_DADDY_CONTEXT_SLOT;
    process.env.CODEX_THREAD_ID = 'thread/with spaces';

    writeCurrentContext({
      agentId: 'agent-a',
      sessionId: 'session-a',
      purpose: 'non-interactive command',
      identity: 'port-daddy',
    }, projectDir);

    expect(resolveContextSlot()).toBe('codex-thread-with-spaces');
    expect(readCurrentContext(projectDir)?.sessionId).toBe('session-a');
  });

  it.each([
    ['CLAUDE_SESSION_ID', 'claude'],
    ['CLAUDE_CODE_SESSION_ID', 'claude-code'],
    ['CURSOR_SESSION_ID', 'cursor'],
    ['AIDER_SESSION_ID', 'aider'],
    ['COPILOT_SESSION_ID', 'copilot'],
  ])('recognizes the %s coding-agent harness session id', (envName, prefix) => {
    process.env[envName] = 'abc-123';
    expect(resolveContextSlot()).toBe(`${prefix}-abc-123`);
  });

  it('uses the declared harness precedence when multiple session ids are present', () => {
    process.env.CURSOR_SESSION_ID = 'cursor-session';
    process.env.COPILOT_SESSION_ID = 'copilot-session';

    expect(resolveContextSlot()).toBe('cursor-cursor-session');
  });

  it('falls back to a stable headless slot — not a per-process ppid — with no TTY or known agent env var', () => {
    delete process.env.PORT_DADDY_CONTEXT_SLOT;

    // No TTY in the Jest process and no known agent-harness env var set by
    // beforeEach's cleanup, so this exercises the true bottom fallback.
    expect(resolveContextSlot()).toBe('headless');

    // The regression this guards: a real `pd begin` (one process) followed
    // by `git commit`'s hook-forked `pd guard check` (a DIFFERENT process,
    // and thus a different process.ppid) must resolve to the SAME slot so
    // the hook can find the session the calling shell just wrote. Mocking
    // process.ppid proves the slot no longer depends on it.
    const originalPpidDescriptor = Object.getOwnPropertyDescriptor(process, 'ppid');
    try {
      Object.defineProperty(process, 'ppid', { value: 111111, configurable: true });
      writeCurrentContext({
        agentId: 'agent-headless',
        sessionId: 'session-headless',
        purpose: 'pd begin, process A',
        identity: 'port-daddy',
      }, projectDir);

      Object.defineProperty(process, 'ppid', { value: 222222, configurable: true });
      expect(resolveContextSlot()).toBe('headless');
      expect(readCurrentContext(projectDir)?.sessionId).toBe('session-headless');
    } finally {
      if (originalPpidDescriptor) Object.defineProperty(process, 'ppid', originalPpidDescriptor);
    }
  });

  it('does not reuse another ppid slot through the legacy pointer', () => {
    delete process.env.PORT_DADDY_CONTEXT_SLOT;

    writeCurrentContext({
      agentId: 'agent-a',
      sessionId: 'session-a',
      purpose: 'non-interactive command',
      identity: 'port-daddy',
      contextSlot: 'ppid-previous-shell',
    }, projectDir);

    expect(readCurrentContext(projectDir)).toBeNull();
  });

  it('returns a structured conflict when complete environment and slot identities disagree', () => {
    process.env.PD_AGENT_ID = 'agent-from-env';
    process.env.PD_SESSION_ID = 'session-from-env';
    writeCurrentContext({ agentId: 'agent-from-file', sessionId: 'session-from-file' }, projectDir);

    const resolution = resolveCurrentContext(projectDir);

    expect(resolution).toMatchObject({
      success: false,
      code: 'CONTEXT_CONFLICT',
      provenances: {
        environment: {
          source: 'environment',
          agentId: 'agent-from-env',
          sessionId: 'session-from-env',
        },
        stored: {
          source: 'slot',
          agentId: 'agent-from-file',
          sessionId: 'session-from-file',
        },
      },
    });
    expect(readCurrentContext(projectDir)).toBeNull();
  });

  it('treats environment identity as atomic so an agent-only half cannot suppress a complete slot', () => {
    writeCurrentContext({ agentId: 'agent-file', sessionId: 'session-file' }, projectDir);
    process.env.PD_AGENT_ID = 'agent-only';

    const ctx = readCurrentContext(projectDir);

    expect(ctx?.agentId).toBe('agent-file');
    expect(ctx?.sessionId).toBe('session-file');
    expect(resolveCurrentContext(projectDir)).toMatchObject({
      success: true,
      ignoredPartialEnvironment: { agentId: 'agent-only', sessionId: null },
    });
  });

  it('treats environment identity as atomic so a session-only half cannot suppress a complete slot', () => {
    writeCurrentContext({ agentId: 'agent-file', sessionId: 'session-file' }, projectDir);
    process.env.PD_SESSION_ID = 'session-only';

    const ctx = readCurrentContext(projectDir);

    expect(ctx?.agentId).toBe('agent-file');
    expect(ctx?.sessionId).toBe('session-file');
    expect(resolveCurrentContext(projectDir)).toMatchObject({
      success: true,
      ignoredPartialEnvironment: { agentId: null, sessionId: 'session-only' },
    });
  });

  it('accepts a complete environment pair when it agrees with the slot and preserves slot metadata', () => {
    writeCurrentContext({
      agentId: 'same-agent',
      sessionId: 'same-session',
      credential: 'same-credential',
      purpose: 'preserved purpose',
    }, projectDir);
    process.env.PD_AGENT_ID = 'same-agent';
    process.env.PD_SESSION_ID = 'same-session';

    const resolution = resolveCurrentContext(projectDir);

    expect(resolution).toMatchObject({
      success: true,
      provenance: {
        source: 'environment',
        agentId: 'same-agent',
        sessionId: 'same-session',
      },
      context: {
        credential: 'same-credential',
        purpose: 'preserved purpose',
      },
    });
  });

  it('falls through to file context when PD_AGENT_ID is unset', () => {
    writeCurrentContext({ agentId: 'agent-file', sessionId: 'session-file' }, projectDir);
    const ctx = readCurrentContext(projectDir);
    expect(ctx?.agentId).toBe('agent-file');
  });

  it('honors an injected context directory over repo-local .portdaddy', () => {
    const injectedContextDir = mkdtempSync(join(tmpdir(), 'pd-current-context-injected-'));
    process.env.PORT_DADDY_CONTEXT_DIR = injectedContextDir;
    process.env.PORT_DADDY_CONTEXT_SLOT = 'shell-a';

    writeCurrentContext({
      agentId: 'agent-a',
      sessionId: 'session-a',
      purpose: 'injected',
      identity: 'port-daddy',
    }, projectDir);

    expect(getContextDir(projectDir)).toBe(injectedContextDir);
    expect(existsSync(getLegacyContextPath(projectDir))).toBe(true);
    expect(existsSync(join(projectDir, '.portdaddy', 'current.json'))).toBe(false);
    expect(readCurrentContext(projectDir)?.sessionId).toBe('session-a');
  });

  it('creates context directories as 0700 and credential-bearing files as 0600', () => {
    process.env.PORT_DADDY_CONTEXT_SLOT = 'secure-shell';
    writeCurrentContext({
      agentId: 'secure-agent',
      sessionId: 'secure-session',
      credential: 'actor.secret',
    }, projectDir);

    expect(statSync(getContextDir(projectDir)).mode & 0o777).toBe(0o700);
    expect(statSync(join(getContextDir(projectDir), 'contexts')).mode & 0o777).toBe(0o700);
    expect(statSync(getContextPathForSlot('secure-shell', projectDir)).mode & 0o777).toBe(0o600);
    expect(statSync(getLegacyContextPath(projectDir)).mode & 0o777).toBe(0o600);
  });

  it('repairs pre-existing loose context directory and file permissions on read/write', () => {
    process.env.PORT_DADDY_CONTEXT_SLOT = 'repair-shell';
    const contextDir = getContextDir(projectDir);
    const contextsDir = join(contextDir, 'contexts');
    writeCurrentContext({ agentId: 'repair-agent', sessionId: 'repair-session', credential: 'actor.secret' }, projectDir);
    const slotPath = getContextPathForSlot('repair-shell', projectDir);
    const legacyPath = getLegacyContextPath(projectDir);
    chmodSync(contextDir, 0o755);
    chmodSync(contextsDir, 0o755);
    chmodSync(slotPath, 0o644);
    chmodSync(legacyPath, 0o644);
    writeFileSync(slotPath, JSON.stringify({ agentId: 'repair-agent', sessionId: 'repair-session', credential: 'actor.secret' }));

    expect(readCurrentContext(projectDir)?.sessionId).toBe('repair-session');
    expect(statSync(contextDir).mode & 0o777).toBe(0o700);
    expect(statSync(contextsDir).mode & 0o777).toBe(0o700);
    expect(statSync(slotPath).mode & 0o777).toBe(0o600);

    writeCurrentContext({ agentId: 'repair-agent', sessionId: 'next-session', credential: 'next.secret' }, projectDir);
    expect(statSync(legacyPath).mode & 0o777).toBe(0o600);
  });

  it('rejects a symlinked context root without reading, chmodding, or writing through it', () => {
    process.env.PORT_DADDY_CONTEXT_SLOT = 'symlink-root';
    const target = join(projectDir, 'attacker-target');
    mkdirSync(target, { mode: 0o755 });
    writeFileSync(join(target, 'current.json'), JSON.stringify({ agentId: 'attacker', sessionId: 'victim' }), { mode: 0o644 });
    symlinkSync(target, getContextDir(projectDir));

    expect(readCurrentContext(projectDir)).toBeNull();
    expect(statSync(target).mode & 0o777).toBe(0o755);
    expect(statSync(join(target, 'current.json')).mode & 0o777).toBe(0o644);
    expect(() => writeCurrentContext({ agentId: 'safe', sessionId: 'safe-session', credential: 'secret' }, projectDir)).toThrow(/unsafe context directory/);
    expect(existsSync(join(target, 'contexts'))).toBe(false);
  });

  it('rejects symlinked context subdirectories and files without touching their targets', () => {
    process.env.PORT_DADDY_CONTEXT_SLOT = 'symlink-leaf';
    const contextDir = getContextDir(projectDir);
    mkdirSync(contextDir, { mode: 0o700 });
    const targetDir = join(projectDir, 'outside-contexts');
    mkdirSync(targetDir, { mode: 0o755 });
    const targetFile = join(targetDir, 'symlink-leaf.json');
    writeFileSync(targetFile, JSON.stringify({ agentId: 'attacker', sessionId: 'victim', credential: 'stolen' }), { mode: 0o644 });
    symlinkSync(targetDir, join(contextDir, 'contexts'));

    expect(readCurrentContext(projectDir)).toBeNull();
    expect(statSync(targetDir).mode & 0o777).toBe(0o755);
    expect(statSync(targetFile).mode & 0o777).toBe(0o644);
    expect(() => writeCurrentContext({ agentId: 'safe', sessionId: 'safe-session', credential: 'secret' }, projectDir)).toThrow(/unsafe context directory/);
  });

  it('refuses to clear through a symlinked context root', () => {
    process.env.PORT_DADDY_CONTEXT_SLOT = 'symlink-clear-root';
    const targetDir = join(projectDir, 'outside-clear-root');
    const targetStore = join(targetDir, 'contexts');
    mkdirSync(targetStore, { recursive: true, mode: 0o755 });
    const victim = join(targetStore, 'symlink-clear-root.json');
    writeFileSync(victim, JSON.stringify({ agentId: 'victim', sessionId: 'victim-session' }), { mode: 0o644 });
    writeFileSync(join(targetDir, 'current.json'), JSON.stringify({
      agentId: 'victim',
      sessionId: 'victim-session',
      contextSlot: 'symlink-clear-root',
    }), { mode: 0o644 });
    symlinkSync(targetDir, getContextDir(projectDir));

    clearCurrentContext(projectDir);

    expect(existsSync(victim)).toBe(true);
    expect(existsSync(join(targetDir, 'current.json'))).toBe(true);
  });

  it.each(['slot', 'legacy'])('rejects a hardlinked %s context without reading or changing its outside inode', (carrier) => {
    process.env.PORT_DADDY_CONTEXT_SLOT = 'hardlink-test';
    const contextDir = getContextDir(projectDir);
    mkdirSync(join(contextDir, 'contexts'), { recursive: true, mode: 0o700 });
    const target = join(projectDir, 'outside-context.json');
    const original = JSON.stringify({ agentId: 'other-agent', sessionId: 'other-session', credential: 'FIXTURE.secret' });
    writeFileSync(target, original, { mode: 0o644 });
    linkSync(target, carrier === 'slot'
      ? getContextPathForSlot('hardlink-test', projectDir)
      : getLegacyContextPath(projectDir));

    expect(statSync(target).nlink).toBe(2);
    expect(readCurrentContext(projectDir)).toBeNull();
    expect(statSync(target).mode & 0o777).toBe(0o644);
    expect(readFileSync(target, 'utf8')).toBe(original);
  });

  it('refuses to repair or write context directories owned by another user', () => {
    writeCurrentContext({ agentId: 'owner', sessionId: 'owned' }, projectDir);
    const contextDir = getContextDir(projectDir);
    chmodSync(contextDir, 0o755);
    const uid = jest.spyOn(process, 'getuid').mockReturnValue(statSync(contextDir).uid + 1);
    try {
      expect(readCurrentContext(projectDir)).toBeNull();
      expect(() => writeCurrentContext({ agentId: 'other', sessionId: 'other' }, projectDir)).toThrow(/unsafe context directory/);
      expect(statSync(contextDir).mode & 0o777).toBe(0o755);
    } finally {
      uid.mockRestore();
    }
  });

  it('refuses to clear through a symlinked context store', () => {
    process.env.PORT_DADDY_CONTEXT_SLOT = 'symlink-clear-store';
    const contextDir = getContextDir(projectDir);
    mkdirSync(contextDir, { mode: 0o700 });
    const targetStore = join(projectDir, 'outside-clear-store');
    mkdirSync(targetStore, { mode: 0o755 });
    const victim = join(targetStore, 'symlink-clear-store.json');
    writeFileSync(victim, JSON.stringify({ agentId: 'victim', sessionId: 'victim-session' }), { mode: 0o644 });
    symlinkSync(targetStore, join(contextDir, 'contexts'));

    clearCurrentContext(projectDir);

    expect(existsSync(victim)).toBe(true);
  });
});
