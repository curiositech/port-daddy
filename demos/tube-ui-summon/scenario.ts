#!/usr/bin/env bun
/**
 * "A button that summons your agent" — a local UI tool (a menu-bar app, a
 * dashboard, anything that can POST JSON) fires one HTTP call at a tube
 * channel; the agent already parked on `pd tube` wakes holding the event,
 * does real work, and its `--reply` becomes the UI's toast. The app never
 * links an SDK.
 *
 *   bun demos/tube-ui-summon/scenario.ts
 */
import { makeConsole, dim, green } from '../lib/console-conversation.ts';

const c = makeConsole({ beat: 260 });

await c.title('Port Daddy — a button that summons your agent', 'any local UI · one POST · the agent answers');

await c.act('①', 'the click', 'a menu-bar app POSTs plain JSON — no SDK linked, ever');
await c.say('fleetbar', 'ui:fixit', 'user clicked "Fix failing test"', `'{"action":"fix","suite":"auth"}'`);
await c.ok('ui:fixit', 'stored', dim('msg #41'));
await c.blank();

await c.act('②', 'the wake', 'the agent was blocking on pd tube — it wakes holding the event');
await c.note('claude was parked on: pd tube ui:fixit');
await c.ok('claude', 'woke', dim('event #41: fix the auth suite'));
await c.note('bun test auth … 1 failing (token expiry, off-by-one)');
await c.note('patching lib/token.ts:88 … re-running … 12/12 green');
await c.blank();

await c.act('③', 'the reply', 'same command, one flag — the agent’s prose becomes the UI’s toast');
await c.say('claude', 'ui:fixit', 'pd tube ui:fixit --reply "Fixed: expiry off-by-one. 12/12 green."', '');
await c.ok('fleetbar', 'toast', green('"Fixed: expiry off-by-one. 12/12 green."'));
await c.blank();

await c.done('a button click became a code change.', 'the UI spoke HTTP; the agent spoke shell.');
process.exit(0);
