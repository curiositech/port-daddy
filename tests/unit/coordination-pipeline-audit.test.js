/**
 * Unit tests for the deterministic side of coxswain's
 * coordination-pipeline audit. Covers each trigger in isolation with
 * synthetic deps so we can pin down threshold + cooldown-key behavior
 * without standing up a daemon.
 *
 * The judge layer (LLM yes/no on borderline cases) is not exercised
 * here — it lands in C3 with its own mock-LLM tests.
 */
import { describe, expect, test } from '@jest/globals';
import {
  createCoordinationPipelineAudit,
  DEFAULT_CHANNEL_NAMING_PATTERN,
  DEFAULT_TUPLE_KEY_PATTERN,
} from '../../lib/coordination-pipeline-audit.js';

function makeDeps(overrides = {}) {
  return {
    listChannels: () => [],
    subscriberCount: () => 0,
    listAgents: () => [],
    log: () => {},
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

describe('coordination-pipeline-audit — subscription_coverage', () => {
  test('flags a channel with publish count above floor and zero subscribers', async () => {
    const audit = createCoordinationPipelineAudit(makeDeps({
      listChannels: () => [
        { channel: 'auth:rewrite', count: 12, lastMessage: 1_700_000_000_000 - 30_000 },
      ],
      subscriberCount: () => 0,
    }));
    const issues = await audit.auditOnce();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: 'subscription_coverage',
      templateName: 'channel.shouts-into-void',
      needsJudge: false,
      target: { actor: 'coxswain' },
    });
    expect(issues[0].evidence).toMatchObject({ channel: 'auth:rewrite', publishCount: 12, subscriberCount: 0 });
  });

  test('does not flag a channel with publishes but subscribers present', async () => {
    const audit = createCoordinationPipelineAudit(makeDeps({
      listChannels: () => [{ channel: 'auth:rewrite', count: 12, lastMessage: 1_700_000_000_000 }],
      subscriberCount: () => 3,
    }));
    expect(await audit.auditOnce()).toEqual([]);
  });

  test('respects subscriptionCoverageMinPublishes — channels below floor are exempt', async () => {
    const audit = createCoordinationPipelineAudit(
      makeDeps({
        listChannels: () => [{ channel: 'auth:rewrite', count: 2, lastMessage: 1_700_000_000_000 }],
      }),
      { subscriptionCoverageMinPublishes: 5 },
    );
    expect(await audit.auditOnce()).toEqual([]);
  });

  test('respects subscriptionCoverageWindowMs — stale channels are exempt', async () => {
    const audit = createCoordinationPipelineAudit(
      makeDeps({
        listChannels: () => [{ channel: 'auth:rewrite', count: 12, lastMessage: 1_700_000_000_000 - 7_200_000 }],
      }),
      { subscriptionCoverageWindowMs: 60 * 60 * 1000 },
    );
    expect(await audit.auditOnce()).toEqual([]);
  });
});

describe('coordination-pipeline-audit — channel_naming', () => {
  test('flags a declared channel that does not match `<scope>:<topic>` pattern', async () => {
    const audit = createCoordinationPipelineAudit(makeDeps({
      listChannels: () => [{ channel: 'rawname', count: 1, lastMessage: null }],
    }));
    const issues = await audit.auditOnce();
    expect(issues.some(i => i.kind === 'channel_naming' && i.evidence.channel === 'rawname')).toBe(true);
    const naming = issues.find(i => i.kind === 'channel_naming');
    // Cartographer owns naming convention, not the agent.
    expect(naming.target.actor).toBe('cartographer');
    expect(naming.needsJudge).toBe(false);
  });

  test('does not flag valid `<scope>:<topic>` channel names', async () => {
    const audit = createCoordinationPipelineAudit(makeDeps({
      listChannels: () => [
        { channel: 'auth:rewrite', count: 1, lastMessage: null },
        { channel: 'fleet:cartographer:roadmap', count: 1, lastMessage: null },
      ],
      subscriberCount: () => 1, // exempt from subscription_coverage
    }));
    const issues = (await audit.auditOnce()).filter(i => i.kind === 'channel_naming');
    expect(issues).toEqual([]);
  });

  test('skips wildcard subscriptions (channels with `*`) — those are not declared channels', async () => {
    const audit = createCoordinationPipelineAudit(makeDeps({
      listChannels: () => [{ channel: 'fleet:*', count: 1, lastMessage: null }],
    }));
    const issues = (await audit.auditOnce()).filter(i => i.kind === 'channel_naming');
    expect(issues).toEqual([]);
  });
});

