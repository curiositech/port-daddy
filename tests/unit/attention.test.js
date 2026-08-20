/**
 * Attention composer tests
 *
 * Verifies: inbox-only happy path, channel-subscription cursor advance, peek vs
 * mark-read semantics, and subscription persistence.
 */

import { createTestDb } from '../setup-unit.js';
import { jest } from '@jest/globals';
import { createAgentInbox } from '../../lib/agent-inbox.js';
import { createMessaging } from '../../lib/messaging.js';
import { createAttention } from '../../lib/attention.js';
import { createTupleSpace } from '../../lib/tuples.js';
import { createParley } from '../../lib/parley.js';
import {
  rankAttentionSuggestions,
  renderAttentionLinework,
  handleAttention,
  unboundAttentionSummary,
} from '../../cli/commands/attention.js';

function setup() {
  const db = createTestDb();
  const inbox = createAgentInbox(db);
  const messaging = createMessaging(db);
  const attention = createAttention({ db, inbox, messaging });
  return { db, inbox, messaging, attention };
}

describe('attention.compose', () => {
  test('pre-session attention is an explicit successful empty state', () => {
    expect(unboundAttentionSummary(true, 1234)).toEqual({
      success: true,
      bound: false,
      items: [],
      counts: { total: 0, inbox: 0, channels: 0, inboxUnreadRemaining: 0 },
      subscriptions: [],
      suggestions: [],
      peek: true,
      generatedAt: 1234,
    });
  });

  test('pre-session human output is explicit and requires no daemon request', async () => {
    const priorAgentId = process.env.PD_AGENT_ID;
    const priorSessionId = process.env.PD_SESSION_ID;
    const priorContextDir = process.env.PORT_DADDY_CONTEXT_DIR;
    delete process.env.PD_AGENT_ID;
    delete process.env.PD_SESSION_ID;
    process.env.PORT_DADDY_CONTEXT_DIR = `${process.cwd()}/.portdaddy-test-unbound-human-${process.pid}-${Date.now()}`;

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await handleAttention({});
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith('Attention clear (no active agent session).');
    } finally {
      logSpy.mockRestore();
      if (priorAgentId === undefined) delete process.env.PD_AGENT_ID;
      else process.env.PD_AGENT_ID = priorAgentId;
      if (priorSessionId === undefined) delete process.env.PD_SESSION_ID;
      else process.env.PD_SESSION_ID = priorSessionId;
      if (priorContextDir === undefined) delete process.env.PORT_DADDY_CONTEXT_DIR;
      else process.env.PORT_DADDY_CONTEXT_DIR = priorContextDir;
    }
  });

  test('pre-session subscription mutation fails clearly before any daemon request', async () => {
    const priorAgentId = process.env.PD_AGENT_ID;
    const priorSessionId = process.env.PD_SESSION_ID;
    const priorContextDir = process.env.PORT_DADDY_CONTEXT_DIR;
    delete process.env.PD_AGENT_ID;
    delete process.env.PD_SESSION_ID;
    process.env.PORT_DADDY_CONTEXT_DIR = `${process.cwd()}/.portdaddy-test-unbound-${process.pid}-${Date.now()}`;

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`EXIT:${code}`);
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(handleAttention({ subscribe: 'coordination:inconsistency' }))
        .rejects.toThrow('EXIT:2');
      expect(errorSpy).toHaveBeenCalledWith(
        'ERROR: This attention operation needs an agent identity. Start a session or pass --agent <id>.',
      );
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
      if (priorAgentId === undefined) delete process.env.PD_AGENT_ID;
      else process.env.PD_AGENT_ID = priorAgentId;
      if (priorSessionId === undefined) delete process.env.PD_SESSION_ID;
      else process.env.PD_SESSION_ID = priorSessionId;
      if (priorContextDir === undefined) delete process.env.PORT_DADDY_CONTEXT_DIR;
      else process.env.PORT_DADDY_CONTEXT_DIR = priorContextDir;
    }
  });

  test('malformed subscription names fail locally before any daemon request', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`EXIT:${code}`);
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(handleAttention({ agent: 'agent-x', subscribe: 'bad channel/name' }))
        .rejects.toThrow('EXIT:2');
      expect(errorSpy).toHaveBeenCalledWith('ERROR: channel contains invalid characters');
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test('empty attention recommends concrete, ranked watches instead of a channel placeholder', () => {
    const suggestions = rankAttentionSuggestions([
      {
        logicalName: 'fleet:events',
        physicalName: 'fleet:events',
        description: null,
        scope: 'global',
        activeCount: 22,
        lastMessage: Date.now(),
        active: true,
        source: 'observed',
      },
      {
        logicalName: 'review:verdict',
        physicalName: 'wt:repo:worktree:review:verdict',
        description: 'Reviewer verdicts for this worktree.',
        scope: 'worktree',
        activeCount: 3,
        lastMessage: Date.now(),
        active: true,
        source: 'declared',
      },
      {
        logicalName: 'inbox:someone-else',
        physicalName: 'inbox:someone-else',
        description: null,
        scope: 'global',
        activeCount: 99,
        lastMessage: Date.now(),
        active: true,
        source: 'observed',
      },
    ]);

    expect(suggestions.map((entry) => entry.channel)).toEqual([
      'coordination:inconsistency',
      'fleet:events',
      'review:verdict',
    ]);
    expect(suggestions[0].command).toBe('pd attention --subscribe coordination:inconsistency');
    expect(suggestions.some((entry) => entry.channel.startsWith('inbox:'))).toBe(false);

    const rendered = renderAttentionLinework({
      success: true,
      agentId: 'agent-x',
      items: [],
      counts: { total: 0, inbox: 0, channels: 0, inboxUnreadRemaining: 0 },
      subscriptions: [],
      suggestions,
    });
    expect(rendered).toContain('watch coordination:inconsistency');
    expect(rendered).toContain('pd attention --subscribe-recommended');
    expect(rendered).not.toContain('<channel>');
  });

  test('already subscribed physical channels are not suggested again', () => {
    const suggestions = rankAttentionSuggestions([
      {
        logicalName: 'review:verdict',
        physicalName: 'wt:repo:worktree:review:verdict',
        description: 'Reviewer verdicts.',
        scope: 'worktree',
        activeCount: 3,
        lastMessage: Date.now(),
        active: true,
        source: 'declared',
      },
    ], ['wt:repo:worktree:coordination:inconsistency', 'wt:repo:worktree:review:verdict']);

    expect(suggestions).toEqual([]);
  });

  test('linework renders every item that compose marks read', () => {
    const now = Date.now();
    const items = Array.from({ length: 50 }, (_, index) => ({
      source: 'inbox',
      id: `inbox:${index + 1}`,
      agentId: 'agent-x',
      from: 'agent-y',
      channel: null,
      type: 'note',
      content: `message-${index + 1}`,
      contentType: 'text',
      receivedAt: now - index,
    }));
    const rendered = renderAttentionLinework({
      success: true,
      agentId: 'agent-x',
      items,
      counts: { total: 50, inbox: 50, channels: 0, inboxUnreadRemaining: 0 },
    });

    expect(rendered).toContain('message-1');
    expect(rendered).toContain('message-13');
    expect(rendered).toContain('message-50');
    expect((rendered.match(/message-/g) || [])).toHaveLength(50);
  });

  test('empty inbox + no subscriptions → zero items', () => {
    const { attention } = setup();
    const result = attention.compose('agent-x');
    expect(result.success).toBe(true);
    expect(result.agentId).toBe('agent-x');
    expect(result.items).toEqual([]);
    expect(result.counts).toEqual({ total: 0, inbox: 0, channels: 0, inboxUnreadRemaining: 0 });
    expect(result.subscriptions).toEqual([]);
    expect(result.peek).toBe(false);
  });

  test('inbox messages addressed to agent surface with source=inbox and mark read', () => {
    const { attention, inbox } = setup();
    inbox.send('agent-x', 'hello-1', { from: 'agent-a' });
    inbox.send('agent-x', 'hello-2', { from: 'agent-b' });

    const first = attention.compose('agent-x');
    expect(first.counts.inbox).toBe(2);
    expect(first.items.length).toBe(2);
    expect(first.items.every((i) => i.source === 'inbox')).toBe(true);
    expect(first.items.every((i) => i.agentId === 'agent-x')).toBe(true);
    expect(first.items.every((i) => i.id.startsWith('inbox:'))).toBe(true);

    // Mark-read side effect: next call returns nothing
    const second = attention.compose('agent-x');
    expect(second.counts.inbox).toBe(0);
    expect(second.items).toEqual([]);
  });

  test('parley summons are delivered through inbox and surface in attention', () => {
    const { db, attention, inbox } = setup();
    const tuples = createTupleSpace(db);
    const parley = createParley({ tuples, agentInbox: inbox, now: () => 1_700_000_000_000 });

    const opened = parley.call({
      surface: 'lib/sessions.ts',
      reason: 'overlapping ownership',
      parties: ['agent-x', 'agent-y'],
      calledBy: 'operator',
    });

    const result = attention.compose('agent-x', { peek: true });
    expect(result.counts.inbox).toBe(1);
    expect(result.items[0]).toMatchObject({
      source: 'inbox',
      agentId: 'agent-x',
      from: 'operator',
      type: 'parley_summons',
      contentType: 'json',
    });
    expect(result.items[0].content).toMatchObject({
      kind: 'parley_summons',
      parleyId: opened.parleyId,
      surface: 'lib/sessions.ts',
      channel: `parley:${opened.parleyId}`,
    });
  });

  test('parley turns are fanned out through inbox and surface in attention', () => {
    const { db, attention, inbox } = setup();
    const tuples = createTupleSpace(db);
    const parley = createParley({ tuples, agentInbox: inbox, now: () => 1_700_000_000_000 });

    const opened = parley.call({
      surface: 'lib/sessions.ts',
      reason: 'overlapping ownership',
      parties: ['agent-x', 'agent-y'],
      calledBy: 'operator',
    });
    // Drain the summons so only the turn remains.
    attention.compose('agent-x');

    parley.respond({
      parleyId: opened.parleyId,
      party: 'agent-y',
      performative: 'propose',
      content: 'take sessions.ts, cede locks.ts',
    });

    const result = attention.compose('agent-x', { peek: true });
    expect(result.counts.inbox).toBe(1);
    expect(result.items[0]).toMatchObject({
      source: 'inbox',
      agentId: 'agent-x',
      from: 'agent-y',
      type: 'parley_turn',
      contentType: 'json',
    });
    expect(result.items[0].content).toMatchObject({
      kind: 'parley_turn',
      parleyId: opened.parleyId,
      party: 'agent-y',
      performative: 'propose',
      content: 'take sessions.ts, cede locks.ts',
    });
  });

  test('peek does NOT mark inbox read', () => {
    const { attention, inbox } = setup();
    inbox.send('agent-x', 'hello', { from: 'agent-a' });

    const peeked = attention.compose('agent-x', { peek: true });
    expect(peeked.peek).toBe(true);
    expect(peeked.counts.inbox).toBe(1);

    const followup = attention.compose('agent-x');
    expect(followup.counts.inbox).toBe(1);  // still unread
  });

  test('subscribed channels return new messages and advance cursor', () => {
    const { attention, messaging } = setup();
    attention.subscribe('agent-x', 'coordination:inconsistency');

    const ch = 'coordination:inconsistency';
    messaging.publish(ch, { kind: 'symbol-conflict', detail: 'foo.ts:42' }, { sender: 'cartographer' });
    messaging.publish(ch, { kind: 'lock-stale', detail: 'release-publish' }, { sender: 'coxswain' });

    const first = attention.compose('agent-x');
    expect(first.counts.channels).toBe(2);
    expect(first.items.length).toBe(2);
    expect(first.items.some((i) => i.source === 'channel' && i.channel === ch)).toBe(true);
    expect(first.subscriptions).toEqual([ch]);

    // Second call: cursor advanced, nothing new
    const second = attention.compose('agent-x');
    expect(second.counts.channels).toBe(0);

    // New message after cursor: surfaces on third call
    messaging.publish(ch, { kind: 'fresh' }, { sender: 'spider' });
    const third = attention.compose('agent-x');
    expect(third.counts.channels).toBe(1);
    expect(third.items[0].channel).toBe(ch);
  });

  test('subscribe snapshots channel state: history NOT replayed to new subscribers', () => {
    const { attention, messaging } = setup();
    // Publish to a channel BEFORE anyone subscribes
    for (let i = 0; i < 5; i += 1) {
      messaging.publish('long-running:channel', `pre-existing-${i}`, { sender: 'historical' });
    }

    // New subscriber should NOT see the 5 prior messages
    const subResult = attention.subscribe('agent-newcomer', 'long-running:channel');
    expect(subResult.cursor).toBeGreaterThan(0);  // snapshot took the max id

    const first = attention.compose('agent-newcomer');
    expect(first.counts.channels).toBe(0);

    // Future messages DO surface
    messaging.publish('long-running:channel', 'post-subscribe', { sender: 'fresh' });
    const second = attention.compose('agent-newcomer');
    expect(second.counts.channels).toBe(1);
    expect(second.items[0].content).toBe('post-subscribe');
  });

  test('peek leaves channel cursor in place', () => {
    const { attention, messaging } = setup();
    attention.subscribe('agent-x', 'broadcast');
    messaging.publish('broadcast', 'first', { sender: 'a' });

    const peeked = attention.compose('agent-x', { peek: true });
    expect(peeked.counts.channels).toBe(1);

    const followup = attention.compose('agent-x', { peek: true });
    expect(followup.counts.channels).toBe(1);  // cursor unchanged, same message
  });

  test('inbox + channel items are sorted newest-first', () => {
    const { attention, inbox, messaging } = setup();
    attention.subscribe('agent-x', 'broadcast');

    inbox.send('agent-x', 'old-inbox', { from: 'a' });
    // Pause so subsequent timestamps differ
    const before = Date.now();
    while (Date.now() === before) { /* spin until clock ticks */ }
    messaging.publish('broadcast', 'newer-channel', { sender: 'b' });

    const result = attention.compose('agent-x');
    expect(result.items.length).toBe(2);
    expect(result.items[0].receivedAt).toBeGreaterThanOrEqual(result.items[1].receivedAt);
    expect(result.items[0].source).toBe('channel');
    expect(result.items[1].source).toBe('inbox');
  });

  test('inboxUnreadRemaining reports overflow beyond limit', () => {
    const { attention, inbox } = setup();
    for (let i = 0; i < 5; i += 1) {
      inbox.send('agent-x', `msg-${i}`, { from: 'sender' });
    }

    const result = attention.compose('agent-x', { limit: 3 });
    expect(result.counts.inbox).toBe(3);
    expect(result.counts.inboxUnreadRemaining).toBe(2);
  });
});

