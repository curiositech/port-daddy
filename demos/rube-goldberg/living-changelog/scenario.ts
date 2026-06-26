#!/usr/bin/env bun
/**
 * THE LIVING CHANGELOG (docs/tube-router-rube-goldberg.md §6) — every push
 * becomes an honest changelog entry: ollama summarizes the diff, gemini adds
 * the "why it matters", and a final ollama pass strips the jargon. Ping-pong
 * detection stops the copy editor and the enricher from arguing forever.
 *
 *   bun demos/rube-goldberg/living-changelog/scenario.ts
 */
import { makeConsole, dim, green } from '../../lib/console-conversation.ts';

const c = makeConsole({ beat: 240 });

await c.title('Rube Goldberg machine №6 — the living changelog', 'push → summary → context → copy edit → CHANGELOG.md');

await c.act('①', 'summarize', 'ollama turns the diff into plain-English bullets');
await c.say('git', 'git:push', 'push 7e22c1 (9 files)', `'{"sha":"7e22c1"}'`);
await c.ok('ollama', 'drafted', dim('"session cursors are now per-listener — fan-out, not one-of-N"'));
await c.blank();

await c.act('②', 'enrich', 'gemini adds the why — context commit messages never carry');
await c.say('router', 'changelog:draft', 'spawn gemini: enrich + semver', `'{"issues":["#188"]}'`);
await c.ok('gemini', 'enriched', dim('links #188 (two listeners raced) · proposes minor bump → 3.16.2'));
await c.blank();

await c.act('③', 'copy edit', 'a final ollama pass hunts the cop-outs');
await c.ok('ollama', 'flagged', dim('"refactor internals" → rewritten as what actually changed'));
await c.say('router', 'changelog:final', 'append entry + publish', `'{"version":"3.16.2"}'`);
await c.blank();

await c.act('④', 'the guard', 'the editor wants gemini to re-enrich an "unclear" bullet — again');
await c.say('ollama', 'changelog:draft', 're-enrich bullet 3', `'{"pass":2}'`);
await c.refuse('router', 'ping-pong — one enrichment pass; accept the output or flag for a human');
await c.blank();

await c.done('the changelog writes itself, honestly.', green('no "misc fixes" ever again.'));
process.exit(0);
