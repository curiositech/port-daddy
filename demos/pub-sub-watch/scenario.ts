#!/usr/bin/env bun
/**
 * Restyled "pub/sub + watch" demo in the agent-conversation console style.
 * Shows two agents coordinating over named channels: a CI publisher emits test
 * results; a deploy-watcher reacts and ships — event-driven, no polling.
 *
 *   bun demos/pub-sub-watch/scenario.ts
 */
import { makeConsole, dim, green } from '../lib/console-conversation.ts';

const c = makeConsole({ beat: 260 });

await c.title('Port Daddy — pub/sub + watch', 'named channels · event-driven coordination · no polling');

await c.act('①', 'publish', 'CI posts test results to a named channel as they finish');
await c.say('ci', 'test:results', 'auth suite passed (4.2s)', `'{"suite":"auth","status":"passed"}'`);
await c.ok('test:results', 'stored', dim('msg #18'));
await c.say('ci', 'test:results', 'payments suite passed (1.8s)', `'{"suite":"payments","status":"passed"}'`);
await c.ok('test:results', 'stored', dim('msg #19'));
await c.blank();

await c.act('②', 'subscribe', 'any agent reads channel history — fan-in is free');
await c.say('deployer', 'test:results', 'pd tube test:results --tail', '');
await c.note('← 2 messages: auth ✓, payments ✓  (all green)');
await c.blank();

await c.act('③', 'watch', 'pd watch turns a channel event into an action — no cron, no polling');
await c.say('deployer', 'build:results', 'pd watch build:results --exec ./deploy.sh', '');
await c.note('waiting on build:results …');
await c.say('ci', 'build:results', 'image built: sha-9f2c1a (12 files)', `'{"build":"ok","sha":"9f2c1a"}'`);
await c.ok('deployer', 'woke on build:results', green('→ ./deploy.sh fired'));
await c.note('deploy.sh: rolling out sha-9f2c1a … done.');
await c.blank();

await c.done('coordinated over channels.', 'publishers and watchers never block each other.');
process.exit(0);
