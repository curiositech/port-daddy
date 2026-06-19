#!/usr/bin/env bun
/**
 * THE ON-CALL WHISPERER (docs/tube-router-rube-goldberg.md §7) — a page
 * arrives pre-chewed: classified, runbook attached, patch drafted, sanity
 * verdict written. The human approves or rejects; the machine never
 * self-merges, and upward delegation is structurally blocked.
 *
 *   bun demos/rube-goldberg/oncall-whisperer/scenario.ts
 */
import { makeConsole, dim, green } from '../../lib/console-conversation.ts';

const c = makeConsole({ beat: 240 });

await c.title('Rube Goldberg machine №7 — the on-call whisperer', 'alert → classify → runbook → draft patch → human gate');

await c.act('①', 'classify', 'ollama names the category before anyone is woken');
await c.say('pagerduty', 'alert:fire', 'p95 latency 4× on /api/checkout', `'{"sev":2}'`);
await c.ok('ollama', 'classified', dim('DB — connection pool exhaustion pattern, not code'));
await c.blank();

await c.act('②', 'draft', 'codex reads the runbook + recent commits and proposes the change');
await c.say('router', 'runbook:db', 'spawn codex: draft remediation', `'{"runbook":"db-pool"}'`);
await c.ok('codex', 'drafted', dim('pool max 20 → 50 in db.config.ts + links the runbook section'));
await c.ok('ollama', 'sanity', green('patch touches exactly the file the runbook names'));
await c.blank();

await c.act('③', 'the gate', 'everything stops at a human — by construction, not convention');
await c.say('router', 'oncall:gate', 'classified alert + patch + verdict → approval required', '');
await c.note('the on-call wakes to a decision, not an investigation.');
await c.blank();

await c.act('④', 'the guard', 'codex hits ambiguity and tries to spawn a fresh classifier');
await c.say('codex', 'alert:fire', 'unclear — re-classify the alert', `'{"upward":true}'`);
await c.refuse('router', 'upward delegation blocked — emit a "?" verdict to oncall:gate instead');
await c.blank();

await c.done('the 3am page became a yes/no question.', 'no recursive triage. no self-merge. ever.');
process.exit(0);
