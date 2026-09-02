import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { closeDatabase, initDatabase } from '../../lib/db.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';
import { createClaimForest } from '../../lib/claim-forest.js';
import {
  AgentRunAdmissionError,
  createAgentRunAdmissionService,
} from '../../lib/agent-run-admission.js';
import { createDurableAgentRoster } from '../../lib/durable-agent-roster.js';

const SESSION_ID = 'session-admission-source';
const BODY_ID = 'body-admission-source';
const ACTOR_ID = '01ADMISSIONACTOR00000000000';
const WORKTREE_ID = 'worktree-admission';
const WORKTREE_ROOT = '/Users/operator/coding/tmp/port-daddy-admission';
const BRANCH = 'agent/durable-admission';
const HARBOR = 'port-daddy';

const WORKSPACE = {
  repoId: 'github.com/port-daddy/port-daddy',
  worktreeId: WORKTREE_ID,
  worktreeRoot: WORKTREE_ROOT,
  worktreeRealpath: WORKTREE_ROOT,
  worktreePhysicalId: `sha256:${'1'.repeat(64)}`,
  gitDirRealpath: '/Users/operator/coding/port-daddy/.git/worktrees/port-daddy-admission',
  gitDirPhysicalId: `sha256:${'2'.repeat(64)}`,
  repoCommonDir: '/Users/operator/coding/port-daddy/.git',
  branch: BRANCH,
  remote: 'git@github.com:port-daddy/port-daddy.git',
  head: 'a'.repeat(40),
  base: 'b'.repeat(40),
};

function promotionInput() {
  return {
    slug: 'portdaddy-admission-custodian',
    scope: { kind: 'system' as const },
    remit: 'Own canonical AgentRun admission for takeover successors.',
    instructions: 'Revalidate the daemon session and exact worktree before admission.',
    origin: {
      kind: 'session-promotion' as const,
      sourceSessionId: SESSION_ID,
      handoffEpisodeId: 41,
      sourceAgentId: BODY_ID,
      sourceAdapter: 'codex-cli',
    },
  };
}

