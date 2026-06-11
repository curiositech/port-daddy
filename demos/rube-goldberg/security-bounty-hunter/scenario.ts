#!/usr/bin/env bun
/**
 * THE SECURITY BOUNTY HUNTER (docs/tube-router-rube-goldberg.md §5) — a
 * full-codebase audit that costs ~$0 unless a finding is real: ollama
 * lenses fan out per module, dedup + triage locally, and a cloud model is
 * paid only to write the confirmed CVE writeup.
 *
 *   bun demos/rube-goldberg/security-bounty-hunter/scenario.ts
 */
import { makeConsole, dim, green, yellow } from '../../lib/console-conversation.ts';

const c = makeConsole({ beat: 240 });

await c.title('Rube Goldberg machine №5 — the security bounty hunter', 'free until a finding is real — then one cloud writeup');

await c.act('①', 'sweep', 'injection, auth, and crypto lenses fan out per module');
await c.say('cron', 'security:scan', 'audit src/ (14 modules)', `'{"lenses":["injection","auth","crypto"]}'`);
await c.ok('ollama×40', 'swept', dim('42 raw findings on findings:raw'));
await c.refuse('router', yellow('fan-out budget (40) — 2 modules queued to security:backlog'));
await c.blank();

await c.act('②', 'triage', 'dedup and severity-rank locally — still $0 spent');
await c.ok('ollama', 'triaged', dim('42 raw → 3 unique → 1 confirmed: webhook sig compared with =='));
await c.blank();

await c.act('③', 'the writeup', 'the first cloud token is spent on a CONFIRMED finding');
await c.say('router', 'findings:confirmed', 'spawn claude: writeup + patch', `'{"sev":"medium"}'`);
await c.ok('claude', 'wrote', green('timing-safe compare patch + advisory → pr:security (draft)'));
await c.note('draft PR, never auto-merge — a human signs every security change.');
await c.blank();

await c.done('a Semgrep-with-narrative, for the cost of one finding.', 'the monorepo cannot bankrupt it.');
process.exit(0);
