#!/usr/bin/env bun
/**
 * THE ADVERSARIAL REVIEWER (docs/tube-router-rube-goldberg.md §2) — three
 * cheap local reviewers fan out in parallel lenses, a cloud synthesizer
 * resolves their conflicts, and the fan-out budget stops the synthesizer
 * from hiring its own fleet when it disagrees.
 *
 *   bun demos/rube-goldberg/adversarial-reviewer/scenario.ts
 */
import { makeConsole, dim, green, yellow } from '../../lib/console-conversation.ts';

const c = makeConsole({ beat: 240 });

await c.title('Rube Goldberg machine №2 — the adversarial reviewer', 'three local lenses in parallel, one cloud synthesizer, budget-capped');

await c.act('①', 'fan-out', 'one diff, three ollama reviewers, three lenses — ~10s, $0');
await c.say('you', 'pr:diff', 'review PR #314', `'{"files":7,"lines":312}'`);
await c.ok('ollama·correctness', 'verdict', dim('retry loop never decrements its budget'));
await c.ok('ollama·security', 'verdict', dim('webhook secret compared with ==, not constant-time'));
await c.ok('ollama·perf', 'verdict', green('no regressions — hot path untouched'));
await c.blank();

await c.act('②', 'synthesis', 'claude fires only after all three lenses resolve');
await c.say('router', 'converge:review', 'spawn claude: synthesize 3 verdicts', `'{"conflicts":1}'`);
await c.ok('claude', 'synthesized', dim('2 blocking findings, 1 pass — conflicts surfaced, not averaged'));
await c.say('claude', 'pr:comment', 'post the verdict to PR #314', '');
await c.blank();

await c.act('③', 'the guard', 'claude disputes the perf pass and tries to hire reviewer #4');
await c.say('claude', 'pr:diff', 'spawn another perf reviewer', `'{"fanout":4}'`);
await c.refuse('router', yellow('fan-out budget (3) — resolve disagreements with what you have'));
await c.blank();

await c.done('three skeptics and a judge, for the price of one comment.', 'disagreement is a feature; runaway hiring is not.');
process.exit(0);