describe('AgentRun admission for promoted durable agents', () => {
  let db: DatabaseInstance;
  let roster: ReturnType<typeof createDurableAgentRoster>;
  let admission: ReturnType<typeof createAgentRunAdmissionService>;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    roster = createDurableAgentRoster(db, {
      resolver: { modelId: 'test-embedder', embed: async () => [1, 0] },
      gitleaksRunner: () => ({ findings: [] }),
      now: () => new Date('2026-08-31T20:00:00.000Z'),
    });
    admission = createAgentRunAdmissionService(db, {
      getAgentNode: (agentNodeId) => roster.get(agentNodeId),
      probeWorktree: () => ({
        id: WORKTREE_ID,
        root: WORKTREE_ROOT,
        name: 'port-daddy-admission',
        branch: BRANCH,
        isMain: false,
        commonDir: '/Users/operator/coding/port-daddy/.git',
      }),
      captureWorkspace: () => WORKSPACE,
    });
    db.prepare(`
      INSERT INTO sessions (
        id, purpose, status, phase, agent_id, agent_node_id, worktree_id,
        identity_project, created_at, updated_at, completed_at, metadata, is_durable
      ) VALUES (?, ?, 'active', 'in_progress', ?, NULL, ?, 'port-daddy', ?, ?, NULL, ?, 1)
    `).run(
      SESSION_ID,
      'Become an admitted durable successor',
      BODY_ID,
      WORKTREE_ID,
      Date.parse('2026-08-31T19:00:00.000Z'),
      Date.parse('2026-08-31T19:00:00.000Z'),
      JSON.stringify({
        identity: { verified: true, actorId: ACTOR_ID, soulClass: 'graduated' },
        worktree: { id: WORKTREE_ID, root: WORKTREE_ROOT, branch: BRANCH, isMain: false },
      }),
    );
    db.prepare(`
      INSERT INTO session_files (session_id, file_path, claimed_at, released_at, agent_node_id)
      VALUES (?, 'lib/admission.ts', ?, NULL, NULL)
    `).run(SESSION_ID, Date.parse('2026-08-31T19:05:00.000Z'));
    createClaimForest(db).claim({
      repoId: 'port-daddy',
      world: { kind: 'worktree', id: WORKTREE_ID },
      selector: { kind: 'file', path: 'lib/admission.ts' },
    }, {
      sessionId: SESSION_ID,
      agentId: BODY_ID,
      agentNodeId: null,
      observedBy: 'test',
    });
  });

  afterEach(() => closeDatabase(db));

  test('atomically appends one AgentRun and binds session plus claims to the same AgentNode', async () => {
    let firstAdmission: ReturnType<typeof admission.admitPromotedSession> | null = null;
    const created = await roster.create(promotionInput(), {
      verifiedPromotion: true,
      onNodeAppended: (agent) => {
        firstAdmission = admission.admitPromotedSession({
          agentNodeId: agent.agentNodeId,
          sourceSessionId: SESSION_ID,
          authorizedActorId: ACTOR_ID,
          authorizedHarbor: HARBOR,
          expectedSourceAgentId: BODY_ID,
          expectedSourceAdapter: 'codex-cli',
        });
      },
    });

    expect(firstAdmission).toMatchObject({
      agentNodeId: created.agent.agentNodeId,
      sourceSessionId: SESSION_ID,
      sourceAgentId: BODY_ID,
      worktreeId: WORKTREE_ID,
      branch: BRANCH,
      replayed: false,
    });
    const event = db.prepare(`
      SELECT agent_node_id, session_id, run_id, payload_json
      FROM harbor_events WHERE stream_type = 'agent-run' AND session_id = ?
    `).get(SESSION_ID) as {
      agent_node_id: string;
      session_id: string;
      run_id: string;
      payload_json: string;
    };
    expect(event.agent_node_id).toBe(created.agent.agentNodeId);
    expect(event.session_id).toBe(SESSION_ID);
    expect(JSON.parse(event.payload_json)).toMatchObject({
      schema: 'pd.agent-harbor.agent-run.v0',
      runId: event.run_id,
      agentNodeId: created.agent.agentNodeId,
      sessionId: SESSION_ID,
      bodyId: BODY_ID,
      workspace: { worktree: WORKTREE_ROOT, branch: BRANCH },
      admission: {
        kind: 'verified-session-promotion',
        authorizedActorId: ACTOR_ID,
        harbor: HARBOR,
      },
    });
    expect(db.prepare('SELECT agent_node_id FROM sessions WHERE id = ?').get(SESSION_ID))
      .toEqual({ agent_node_id: created.agent.agentNodeId });
    expect(db.prepare('SELECT DISTINCT agent_node_id FROM session_files WHERE session_id = ?').all(SESSION_ID))
      .toEqual([{ agent_node_id: created.agent.agentNodeId }]);
    expect(db.prepare('SELECT DISTINCT agent_node_id FROM claim_forest_claims WHERE session_id = ?').all(SESSION_ID))
      .toEqual([{ agent_node_id: created.agent.agentNodeId }]);

    const replay = admission.admitPromotedSession({
      agentNodeId: created.agent.agentNodeId,
      sourceSessionId: SESSION_ID,
      authorizedActorId: ACTOR_ID,
      authorizedHarbor: HARBOR,
      expectedSourceAgentId: BODY_ID,
      expectedSourceAdapter: 'codex-cli',
    });
    expect(replay.replayed).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS count FROM harbor_events WHERE stream_type = 'agent-run'").get())
      .toEqual({ count: 1 });
  });

  test('rejects a different actor before minting an AgentNode or touching claims', async () => {
    const before = db.prepare('SELECT agent_node_id FROM session_files WHERE session_id = ?').all(SESSION_ID);
    expect(() => admission.preflightPromotedSession({
      sourceSessionId: SESSION_ID,
      authorizedActorId: '01ATTACKER00000000000000000',
      authorizedHarbor: HARBOR,
      expectedSourceAgentId: BODY_ID,
      expectedSourceAdapter: 'codex-cli',
    })).toThrow(AgentRunAdmissionError);
    try {
      admission.preflightPromotedSession({
        sourceSessionId: SESSION_ID,
        authorizedActorId: '01ATTACKER00000000000000000',
        authorizedHarbor: HARBOR,
        expectedSourceAgentId: BODY_ID,
        expectedSourceAdapter: 'codex-cli',
      });
    } catch (error) {
      expect(error).toMatchObject({ code: 'ADMISSION_IDENTITY_MISMATCH', statusCode: 403 });
    }
    expect(roster.list()).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM harbor_events WHERE stream_type = 'agent-run'").get())
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT agent_node_id FROM session_files WHERE session_id = ?').all(SESSION_ID)).toEqual(before);
  });

  test('rolls back the AgentNode fact when the in-transaction admission hook fails', async () => {
    await expect(roster.create(promotionInput(), {
      verifiedPromotion: true,
      onNodeAppended: () => {
        throw new AgentRunAdmissionError('forced admission failure', 'ADMISSION_EVENT_CONFLICT', 409);
      },
    })).rejects.toMatchObject({ code: 'ADMISSION_EVENT_CONFLICT' });

    expect(roster.list()).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM harbor_events WHERE stream_type IN ('agent-node','agent-run')").get())
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT agent_node_id FROM sessions WHERE id = ?').get(SESSION_ID))
      .toEqual({ agent_node_id: null });
  });

  test('fails closed when the live branch drifts from the session witness', () => {
    const drifting = createAgentRunAdmissionService(db, {
      getAgentNode: (agentNodeId) => roster.get(agentNodeId),
      probeWorktree: () => ({
        id: WORKTREE_ID,
        root: WORKTREE_ROOT,
        name: 'port-daddy-admission',
        branch: 'agent/different-branch',
        isMain: false,
        commonDir: '/Users/operator/coding/port-daddy/.git',
      }),
      captureWorkspace: () => WORKSPACE,
    });
    expect(() => drifting.preflightPromotedSession({
      sourceSessionId: SESSION_ID,
      authorizedActorId: ACTOR_ID,
      authorizedHarbor: HARBOR,
      expectedSourceAgentId: BODY_ID,
      expectedSourceAdapter: 'codex-cli',
    })).toThrow(expect.objectContaining({ code: 'ADMISSION_WORKTREE_MISMATCH' }));
  });
});
