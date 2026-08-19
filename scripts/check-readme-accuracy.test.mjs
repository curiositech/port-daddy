// Pure tests for the README accuracy gate. Run with: node --test scripts/check-readme-accuracy.test.mjs
//
// The gate decides whether a release ships, so its own parsing is tested before it is
// trusted — in particular the no-node_modules fallback, which by definition never runs
// on a developer machine and would otherwise be discovered broken during a release.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCommandSurface, parseWithRegex, loadFlagCorpus } from './check-readme-accuracy.mjs';
import { extractFences, shellInvocations, tokenize } from '../skills/readme-craft/scripts/extract-examples.mjs';
import { scoreReadme } from '../skills/readme-craft/scripts/readme-scorecard.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TIERS = join(ROOT, 'cli', 'permission-tiers.ts');

// ── Command surface ──────────────────────────────────────────────────────────

test('reads a real verb surface out of cli/permission-tiers.ts', () => {
  const { verbs, subcommands } = loadCommandSurface();
  assert.ok(verbs.size > 100, `expected >100 verbs, got ${verbs.size}`);
  for (const v of ['claim', 'release', 'begin', 'done', 'note', 'status', 'salvage']) {
    assert.ok(verbs.has(v), `registry should contain \`pd ${v}\``);
  }
  assert.ok(subcommands.size > 10, 'expected tier-refined subcommands');
});

test('the no-node_modules fallback parser agrees with the AST parser', () => {
  const src = readFileSync(TIERS, 'utf8');
  const viaRegex = parseWithRegex(src);
  const ast = loadCommandSurface();

  const top = viaRegex.get('TIER_REGISTRY');
  assert.ok(top && top.length > 100, `fallback read only ${top?.length ?? 0} verbs`);
  // Every verb the fallback finds must be a verb the AST path also found. The
  // converse is not asserted: a future nested literal would be AST-only, and that
  // asymmetry is exactly what the minimum-size guard in loadCommandSurface() covers.
  for (const v of top) assert.ok(ast.verbs.has(v), `fallback invented a verb: ${v}`);
});

test('refuses a surface too small to be real rather than passing vacuously', () => {
  assert.throws(
    () => loadCommandSurface(join(ROOT, 'package.json')),
    /refusing to report a vacuous pass/,
  );
});

// ── Flag corpus ──────────────────────────────────────────────────────────────

test('harvests a plausible flag corpus that contains flags the README uses', () => {
  const flags = loadFlagCorpus();
  assert.ok(flags.size > 100, `expected >100 flags, got ${flags.size}`);
  for (const f of ['--lifecycle', '--roadmap', '--sidequest', '--since']) {
    assert.ok(flags.has(f), `corpus should contain ${f}`);
  }
});

// ── Fence extraction ─────────────────────────────────────────────────────────

test('extracts fences with 1-indexed line numbers and inferred tiers', () => {
  const md = ['# T', '', '```bash', 'pd status', '```', '', '```json', '{}', '```', ''].join('\n');
  const blocks = extractFences(md);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].startLine, 3);
  assert.equal(blocks[0].tier, 'surface', 'shell blocks default to surface');
  assert.equal(blocks[1].tier, 'skip', 'non-shell blocks default to skip');
});

test('honors a declared tier and its reason, and strips the directive from the body', () => {
  const md = '```bash\n# readme-verify: skip — placeholder syntax\npd <verb>\n```\n';
  const [b] = extractFences(md);
  assert.equal(b.tier, 'skip');
  assert.equal(b.reason, 'placeholder syntax');
  assert.equal(b.declared, true);
  assert.equal(b.code, 'pd <verb>');
});

test('longer backtick runs nest without mis-pairing', () => {
  const md = ['````markdown', '```bash', 'pd status', '```', '````', ''].join('\n');
  const blocks = extractFences(md);
  assert.equal(blocks.length, 1, 'the inner fence is content, not a second block');
  assert.equal(blocks[0].lang, 'markdown');
});

test('flags an unterminated fence instead of swallowing it', () => {
  const [b] = extractFences('```bash\npd status\n');
  assert.equal(b.unterminated, true);
});

// ── Shell parsing ────────────────────────────────────────────────────────────

test('strips inline comments so they are not read as subcommands', () => {
  const [inv] = shellInvocations('pd attention            # what other agents queued for you');
  assert.deepEqual(inv.argv, ['pd', 'attention']);
});

test('keeps a hash that is part of a token', () => {
  assert.deepEqual(tokenize('pd note --tag=#1'), ['pd', 'note', '--tag=#1']);
});

test('drops sudo and environment prefixes but keeps the command', () => {
  assert.deepEqual(tokenize('sudo FOO=bar pd claim myapp'), ['pd', 'claim', 'myapp']);
});

test('takes only the head of a pipeline', () => {
  assert.deepEqual(tokenize('pd notes --json | jq .body'), ['pd', 'notes', '--json']);
});

test('in a prompted block, captured output is not parsed as a command', () => {
  const code = ['$ pd claim myapp', '3178', 'pd is not being invoked on this line'].join('\n');
  const invs = shellInvocations(code);
  assert.equal(invs.length, 1);
  assert.deepEqual(invs[0].argv, ['pd', 'claim', 'myapp']);
});

test('joins line continuations into one invocation', () => {
  const invs = shellInvocations('pd begin "x" \\\n  --lifecycle durable');
  assert.equal(invs.length, 1);
  assert.ok(invs[0].argv.includes('--lifecycle'));
});

// ── Scorecard ────────────────────────────────────────────────────────────────

test('the shipped README passes the scorecard with no errors', () => {
  const path = join(ROOT, 'README.md');
  const { errors } = scoreReadme(readFileSync(path, 'utf8'), path);
  assert.deepEqual(errors, [], `README scorecard errors:\n${errors.map((e) => `L${e.line} ${e.rule}: ${e.message}`).join('\n')}`);
});

test('a broken image is an error, not a warning', () => {
  const md = '# T\n\n![alt](does/not/exist.png)\n\n```bash\npd status\n```\n';
  const { errors } = scoreReadme(md, join(ROOT, 'README.md'));
  assert.ok(errors.some((e) => e.rule === 'broken-image'), 'broken image must block');
});

test('a README with no runnable command anywhere is an error', () => {
  const { errors } = scoreReadme('# T\n\nJust prose.\n', join(ROOT, 'README.md'));
  assert.ok(errors.some((e) => e.rule === 'no-runnable-command'));
});

test('unverifiable adjectives and version narration are warnings', () => {
  const md = '# T\n\nBlazing fast. As of v3.1 this changed.\n\n```bash\npd status\n```\n';
  const { warnings } = scoreReadme(md, join(ROOT, 'README.md'));
  assert.ok(warnings.some((w) => w.rule === 'unverifiable-claim'));
  assert.ok(warnings.some((w) => w.rule === 'temporal-narration'));
});
