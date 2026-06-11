#!/usr/bin/env bun
/**
 * THE TEST WHITTLER (docs/tube-router-rube-goldberg.md §1) — CI red never
 * pages a human. Ollama triages flaky vs real, codex writes the fix, ollama
 * verifies, and the depth cap stops codex from re-delegating triage upward.
 *
 *   bun demos/rube-goldberg/test-whittler/scenario.ts
 */
import { makeConsole, dim, green } from '../../lib/console-conversation.ts';

const c = makeConsole({ beat: 240 });

await c.title('Rube Goldberg machine №1 — the test whittler', 'CI red → triage → fix → verify → PR, no human paged');

await c.act('①', 'triage', 'ollama splits flaky from real — for free');
await c.say('ci', 'failing:tests', '3 suites red on push 9f2c1a', `'{"failed":["auth","cart","sync"]}'`);
await c.ok('ollama', 'triaged', dim('cart, sync = flaky (requeued) · auth = real regression'));
await c.blank();

await c.act('②', 'fix', 'codex writes the minimal patch for the one real failure');
await c.say('router', 'real-failures', 'spawn codex: fix auth regression', `'{"backend":"codex","depth":1}'`);
await c.ok('codex', 'patched', dim('lib/token.ts:88 — expiry comparison off-by-one'));
await c.blank();

await c.act('③', 'verify', 'ollama sanity-checks the diff and re-runs the suite');
await c.ok('ollama', 'verified', green('auth 12/12 green · diff touches 1 file, 2 lines'));
await c.say('router', 'pr:ready', 'open PR with fix + triage trail', `'{"pr":"auto/auth-expiry"}'`);
await c.blank();

await c.act('④', 'the guard', 'codex hits an unreproducible case and tries to re-triage UP');
await c.say('codex', 'failing:tests', 'cannot repro — re-delegate to triage', `'{"depth":4}'`);
await c.refuse('router', 'depth cap (4) — escalating to triage:human instead of looping');
await c.blank();

await c.done('CI red became a PR while you slept.', 'the loop guard is why you trust it unattended.');
process.exit(0);
