import { describe, it, expect, vi } from 'vitest';
import { parseFleetShips, type ShipConfig } from '../src/fleet.js';
import {
  extractCodeFence,
  parseTestPlan,
  authorTestFiles,
  MAX_PLANNED_FILES,
  startsLikeSource,
  type AuthorCall,
} from '../src/purser-authoring.js';

// ---------------------------------------------------------------------------
// extractCodeFence — the whole point of the rewrite.
//
// The old pipeline made file contents travel as JSON *string values*, so every
// newline, quote and backslash in a test file had to survive model escaping.
// It routinely did not. A raw fence needs no escaping at all, so these cases
// are the ones that used to lose 6KB of authored tests to a parse error.

describe('extractCodeFence', () => {
  it('takes the fenced body verbatim, including newlines and quotes', () => {
    const src = 'it("frobs", () => {\n  expect(f("a\\nb")).toBe(1);\n});';
    const out = extractCodeFence(['Here you go:', '```ts', src, '```'].join('\n'));
    expect(out).toBe(src);
  });

  it('accepts any info-string, or none', () => {
    const source = 'test("works", () => {});';
    for (const info of ['', 'ts', 'TypeScript', 'javascript', 'js']) {
      expect(extractCodeFence(`\`\`\`${info}\n${source}\n\`\`\``)).toBe(source);
    }
  });

  it('ignores a draft fence inside a think span and takes the real answer', () => {
    const out = extractCodeFence(
      ['<think>', 'maybe:', '```ts', 'const DRAFT = true;', '```', '</think>', '```ts', 'const FINAL = true;', '```'].join('\n'),
    );
    expect(out).toBe('const FINAL = true;');
  });

  it('takes the LONGEST fence when a model narrates with snippets first', () => {
    // Reasoning models open with a one-line illustration, then emit the file.
    const out = extractCodeFence(
      ['First, the import:', '```ts', 'import x', '```', 'Full file:', '```ts', 'import x\nit("a",()=>{})\nit("b",()=>{})', '```'].join('\n'),
    );
    expect(out).toBe('import x\nit("a",()=>{})\nit("b",()=>{})');
  });

  it('falls back to the bare text when the model forgets the fence entirely', () => {
    expect(extractCodeFence('import { it } from "vitest";\nit("a", () => {});')).toBe(
      'import { it } from "vitest";\nit("a", () => {});',
    );
  });

  it('returns null for prose that is plainly not a file', () => {
    expect(extractCodeFence('I cannot write these tests.')).toBeNull();
    expect(extractCodeFence('')).toBeNull();
  });

  it('rejects the exact #8736 failure: a fenced JSON fixture is not a TypeScript test', () => {
    const rawTimeline = JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      privacy: 'Sanitized timing only.',
      sessions: [{
        id: 'codex-session',
        steps: [{
          state: 'running',
          deadlineMs: 1000,
          description: 'A misleading fixture value can even contain expect(true).toBe(true).',
        }],
      }],
    }, null, 2);

    expect(extractCodeFence(`\`\`\`ts\n${rawTimeline}\n\`\`\``)).toBeNull();
  });

  it('rejects a JSON string even when its value contains source-looking syntax', () => {
    const encodedSource = JSON.stringify('test("looks real", () => expect(true).toBe(true));');
    expect(extractCodeFence(`\`\`\`ts\n${encodedSource}\n\`\`\``)).toBeNull();
  });

  it('chooses real source over a longer fenced data fixture', () => {
    const fixture = JSON.stringify({ sessions: Array.from({ length: 20 }, (_, i) => ({ id: i })) }, null, 2);
    const source = 'test("drops data-only author output", () => {\n  expect(true).toBe(true);\n});';
    const out = extractCodeFence([
      '```json',
      fixture,
      '```',
      '```ts',
      source,
      '```',
    ].join('\n'));

    expect(out).toBe(source);
  });

  it('keeps source-like fenced tests in non-TypeScript languages', () => {
    expect(extractCodeFence('```python\ndef test_frob():\n    assert frob() == 1\n```')).not.toBeNull();
    expect(extractCodeFence('```rust\n#[test]\nfn rejects_empty_input() { assert!(true); }\n```')).not.toBeNull();
    expect(extractCodeFence('```bash\n#!/bin/sh\nset -eu\ntest -f package.json\n```')).not.toBeNull();
  });

  it('does not mistake fenced prose containing a function call for source', () => {
    expect(extractCodeFence('```text\nPlease call cleanup() before trying again.\nThis is advice, not a test.\n```')).toBeNull();
  });

  it('rejects a multi-line REFUSAL that happens to contain code-ish punctuation', () => {
    // Raised by the qa bot on #6790, and it was a real defect: the first
    // heuristic asked for "a keyword, plus some punctuation", which this
    // satisfies without being code — `test` as an English word and a paren.
    // Accepting it commits the model's apology as a .test.ts file, which then
    // fails as a merge gate on a PR that did nothing wrong.
    expect(
      extractCodeFence('I cannot write this test.\nIt would need network access (which is unavailable).'),
    ).toBeNull();
  });

  it('rejects a multi-line REFUSAL that ends a line with a semicolon', () => {
    // The XO asked for the borderline case on #6790. This is it, and the
    // heuristic accepted it before this test existed: `;$` matched, so a
    // refusal got committed as a .test.ts file — the very outcome the check
    // above was added to prevent, reopened by a different clause. English
    // uses the semicolon; one of them is not evidence of code.
    expect(
      extractCodeFence('I cannot write this test;\nnetwork access is unavailable.'),
    ).toBeNull();
    expect(extractCodeFence('I cannot do this;\nsorry.')).toBeNull();
  });

  it('refuses a single line even when it is real code', () => {
    // Deliberately conservative in the safe direction: the fallback only ever
    // sees an UNFENCED response, where the cost of accepting prose (a broken
    // merge gate on an innocent PR) far exceeds the cost of rejecting a
    // one-line file the model should have fenced.
    expect(extractCodeFence('export const x = 1;')).toBeNull();
  });

  it('still accepts real unfenced code carried only by semicolons', () => {
    // The tightening must not cost the fallback a real file: two terminated
    // statements, and no declaration/call/arrow signal anywhere.
    expect(extractCodeFence('foo.bar();\nbaz.qux();')).not.toBeNull();
  });

  it('still accepts real unfenced code in several languages', () => {
    // The tightening must not throw away the case the fallback exists for.
    expect(extractCodeFence('import x from "y";\nit("a", () => {});')).not.toBeNull();
    expect(extractCodeFence('def test_frob():\n    assert frob() == 1')).not.toBeNull();
    expect(extractCodeFence('describe("suite", () => {\n  // ...\n});')).not.toBeNull();
  });

  it('returns null when every fence is empty', () => {
    // Raised by the qa bot on #6790: multiple fences, none with usable content.
    expect(extractCodeFence('```ts\n\n```\ntext\n```js\n   \n```')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseTestPlan — a tiny JSON object, the shape that already survives in the
// wild (the steel-man call uses it and works).

describe('parseTestPlan', () => {
  it('parses paths and intents', () => {
    const plan = parseTestPlan(
      '```json\n{"files":[{"path":"tests/purser/a.test.ts","intent":"edge cases"}]}\n```',
    );
    expect(plan).toEqual([{ path: 'tests/purser/a.test.ts', intent: 'edge cases' }]);
  });

  it('tolerates a bare array and a missing intent', () => {
    expect(parseTestPlan('[{"path":"tests/purser/a.test.ts"}]')).toEqual([
      { path: 'tests/purser/a.test.ts', intent: '' },
    ]);
  });

  it('caps the plan so a runaway model cannot fan out unboundedly', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ path: `tests/purser/f${i}.test.ts` }));
    expect(parseTestPlan(JSON.stringify({ files: many }))!.length).toBe(MAX_PLANNED_FILES);
  });

  it('drops entries with an unusable path rather than failing the whole plan', () => {
    const plan = parseTestPlan(
      JSON.stringify({ files: [{ path: '' }, { path: 'tests/purser/ok.test.ts' }] }),
    );
    expect(plan).toEqual([{ path: 'tests/purser/ok.test.ts', intent: '' }]);
  });

  it('returns null when nothing parses', () => {
    expect(parseTestPlan('no json here')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// authorTestFiles — the pipeline. Partial success is the headline behaviour:
// the old all-or-nothing shape threw away every good file because one was bad.

describe('authorTestFiles', () => {
  const plan = [
    { path: 'tests/purser/a.test.ts', intent: 'a' },
    { path: 'tests/purser/b.test.ts', intent: 'b' },
  ];

  it('issues ONE call per planned file, not one call for all of them', async () => {
    const call = vi.fn<AuthorCall>(async () => '```ts\nit("x", () => {});\n```');
    const res = await authorTestFiles(plan, call);
    expect(call).toHaveBeenCalledTimes(2);
    expect(res.files.map(f => f.path)).toEqual([
      'tests/purser/a.test.ts',
      'tests/purser/b.test.ts',
    ]);
  });

  it('keeps the files that authored cleanly when one file fails', async () => {
    const call = vi.fn<AuthorCall>(async path =>
      path.endsWith('a.test.ts') ? '```ts\nit("a", () => {});\n```' : 'I refuse.',
    );
    const res = await authorTestFiles(plan, call);
    expect(res.files.map(f => f.path)).toEqual(['tests/purser/a.test.ts']);
    expect(res.failures).toEqual([
      { path: 'tests/purser/b.test.ts', reason: 'no usable file content in the response' },
    ]);
  });

  it('survives a thrown call without losing the other files', async () => {
    const call = vi.fn<AuthorCall>(async path => {
      if (path.endsWith('a.test.ts')) throw new Error('502 upstream');
      return '```ts\nit("b", () => {});\n```';
    });
    const res = await authorTestFiles(plan, call);
    expect(res.files.map(f => f.path)).toEqual(['tests/purser/b.test.ts']);
    expect(res.failures[0].reason).toContain('502 upstream');
  });

  it('reports zero files rather than inventing one when every file fails', async () => {
    const res = await authorTestFiles(plan, async () => 'nope');
    expect(res.files).toEqual([]);
    expect(res.failures).toHaveLength(2);
  });

  it('never emits a file whose body is only whitespace', async () => {
    const res = await authorTestFiles([plan[0]], async () => '```ts\n   \n```');
    expect(res.files).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Per-step model tiering.
//
// The purser's steps have opposite cost shapes: PLAN reads the whole diff and
// emits a few paths (input-heavy), AUTHOR reads the same diff and emits a whole
// file (output-heavy). One model for both is wrong in one direction whichever
// is picked, so each step resolves its own.

describe('purser step model tiering', () => {
  const yamlFor = (extra: string) =>
    [
      'fleet:',
      '  agents:',
      '    purser:',
      '      class: purser',
      '      trigger: pull_request:opened',
      ...extra.split('\n').filter(Boolean).map(l => `      ${l}`),
    ].join('\n');

  const purserFrom = (extra = '') =>
    parseFleetShips(yamlFor(extra), 'pull_request:opened')!.find(s => s.name === 'purser')!;

  // Repo convention (see cfMapModel): an absent step key means "same as cfModel".
  // These assert the EFFECTIVE model, which is the question that matters.
  const planOf = (s: ShipConfig) => s.cfPlanModel ?? s.cfModel;
  const authorOf = (s: ShipConfig) => s.cfAuthorModel ?? s.cfModel;

  const CHEAP = '@cf/qwen/qwen3-30b-a3b-fp8';
  const MID = '@cf/openai/gpt-oss-20b';
  const AUTHOR = '@cf/deepseek-ai/deepseek-v4-flash-0731';

  it('defaults PLAN to the cheap model and AUTHOR to the agentic-coding tier', () => {
    // Operator ruling 2026-08-22, from the live D1 record: on the gpt-oss-20b
    // mid tier the author step ended 121 sets NON-EXECUTABLE and failed 83 of
    // 110 rewrites in 14 days, gating the fleet neutral on 249 of 584 runs
    // (#8870). Authoring a runnable file IS agentic coding, so the default is
    // the tier with the strongest independent agentic-coding record
    // (deepseek-v4-flash-0731; see AUTHOR_CF_MODEL's docblock) — while the
    // repair rewrite deliberately stays on a DIFFERENT family (gpt-oss-120b).
    const ship = purserFrom();
    expect(ship.cfModel).toBe(CHEAP);
    expect(planOf(ship)).toBe(CHEAP);
    expect(authorOf(ship)).toBe(AUTHOR);
  });

  it('an explicit cheaper author_model pin WINS over the strong default', () => {
    // The operator opting back down to save money must not be silently upgraded.
    expect(authorOf(purserFrom(`author_model: '${CHEAP}'`))).toBe(CHEAP);
    expect(authorOf(purserFrom(`author_model: '${MID}'`))).toBe(MID);
  });

  it('accepts the camelCase spellings operators actually write', () => {
    expect(authorOf(purserFrom(`authorModel: '${CHEAP}'`))).toBe(CHEAP);
    expect(planOf(purserFrom(`planModel: '${MID}'`))).toBe(MID);
  });

  it('DROPS an unknown id back to the tier default rather than remapping it', () => {
    // A nonexistent Workers AI id returns blank, not an error — the #654 outage.
    expect(authorOf(purserFrom("author_model: '@cf/some/nonexistent'"))).toBe(AUTHOR);
  });

  it('warns, but still defaults, when the key is present and EMPTY', () => {
    // Not the same as an absent key: someone typed `author_model:` and left it
    // blank, which is the most likely half-finished edit and used to be the one
    // mistake that produced no output at all. (pd-code-reviewer HIGH on #6813.)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(authorOf(purserFrom("author_model: ''"))).toBe(AUTHOR);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('present but empty'));
    } finally {
      warn.mockRestore();
    }
  });

  it('an explicit pin of the strong tier equals the default (and is honored, not dropped)', () => {
    // Until 2026-08-22 a gpt-oss-120b author pin was silently dropped to the
    // mid tier ("no pin can reach the review bot model"). That ceiling is
    // retired: the known-good set guards existence, not price, and the strong
    // tier IS the author default — pd-fleet.yml pins it explicitly.
    expect(authorOf(purserFrom(`author_model: '${AUTHOR}'`))).toBe(AUTHOR);
  });

  it('non-purser ships get no step-model keys at all', () => {
    const ships = parseFleetShips(
      ['fleet:', '  agents:', '    qa:', '      trigger: pull_request:opened', '      prompt: check it'].join('\n'),
      'pull_request:opened',
    )!;
    expect(ships[0].cfPlanModel).toBeUndefined();
    expect(ships[0].cfAuthorModel).toBeUndefined();
  });
});

// ── Chain-of-thought must never become a test file ───────────────────────────
//
// Two #9370 authoring calls returned raw deliberation ("We need to write a
// test file that verifies...") with no fence. The body scan in looksLikeCode
// was defeated from the inside — reasoning prose QUOTES real import lines and
// expect() calls while drafting — so multi-kilobyte transcripts were committed
// as .test.ts files. The bare fallback now also requires the response to BEGIN
// the way a source file begins.

describe('startsLikeSource', () => {
  it('rejects deliberation that quotes code from the inside', () => {
    const cot =
      'We need to write a test file that verifies isPublishableSkill is single source of truth.\n' +
      "import { spawnSync } from 'node:child_process';\n" +
      'We need to import buildSkillPullRequest from src/snipe-builder.ts.\n' +
      'expect(first.allowed).toBe(true);\n';
    expect(startsLikeSource(cot)).toBe(false);
    // ...and the full extraction path agrees: no fence + prose opening = null.
    expect(extractCodeFence(cot)).toBeNull();
  });

  it('accepts a file that forgot its fence but starts like source', () => {
    const bare =
      "import { describe, it, expect } from 'vitest';\n" +
      "describe('x', () => { it('y', () => { expect(1).toBe(1); }); });\n";
    expect(startsLikeSource(bare)).toBe(true);
    expect(extractCodeFence(bare)).toBe(bare.trim());
  });

  it('accepts a leading comment, shebang, or decorator opening', () => {
    expect(startsLikeSource('// tests for the widget\nconst a = 1;')).toBe(true);
    expect(startsLikeSource('#!/usr/bin/env node\nconsole.log(1);')).toBe(true);
    expect(startsLikeSource('# pytest suite\nimport os')).toBe(true);
  });

  it('fenced responses are unaffected — the model marked the file itself', () => {
    const fenced =
      'Some narration first.\n\n```ts\n' +
      "import { it } from 'vitest';\nit('a', () => {});\n" +
      '```\n';
    expect(extractCodeFence(fenced)).toContain("import { it } from 'vitest';");
  });
});
