/**
 * swarm_awareness output-cap tests.
 *
 * Regression target: a production swarm_awareness call returned 256K
 * characters across 5,792 lines and blew the harness's tool-result token cap.
 * These tests pin the two-stage fix — awareness-shaped digest + hard
 * serialized budget — so the tool can never overflow a caller's context
 * again, regardless of roster size or any single pathological agent.
 */
import {
  digestSwarmRoster,
  serializeSwarmDigest,
  serializeLegacySwarmSnapshot,
} from '../../lib/swarm-awareness-digest.js';

/** A roster item shaped like the real /agent-roster payload, deliberately heavy. */
function heavyAgent(i: number, opts?: { claims?: number; notes?: number; heartbeat?: number; liveness?: string }) {
  const claims = opts?.claims ?? 120;
  const notes = opts?.notes ?? 15;
  return {
    id: `agent-${i}`,
    label: `Agent ${i}`,
    purpose: 'Refactor the flux capacitor end to end',
    identity: `port-daddy:mcp:agent-${i}`,
    project: 'port-daddy',
    status: 'active',
    liveness: opts?.liveness ?? 'alive',
    lastHeartbeat: opts?.heartbeat ?? 1_000_000 + i,
    harness: { id: 'claude', label: 'Claude Code', backend: 'claude', model: 'claude-opus-5', confidence: 'explicit' },
    squid: {
      schemaVersion: 1,
      level: 'PARTIAL',
      score: 48,
      projectRoot: `/Users/example/worktrees/agent-${i}`,
      providers: Array.from({ length: 4 }, (_, p) => ({
        name: `Provider ${p}`,
        slug: `prov-${p}`,
        detected: true,
        configPath: `/Users/example/.prov-${p}/config.toml`,
        missingTentacles: ['pd-hook-prompt', 'pd-hook-pre-tool', 'pd-hook-post-tool'],
      })),
    },
    worktree: { id: `wt-${i}`, root: `/Users/example/worktrees/agent-${i}`, branch: `feature/agent-${i}`, name: `agent-${i}`, isMain: false },
    activeSession: {
      id: `session-${i}`,
      purpose: 'Do the work',
      phase: 'implementing',
      updatedAt: 1_000_000 + i,
      metadata: { big: 'x'.repeat(500) },
      notes: Array.from({ length: notes }, (_, n) => ({
        id: `note-${i}-${n}`,
        content: `Note ${n}: ` + 'coordination detail '.repeat(30),
        createdAt: n,
      })),
    },
    sessions: [],
    touchedFiles: Array.from({ length: claims }, (_, c) => ({
      filePath: `src/deeply/nested/path/segment/${i}/file-${c}.ts`,
      sessionId: `session-${i}`,
      purpose: 'edit',
      claimedAt: c,
      startLine: 1,
      endLine: 400,
    })),
    control: {
      steeringChannel: `pd tube agent-${i}`,
      streamUrl: `http://127.0.0.1:9876/agents/agent-${i}/stream`,
      interruptUrl: `http://127.0.0.1:9876/agents/agent-${i}/interrupt`,
      takeoverUrl: `http://127.0.0.1:9876/agents/agent-${i}/takeover`,
      controlCenterUrl: `http://127.0.0.1:9876/control-center#agent-${i}`,
    },
  };
}

function heavyRoster(agentCount: number) {
  return {
    success: true,
    generatedAt: 1_000_000,
    project: 'port-daddy',
    count: agentCount,
    squidSummary: { LIVE: 1, PARTIAL: agentCount - 1, UNPROTECTED: 0 },
    agents: Array.from({ length: agentCount }, (_, i) => heavyAgent(i)),
  };
}

