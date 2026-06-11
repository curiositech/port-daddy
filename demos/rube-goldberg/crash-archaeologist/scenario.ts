#!/usr/bin/env bun
/**
 * THE CRASH ARCHAEOLOGIST (docs/tube-router-rube-goldberg.md §3) — a
 * production 500 becomes a merged PR with no human reading a stack trace.
 * Cloud tokens are spent only after the crash is CONFIRMED reproducible;
 * ping-pong detection breaks the codex⇄ollama bounce.
 *
 *   bun demos/rube-goldberg/crash-archaeologist/scenario.ts
 */
import { makeConsole, dim, green } from '../../lib/console-conversation.ts';

const c = makeConsole({ beat: 240 });

await c.title('Rube Goldberg machine №3 — the crash archaeologist', 'stack trace → repro → confirm → fix → PR, cloud tokens only after proof');

await c.act('①', 'dig', 'ollama reads the stack and names the suspects');
await c.say('prod', 'crash:log', '500 spike on /api/sessions', `'{"sig":"TypeError: null is not an object"}'`);
await c.ok('ollama', 'suspects', dim('resolveSession() · refreshToken() — 2 functions, not 200'));
await c.blank();

await c.act('②', 'repro', 'codex writes a throwaway script; ollama confirms the crash fires');
await c.say('router', 'reproduce:attempt', 'spawn codex: minimal repro', `'{"backend":"codex"}'`);
await c.ok('codex', 'wrote', dim('repro.ts — 14 lines, expired session + race'));
await c.ok('ollama', 'confirmed', green('crash reproduces — TypeError at session.ts:142'));
await c.blank();

await c.act('③', 'fix', 'only NOW does a cloud model spend tokens — the bug is proven real');
await c.say('router', 'fix:write', 'spawn claude: real fix + regression test', `'{"confirmed":true}'`);
await c.ok('claude', 'patched', dim('null-guard + test. PR opened on pr:patch'));
await c.blank();

await c.act('④', 'the guard', 'codex⇄ollama bounce on the same crash signature, third time');
await c.say('codex', 'verify:repro', 're-verify (same sig, attempt 3)', `'{"sig":"TypeError…"}'`);
await c.refuse('router', 'ping-pong detected — escalating to crash:human-review with full chain');
await c.blank();

await c.done('a production 500 became a tested PR.', 'phantom bugs never reach the expensive model.');
process.exit(0);