describe('coordination-pipeline-audit — tuple_naming', () => {
  test('flags a tuple key that does not match `<noun>/<noun>` shape', async () => {
    const audit = createCoordinationPipelineAudit(makeDeps({
      listTupleKeys: () => [
        { key: 'claim/files', cardinality: 5 },
        { key: 'malformed-key-no-slash', cardinality: 1 },
      ],
    }));
    const issues = (await audit.auditOnce()).filter(i => i.kind === 'tuple_naming');
    expect(issues).toHaveLength(1);
    expect(issues[0].evidence.key).toBe('malformed-key-no-slash');
    expect(issues[0].target.actor).toBe('cartographer');
  });

  test('skips tuple naming check entirely when listTupleKeys is not provided', async () => {
    const audit = createCoordinationPipelineAudit(makeDeps());
    const issues = (await audit.auditOnce()).filter(i => i.kind === 'tuple_naming');
    expect(issues).toEqual([]);
  });
});

describe('coordination-pipeline-audit — silent_agent', () => {
  const NOW = 1_700_000_000_000;

  test('flags an agent registered > min age with zero outbound activity (deterministic, beyond borderline)', async () => {
    const audit = createCoordinationPipelineAudit(makeDeps({
      listAgents: () => [{
        id: 'agent-stuck',
        registeredAt: NOW - 2 * 60 * 60 * 1000, // 2h ago
        lastHeartbeat: NOW - 30_000,
        outboundActivityCount: 0,
      }],
      now: () => NOW,
    }));
    const issues = (await audit.auditOnce()).filter(i => i.kind === 'silent_agent');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'warn', needsJudge: false });
    expect(issues[0].target.agentId).toBe('agent-stuck');
  });

  test('marks borderline silence (between min age and borderline max) as needsJudge=true', async () => {
    const audit = createCoordinationPipelineAudit(makeDeps({
      listAgents: () => [{
        id: 'agent-maybe-busy',
        registeredAt: NOW - 35 * 60 * 1000, // 35min, between min(30min) and borderline(60min)
        lastHeartbeat: NOW - 10_000,
        outboundActivityCount: 0,
      }],
      now: () => NOW,
    }));
    const issues = (await audit.auditOnce()).filter(i => i.kind === 'silent_agent');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'info', needsJudge: true });
  });

  test('does not flag agents younger than silentAgentMinAgeMs', async () => {
    const audit = createCoordinationPipelineAudit(makeDeps({
      listAgents: () => [{
        id: 'agent-fresh',
        registeredAt: NOW - 5 * 60 * 1000,
        lastHeartbeat: NOW - 10_000,
        outboundActivityCount: 0,
      }],
      now: () => NOW,
    }));
    expect((await audit.auditOnce()).filter(i => i.kind === 'silent_agent')).toEqual([]);
  });

  test('does not flag agents with outbound activity', async () => {
    const audit = createCoordinationPipelineAudit(makeDeps({
      listAgents: () => [{
        id: 'agent-active',
        registeredAt: NOW - 2 * 60 * 60 * 1000,
        lastHeartbeat: NOW - 10_000,
        outboundActivityCount: 42,
      }],
      now: () => NOW,
    }));
    expect((await audit.auditOnce()).filter(i => i.kind === 'silent_agent')).toEqual([]);
  });

  test('falls back to last_heartbeat <= registered_at when outbound count is unavailable', async () => {
    const audit = createCoordinationPipelineAudit(makeDeps({
      listAgents: () => [
        { id: 'agent-never-heartbeated', registeredAt: NOW - 2 * 60 * 60 * 1000, lastHeartbeat: NOW - 2 * 60 * 60 * 1000 },
        { id: 'agent-heartbeating-fine', registeredAt: NOW - 2 * 60 * 60 * 1000, lastHeartbeat: NOW - 10_000 },
      ],
      now: () => NOW,
    }));
    const flagged = (await audit.auditOnce()).filter(i => i.kind === 'silent_agent').map(i => i.target.agentId);
    expect(flagged).toEqual(['agent-never-heartbeated']);
  });
});