describe('digestSwarmRoster', () => {
  test('keeps awareness fields and collapses the heavy ones', () => {
    const digest = digestSwarmRoster(heavyRoster(3));
    expect(digest.totalAgents).toBe(3);
    expect(digest.omittedAgents).toBe(0);
    const agent = digest.agents[0];
    expect(agent.identity).toMatch(/^port-daddy:mcp:agent-/);
    expect(agent.purpose).toBe('Refactor the flux capacitor end to end');
    expect(agent.harness).toEqual({ label: 'Claude Code', backend: 'claude', model: 'claude-opus-5' });
    // Squid collapses to level+score — no provider matrices, no config paths.
    expect(agent.squid).toEqual({ level: 'PARTIAL', score: 48 });
    expect(JSON.stringify(agent)).not.toContain('missingTentacles');
    expect(JSON.stringify(agent)).not.toContain('configPath');
    // Control collapses to the steering channel — no URL boilerplate.
    expect(agent.steeringChannel).toMatch(/^pd tube /);
    expect(JSON.stringify(agent)).not.toContain('controlCenterUrl');
  });

  test('collapses notes to a count plus one truncated latest note', () => {
    const digest = digestSwarmRoster(heavyRoster(1));
    const session = digest.agents[0].session;
    expect(session).not.toBeNull();
    expect(session!.noteCount).toBe(15);
    expect(session!.latestNote).toContain('Note 14:');
    expect(session!.latestNote!.length).toBeLessThanOrEqual(240 + '… [truncated]'.length);
  });

  test('caps claimed files per agent with an explicit omission counter', () => {
    const digest = digestSwarmRoster(heavyRoster(1));
    const agent = digest.agents[0];
    expect(agent.claimedFiles).toHaveLength(8);
    expect(agent.omittedClaims).toBe(120 - 8);
  });

  test('caps the agent list with an explicit omission counter', () => {
    const digest = digestSwarmRoster(heavyRoster(40));
    expect(digest.totalAgents).toBe(40);
    expect(digest.agents).toHaveLength(25);
    expect(digest.omittedAgents).toBe(15);
  });

  test('orders agents most-alive-first so tail-dropping sheds the least relevant', () => {
    const roster = {
      agents: [
        heavyAgent(0, { liveness: 'dead', heartbeat: 999 }),
        heavyAgent(1, { liveness: 'alive', heartbeat: 100 }),
        heavyAgent(2, { liveness: 'alive', heartbeat: 200 }),
        heavyAgent(3, { liveness: 'stale', heartbeat: 500 }),
      ],
    };
    const digest = digestSwarmRoster(roster);
    expect(digest.agents.map((a) => a.id)).toEqual(['agent-2', 'agent-1', 'agent-3', 'agent-0']);
  });
});

describe('serializeSwarmDigest', () => {
  test('regression: a 17-agent heavy roster serializes far under the historical 256K blowup', () => {
    const out = serializeSwarmDigest(heavyRoster(17));
    expect(out.length).toBeLessThanOrEqual(30_000);
    expect(JSON.parse(out).success).toBe(true);
  });

  test('holds the hard budget for any roster size', () => {
    const out = serializeSwarmDigest(heavyRoster(250));
    expect(out.length).toBeLessThanOrEqual(30_000);
    const parsed = JSON.parse(out);
    expect(parsed.totalAgents).toBe(250);
    expect(parsed.agents.length + parsed.omittedAgents).toBe(250);
  });

  test('emits compact JSON, never pretty-printed', () => {
    const out = serializeSwarmDigest(heavyRoster(2));
    expect(out).not.toContain('\n');
  });

  test('drops tail agents (never the freshest) when a tight budget forces it', () => {
    const out = serializeSwarmDigest(heavyRoster(10), { maxOutputChars: 3_000 });
    expect(out.length).toBeLessThanOrEqual(3_000);
    const parsed = JSON.parse(out);
    expect(parsed.omittedAgents).toBeGreaterThan(0);
    if (parsed.agents.length > 0) {
      // Freshest heartbeat (agent-9) survives; the tail went first.
      expect(parsed.agents[0].id).toBe('agent-9');
    }
  });

  test('tolerates malformed roster payloads without throwing', () => {
    for (const bad of [null, undefined, 42, 'nope', { agents: 'not-an-array' }, { agents: [null, 7, 'x'] }]) {
      const parsed = JSON.parse(serializeSwarmDigest(bad));
      expect(parsed.success).toBe(true);
      expect(Array.isArray(parsed.agents)).toBe(true);
    }
  });
});

describe('serializeLegacySwarmSnapshot', () => {
  test('caps every list and reports omissions', () => {
    const out = serializeLegacySwarmSnapshot({
      agents: Array.from({ length: 100 }, (_, i) => ({ id: `a-${i}`, identity: 'p:s:c', purpose: 'work', status: 'active', lastHeartbeat: i })),
      sessions: Array.from({ length: 60 }, (_, i) => ({
        id: `s-${i}`,
        purpose: 'work',
        notes: Array.from({ length: 20 }, (_, n) => ({ content: `note ${n} ` + 'z'.repeat(400) })),
      })),
      claims: Array.from({ length: 2_000 }, (_, i) => ({ filePath: `src/f-${i}.ts` })),
      deadAgents: Array.from({ length: 80 }, (_, i) => ({ id: `d-${i}` })),
    });
    expect(out.length).toBeLessThanOrEqual(30_000);
    const parsed = JSON.parse(out);
    expect(parsed.active_agents).toHaveLength(25);
    expect(parsed.omitted_agents).toBe(75);
    expect(parsed.omitted_file_claims).toBeGreaterThan(0);
    expect(parsed.sessions[0].noteCount).toBe(20);
    expect(parsed.sessions[0].latestNote).toContain('note 19');
  });

  test('handles empty inputs', () => {
    const parsed = JSON.parse(serializeLegacySwarmSnapshot({}));
    expect(parsed.active_agents).toEqual([]);
    expect(parsed.omitted_agents).toBe(0);
  });
});
