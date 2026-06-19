#!/usr/bin/env bun
/**
 * "Two agents, arguing productively" — a builder agent and a reviewer agent
 * hold an actual conversation over one tube channel: handoff, pushback,
 * revision, approval. Each `--reply` auto-correlates to the most recent
 * foreign event, so neither agent needs message IDs, sockets, or a human
 * relaying turns between two terminal windows.
 *
 *   bun demos/tube-agent-duet/scenario.ts
 */
import { makeConsole, dim, green, yellow } from '../lib/console-conversation.ts';

const c = makeConsole({ beat: 260 });

await c.title('Port Daddy — two agents, one channel, an actual conversation', 'builder ⇄ reviewer · correlated replies · no human relay');

await c.act('①', 'the handoff', 'builder finishes a route and pings the review channel');
await c.say('builder', 'agents:review', 'API done — review POST /sessions?', `'{"pr":"#212","files":3}'`);
await c.ok('agents:review', 'stored', dim('msg #7'));
await c.ok('reviewer', 'woke', dim('was blocking on pd tube agents:review'));
await c.blank();

await c.act('②', 'the pushback', 'reviewer reads the diff and sends a change request — as a reply');
await c.note('reviewer reads the diff … 3 files, 142 lines');
await c.say('reviewer', 'agents:review', 'pd tube agents:review --reply "401 body leaks the session id. fix it."', '');
await c.ok('builder', 'woke', yellow('change requested'));
await c.blank();

await c.act('③', 'round two', 'builder patches, re-pings; reviewer approves on the same channel');
await c.note('builder patches routes/sessions.ts:67 — scrubs the error body');
await c.say('builder', 'agents:review', 'fixed — error body scrubbed. look again?', `'{"pr":"#212","rev":2}'`);
await c.say('reviewer', 'agents:review', 'pd tube agents:review --reply "LGTM. Ship it."', '');
await c.ok('builder', 'woke', green('approved → merging #212'));
await c.blank();

await c.done('two agents argued and converged.', 'no human relayed a single turn.');
process.exit(0);
