import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearCurrentContext,
  getContextDir,
  getContextPathForSlot,
  getLegacyContextPath,
  readCurrentContext,
  resolveContextSlot,
  writeCurrentContext,
} from '../../cli/utils/current-context.js';

describe('current-context helper', () => {
  let projectDir;
  let originalSlot;
  let originalContextDir;
  let originalCodexThreadId;

  let originalAgentId;
  let originalSessionId;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'pd-current-context-'));
    originalSlot = process.env.PORT_DADDY_CONTEXT_SLOT;
    originalContextDir = process.env.PORT_DADDY_CONTEXT_DIR;
    originalCodexThreadId = process.env.CODEX_THREAD_ID;
    originalAgentId = process.env.PD_AGENT_ID;
    originalSessionId = process.env.PD_SESSION_ID;
    delete process.env.PORT_DADDY_CONTEXT_SLOT;
    delete process.env.PORT_DADDY_CONTEXT_DIR;
    delete process.env.CODEX_THREAD_ID;
    delete process.env.PD_AGENT_ID;
    delete process.env.PD_SESSION_ID;
  });

  afterEach(() => {
    if (originalSlot === undefined) delete process.env.PORT_DADDY_CONTEXT_SLOT;
    else process.env.PORT_DADDY_CONTEXT_SLOT = originalSlot;
    if (originalContextDir === undefined) delete process.env.PORT_DADDY_CONTEXT_DIR;
    else process.env.PORT_DADDY_CONTEXT_DIR = originalContextDir;
    if (originalCodexThreadId === undefined) delete process.env.CODEX_THREAD_ID;
    else process.env.CODEX_THREAD_ID = originalCodexThreadId;
    if (originalAgentId === undefined) delete process.env.PD_AGENT_ID;
    else process.env.PD_AGENT_ID = originalAgentId;
    if (originalSessionId === undefined) delete process.env.PD_SESSION_ID;
    else process.env.PD_SESSION_ID = originalSessionId;
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

  it('returns env-var context when PD_AGENT_ID is set, ignoring filesystem', () => {
    process.env.PD_AGENT_ID = 'agent-from-env';
    process.env.PD_SESSION_ID = 'session-from-env';
    // Write a conflicting file-based context — env vars must win.
    writeCurrentContext({ agentId: 'agent-from-file', sessionId: 'session-from-file' }, projectDir);
    const ctx = readCurrentContext(projectDir);
    expect(ctx?.agentId).toBe('agent-from-env');
    expect(ctx?.sessionId).toBe('session-from-env');
  });

  it('returns env-var context when only PD_AGENT_ID is set', () => {
    process.env.PD_AGENT_ID = 'agent-only';
    const ctx = readCurrentContext(projectDir);
    expect(ctx?.agentId).toBe('agent-only');
    expect(ctx?.sessionId).toBe('');
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
});
