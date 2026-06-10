#!/usr/bin/env bun
/**
 * THE DOC ROT HUNTER (docs/tube-router-rube-goldberg.md §4) — nightly sweep
 * that extracts every "the code does X" claim from the docs, greps the
 * actual source per claim, and lets gemini rewrite only the stale ones.
 *
 *   bun demos/rube-goldberg/doc-rot-hunter/scenario.ts
 */
import { makeConsole, dim, green, yellow } from '../../lib/console-conversation.ts';

const c = makeConsole({ beat: 240 });

await c.title('Rube Goldberg machine №4 — the doc rot hunter', 'every doc claim verified against source, nightly, mostly free');

await c.act('①', 'extract', 'ollama pulls every checkable claim out of the docs');
await c.say('cron', 'docs:scan', 'nightly sweep of docs/', `'{"pages":31}'`);
await c.ok('ollama', 'extracted', dim('118 claims of the form "function X returns Y"'));
await c.blank();

await c.act('②', 'verify', 'one message per claim — each gets its own grep of the real source');
await c.say('router', 'claim:verify', 'fan out 118 verifications', `'{"budget":50}'`);
await c.ok('ollama×50', 'checked', dim('47 hold · 3 stale: fetchUser() returns {userId, fullName} now'));
await c.refuse('router', yellow('fan-out budget (50) — 68 claims queued to docs:backlog for tomorrow'));
await c.blank();

await c.act('③', 'rewrite', 'gemini sees only the three stale claims, never the whole corpus');
await c.say('router', 'stale:claims', 'spawn gemini: batch-write corrections', `'{"stale":3}'`);
await c.ok('gemini', 'corrected', green('3 diffs → pr:docs — api.md, sessions.md, auth.md'));
await c.blank();

await c.done('the docs stopped lying while you slept.', 'silent rot, caught by a $0 grep army.');
process.exit(0);