describe('attention.subscribe / unsubscribe / listSubscriptions', () => {
  test('subscribe is idempotent and listSubscriptions reflects state', () => {
    const { attention } = setup();
    expect(attention.subscribe('agent-x', 'ch1').subscribed).toBe(true);
    expect(attention.subscribe('agent-x', 'ch1').subscribed).toBe(false);
    expect(attention.subscribe('agent-x', 'ch2').subscribed).toBe(true);

    expect(attention.listSubscriptions('agent-x')).toEqual(['ch1', 'ch2']);
  });

  test('unsubscribe removes only the named channel', () => {
    const { attention } = setup();
    attention.subscribe('agent-x', 'ch1');
    attention.subscribe('agent-x', 'ch2');

    const removed = attention.unsubscribe('agent-x', 'ch1');
    expect(removed.success).toBe(true);
    expect(removed.removed).toBe(true);
    expect(attention.listSubscriptions('agent-x')).toEqual(['ch2']);

    // Idempotent on already-removed
    const repeat = attention.unsubscribe('agent-x', 'ch1');
    expect(repeat.success).toBe(true);
    expect(repeat.removed).toBe(false);
  });

  test('subscriptions are scoped per agent', () => {
    const { attention } = setup();
    attention.subscribe('agent-x', 'shared-channel');
    attention.subscribe('agent-y', 'shared-channel');

    expect(attention.listSubscriptions('agent-x')).toEqual(['shared-channel']);
    expect(attention.listSubscriptions('agent-y')).toEqual(['shared-channel']);

    attention.unsubscribe('agent-x', 'shared-channel');
    expect(attention.listSubscriptions('agent-x')).toEqual([]);
    expect(attention.listSubscriptions('agent-y')).toEqual(['shared-channel']);
  });

  test('subscribe rejects empty agentId or channel', () => {
    const { attention } = setup();
    expect(attention.subscribe('', 'ch').success).toBe(false);
    expect(attention.subscribe('agent-x', '').success).toBe(false);
    expect(attention.subscribe('agent-x', '   ').success).toBe(false);
  });

  test('subscribe and unsubscribe reject malformed channel names', () => {
    const { attention } = setup();
    expect(attention.subscribe('agent-x', 'bad channel/name')).toEqual({
      success: false,
      error: 'channel contains invalid characters',
    });
    expect(attention.unsubscribe('agent-x', 'bad channel/name')).toEqual({
      success: false,
      error: 'channel contains invalid characters',
    });
    expect(attention.listSubscriptions('agent-x')).toEqual([]);
  });
});
