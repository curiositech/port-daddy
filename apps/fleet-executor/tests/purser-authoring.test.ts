import { describe, it, expect, vi } from 'vitest';
import {
  extractCodeFence,
  parseTestPlan,
  authorTestFiles,
  MAX_PLANNED_FILES,
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
    for (const info of ['', 'ts', 'TypeScript', 'javascript', 'js']) {
      expect(extractCodeFence(`\`\`\`${info}\ncode()\n\`\`\``)).toBe('code()');
    }
  });

  it('ignores a draft fence inside a think span and takes the real answer', () => {
    const out = extractCodeFence(
      ['<think>', 'maybe:', '```ts', 'DRAFT', '```', '</think>', '```ts', 'FINAL', '```'].join('\n'),
    );
    expect(out).toBe('FINAL');
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
