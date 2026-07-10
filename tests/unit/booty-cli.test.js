/**
 * Unit tests for the pd booty CLI provenance helpers (cli/commands/booty.ts).
 *
 * Verifies that provenance rows are populated from the active pd session
 * context (PD_SESSION_ID / PD_AGENT_ID or the .portdaddy context file) and
 * from git worktree info.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

const { buildBootyProvenance, resolveBootyProvenance } = await import('../../cli/commands/booty.js');

describe('buildBootyProvenance', () => {
  it('maps session context + worktree info into provenance fields', () => {
    const provenance = buildBootyProvenance(
      { agentId: 'agent-1', sessionId: 'session-xyz', identity: 'port-daddy:wave1' },
      { branch: 'claude/feature-x', root: '/repo/.claude/worktrees/wf_abc', name: 'wf_abc' },
    );
    expect(provenance.session_id).toBe('session-xyz');
    expect(provenance.agent_identity).toBe('port-daddy:wave1');
    expect(provenance.branch).toBe('claude/feature-x');
    expect(provenance.worktree).toBe('wf_abc');
  });

  it('falls back to agentId when identity is absent, and tolerates missing pieces', () => {
    const provenance = buildBootyProvenance({ agentId: 'agent-1', sessionId: 's-1' }, null);
    expect(provenance.agent_identity).toBe('agent-1');
    expect(provenance.session_id).toBe('s-1');
    expect(provenance.branch).toBeNull();
    expect(provenance.worktree).toBeNull();

    const empty = buildBootyProvenance(null, null);
    expect(empty.session_id).toBeNull();
    expect(empty.agent_identity).toBeNull();
  });
});

describe('resolveBootyProvenance (active pd session via env)', () => {
  let savedAgent;
  let savedSession;

  beforeEach(() => {
    savedAgent = process.env.PD_AGENT_ID;
    savedSession = process.env.PD_SESSION_ID;
    process.env.PD_AGENT_ID = 'agent-env';
    process.env.PD_SESSION_ID = 'session-env';
  });

  afterEach(() => {
    if (savedAgent === undefined) delete process.env.PD_AGENT_ID;
    else process.env.PD_AGENT_ID = savedAgent;
    if (savedSession === undefined) delete process.env.PD_SESSION_ID;
    else process.env.PD_SESSION_ID = savedSession;
  });

  it('populates provenance from the active session env context', () => {
    const provenance = resolveBootyProvenance();
    expect(provenance.session_id).toBe('session-env');
    expect(provenance.agent_identity).toBe('agent-env');
    // branch/worktree come from git in this repo — string or null, never undefined.
    expect(provenance.branch === null || typeof provenance.branch === 'string').toBe(true);
    expect(provenance.worktree === null || typeof provenance.worktree === 'string').toBe(true);
  });
});