describe('coordination-pipeline-audit — channel_near_duplicate', () => {
  // Pre-built fake embedder: maps channel name to a simple bag-of-tokens
  // sparse vector (split on `:` and `-`). Cosine over that gives a usable
  // similarity signal for tests without pulling Transformers.js in.
  const VOCAB = ['auth', 'rewrite', 'authn', 'fleet', 'cartographer', 'roadmap', 'general', 'swarm', 'coordination'];
  function fakeEmbed(texts) {
    return Promise.resolve(texts.map(t => {
      const tokens = new Set(t.split(/[:\-]/));
      const v = VOCAB.map(w => tokens.has(w) ? 1 : 0);
      const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0)) || 1;
      return v.map(x => x / norm);
    }));
  }

  test('flags pair above sim threshold deterministically (needsJudge=false)', async () => {
    const audit = createCoordinationPipelineAudit(makeDeps({
      listChannels: () => [
        { channel: 'swarm:general', count: 1, lastMessage: null },
        { channel: 'general:swarm', count: 1, lastMessage: null },
      ],
      embed: fakeEmbed,
      subscriberCount: () => 1,
    }), { duplicateChannelSimThreshold: 0.5, duplicateChannelBorderlineLow: 0.3 });
    const issues = (await audit.auditOnce()).filter(i => i.kind === 'channel_near_duplicate');
    expect(issues).toHaveLength(1);
    expect(issues[0].needsJudge).toBe(false);
    expect(issues[0].evidence.channelA <= issues[0].evidence.channelB).toBe(true);
  });

  test('marks pair in borderline range with needsJudge=true', async () => {
    const audit = createCoordinationPipelineAudit(makeDeps({
      listChannels: () => [
        { channel: 'auth:rewrite', count: 1, lastMessage: null },
        { channel: 'auth:authn-rewrite', count: 1, lastMessage: null },
      ],
      embed: fakeEmbed,
      subscriberCount: () => 1,
    }), { duplicateChannelSimThreshold: 0.95, duplicateChannelBorderlineLow: 0.4 });
    const issues = (await audit.auditOnce()).filter(i => i.kind === 'channel_near_duplicate');
    expect(issues).toHaveLength(1);
    expect(issues[0].needsJudge).toBe(true);
    expect(issues[0].severity).toBe('info');
  });

  test('produces deterministic cooldownKey regardless of input order', async () => {
    const inputs = [
      ['swarm:general', 'general:swarm'],
      ['general:swarm', 'swarm:general'],
    ];
    const keys = [];
    for (const order of inputs) {
      const audit = createCoordinationPipelineAudit(makeDeps({
        listChannels: () => order.map(c => ({ channel: c, count: 1, lastMessage: null })),
        embed: fakeEmbed,
        subscriberCount: () => 1,
      }), { duplicateChannelSimThreshold: 0.5, duplicateChannelBorderlineLow: 0.3 });
      const [issue] = (await audit.auditOnce()).filter(i => i.kind === 'channel_near_duplicate');
      keys.push(issue?.cooldownKey);
    }
    expect(keys[0]).toBeDefined();
    expect(keys[0]).toBe(keys[1]);
  });

  test('skips when embed is not provided', async () => {
    const audit = createCoordinationPipelineAudit(makeDeps({
      listChannels: () => [
        { channel: 'a:x', count: 1, lastMessage: null },
        { channel: 'a:y', count: 1, lastMessage: null },
      ],
      subscriberCount: () => 1,
    }));
    expect((await audit.auditOnce()).filter(i => i.kind === 'channel_near_duplicate')).toEqual([]);
  });

  test('survives embed errors by skipping the check', async () => {
    const audit = createCoordinationPipelineAudit(makeDeps({
      listChannels: () => [
        { channel: 'a:x', count: 1, lastMessage: null },
        { channel: 'a:y', count: 1, lastMessage: null },
      ],
      embed: () => Promise.reject(new Error('embedder offline')),
      subscriberCount: () => 1,
    }));
    expect((await audit.auditOnce()).filter(i => i.kind === 'channel_near_duplicate')).toEqual([]);
  });
});

describe('coordination-pipeline-audit — defaults', () => {
  test('exported default channel naming pattern matches scoped names and rejects bare names', () => {
    expect(DEFAULT_CHANNEL_NAMING_PATTERN.test('auth:rewrite')).toBe(true);
    expect(DEFAULT_CHANNEL_NAMING_PATTERN.test('fleet:cartographer:roadmap')).toBe(true);
    expect(DEFAULT_CHANNEL_NAMING_PATTERN.test('rawname')).toBe(false);
    expect(DEFAULT_CHANNEL_NAMING_PATTERN.test('UPPERCASE:bad')).toBe(false);
  });

  test('exported default tuple key pattern matches `<noun>/<noun>`', () => {
    expect(DEFAULT_TUPLE_KEY_PATTERN.test('claim/files')).toBe(true);
    expect(DEFAULT_TUPLE_KEY_PATTERN.test('lock/holders')).toBe(true);
    expect(DEFAULT_TUPLE_KEY_PATTERN.test('claim')).toBe(false);
    expect(DEFAULT_TUPLE_KEY_PATTERN.test('claim/files/extra')).toBe(false);
  });
});
