/**
 * MCP-server-process session cache.
 *
 * Regression target: an agent that successfully called begin_session was
 * still forced to re-pass session_id on every subsequent add_note /
 * claim_files / etc. call, or the daemon fell back to guessing the "most
 * recent active session in this worktree" — which throws
 * AMBIGUOUS_ACTIVE_SESSION the instant more than one session is active,
 * even though the calling agent's own session id was already known from
 * begin_session's response. These tests pin the fix: mcp/server.ts caches
 * the session per process and defaults to it unless the caller explicitly
 * targets a different one.
 */
import {
  setActiveSession,
  clearActiveSession,
  getActiveSession,
  resolveSessionId,
  resolveAgentId,
} from '../../lib/mcp-session-cache.js';

describe('mcp session cache', () => {
  afterEach(() => {
    clearActiveSession();
  });

  test('starts with no active session', () => {
    expect(getActiveSession()).toBeNull();
    expect(resolveSessionId({})).toBeUndefined();
    expect(resolveAgentId({})).toBeUndefined();
    expect(resolveAgentId({ agent_id: '' })).toBeUndefined();
    expect(resolveAgentId({ agent_id: '   ' })).toBeUndefined();
    expect(resolveAgentId({ agent_id: 42 as unknown as string })).toBeUndefined();
    expect(resolveAgentId({ agent_id: null as unknown as string })).toBeUndefined();
    expect(resolveAgentId({ agent_id: true as unknown as string })).toBeUndefined();
    expect(resolveAgentId({ agent_id: { id: 'agent-1' } as unknown as string })).toBeUndefined();
  });

  test('setActiveSession makes it the resolution default', () => {
    setActiveSession({ agentId: 'agent-1', sessionId: 'session-1' });
    expect(getActiveSession()).toEqual({ agentId: 'agent-1', sessionId: 'session-1' });
    expect(resolveSessionId({})).toBe('session-1');
    expect(resolveAgentId({})).toBe('agent-1');
  });

  test('an explicit session_id in args always wins over the cache', () => {
    setActiveSession({ agentId: 'agent-1', sessionId: 'session-1' });
    expect(resolveSessionId({ session_id: 'session-other' })).toBe('session-other');
    expect(resolveAgentId({ agent_id: 'agent-other' })).toBe('agent-other');
  });

  test('an empty-string arg does not override the cache (treated as absent)', () => {
    setActiveSession({ agentId: 'agent-1', sessionId: 'session-1' });
    expect(resolveSessionId({ session_id: '' })).toBe('session-1');
    expect(resolveSessionId({ session_id: '   ' })).toBe('session-1');
    expect(resolveAgentId({ agent_id: '' })).toBe('agent-1');
    expect(resolveAgentId({ agent_id: '   ' })).toBe('agent-1');
  });

  test('clearActiveSession removes the default, falling back to undefined', () => {
    setActiveSession({ agentId: 'agent-1', sessionId: 'session-1' });
    clearActiveSession();
    expect(getActiveSession()).toBeNull();
    expect(resolveSessionId({})).toBeUndefined();
    expect(resolveAgentId({})).toBeUndefined();
  });

  test('setActiveSession replaces a prior cached session (e.g. a new begin_session in the same process)', () => {
    setActiveSession({ agentId: 'agent-1', sessionId: 'session-1' });
    setActiveSession({ agentId: 'agent-2', sessionId: 'session-2' });
    expect(getActiveSession()).toEqual({ agentId: 'agent-2', sessionId: 'session-2' });
  });

  test('non-string args are ignored, not thrown', () => {
    setActiveSession({ agentId: 'agent-1', sessionId: 'session-1' });
    expect(resolveSessionId({ session_id: 42 as unknown as string })).toBe('session-1');
    expect(resolveSessionId({ session_id: null as unknown as string })).toBe('session-1');
    expect(resolveAgentId({ agent_id: 42 as unknown as string })).toBe('agent-1');
    expect(resolveAgentId({ agent_id: null as unknown as string })).toBe('agent-1');
    expect(resolveAgentId({ agent_id: true as unknown as string })).toBe('agent-1');
    expect(resolveAgentId({ agent_id: { id: 'agent-2' } as unknown as string })).toBe('agent-1');
  });
});
