#!/usr/bin/env bun
/**
 * THE DEBT SNAKE (docs/tube-router-rube-goldberg.md §8) — the weekly cron
 * that eats technical debt too small to prioritize: ollama inventories the
 * TODOs, codex and claude fix them in parallel worktrees, ollama verifies
 * each tree green, and everything squashes into one reviewable PR.
 *
 *   bun demos/rube-goldberg/debt-snake/scenario.ts
 */
import { makeConsole, dim, green, yellow } from '../../lib/console-conversation.ts';

const c = makeConsole({ beat: 240 });

await c.title('Rube Goldberg machine №8 — the debt snake', 'weekly cron · TODOs eaten in parallel worktrees · one PR out');

await c.act('①', 'inventory', 'ollama sizes every TODO, FIXME, and HACK in the tree');
await c.say('cron', 'debt:scan', 'weekly snake run', `'{"markers":137}'`);
await c.ok('ollama', 'sized', dim('19 small · 4 medium · 114 large-or-load-bearing (left alone)'));
await c.blank();

await c.act('②', 'feast', 'small → codex, medium → claude, each in its own worktree');
await c.say('router', 'debt:small', 'fan out 19 codex fixes', `'{"isolation":"worktree"}'`);
await c.say('router', 'debt:medium', 'fan out 4 claude refactors', `'{"isolation":"worktree"}'`);
await c.refuse('router', yellow('worktree budget (20) — 3 small fixes queued to debt:backlog'));
await c.blank();

await c.act('③', 'digest', 'every worktree re-runs the suite before it counts');
await c.ok('ollama', 'verified', dim('18/20 trees green — 2 reverted (tests went red, not worth it)'));
await c.say('router', 'pr:debt-batch', 'squash 18 passing trees into one PR', `'{"files":31}'`);
await c.ok('github', 'opened', green('PR: "weekly debt snake — 18 TODOs retired" · one review, done'));
await c.blank();

await c.done('the debt that lives forever got eaten on schedule.', 'no TODO gets fixed twice.');
process.exit(0);
