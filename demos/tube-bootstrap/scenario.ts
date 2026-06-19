#!/usr/bin/env bun
/**
 * "One sentence boots a program" — a single tube message asks for a new app;
 * the listening agent scaffolds it, claims a deterministic port from the
 * Port Daddy daemon, starts the dev server, and replies with the URL. The
 * whole bootstrap rides one channel round-trip.
 *
 *   bun demos/tube-bootstrap/scenario.ts
 */
import { makeConsole, dim, green } from '../lib/console-conversation.ts';

const c = makeConsole({ beat: 260 });

await c.title('Port Daddy — one message boots a whole program', 'scaffold · port claim · dev server · URL back on the channel');

await c.act('①', 'the ask', 'one sentence on a channel — that is the entire interface');
await c.say('you', 'ops:bootstrap', 'spin up the new admin panel', `'{"template":"vite-react","name":"admin"}'`);
await c.ok('ops:bootstrap', 'stored', dim('msg #3'));
await c.ok('claude', 'woke', dim('event #3: bootstrap admin'));
await c.blank();

await c.act('②', 'the scaffold', 'the agent does the init you would have typed');
await c.note('bun create vite admin --template react-ts … 23 files');
await c.note('bun install … 212 packages in 1.9s');
await c.blank();

await c.act('③', 'the port', 'claimed from the daemon — deterministic, tracked, conflict-free');
await c.note('PORT=$(pd claim admin:web:dev -q)');
await c.ok('pd', 'claimed', dim('admin:web:dev → 4137 (same identity, same port, every time)'));
await c.note('bun dev --port 4137 … ready in 312ms');
await c.blank();

await c.act('④', 'the reply', 'the URL comes back on the channel that asked');
await c.say('claude', 'ops:bootstrap', 'pd tube ops:bootstrap --reply "admin → http://localhost:4137"', '');
await c.ok('you', 'received', green('"admin → http://localhost:4137"'));
await c.blank();

await c.done('one sentence became a running program.', 'port claimed, server up, URL delivered.');
process.exit(0);
