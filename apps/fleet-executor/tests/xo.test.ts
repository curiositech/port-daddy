/**
 * XO synthesis officer (src/xo.ts) — unit + integration coverage.
 *
 * The XO's two duties (idea editor pass, advisory-findings triage) are both
 * strictly advisory and strictly fail-open, so the tests here pin BOTH sides
 * of every behavior: the applied path (a mocked edit list / orders payload is
 * honored) AND the fallback path (an XO failure changes NOTHING — proposals
 * survive untouched, the review comment renders exactly as today, and the
 * check conclusion never moves).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  stripThinkSpans,
  resolveXoModel,
  parseXoEditList,
  applyXoEdits,
  runXoEditorPass,
  collectAdvisoryFindings,
  parseXoOrders,
  renderXoOrdersSection,
  xoOrdersSection,
  DEFAULT_XO_MODEL,
  XO_MAX_ORDERS,
  type AdvisoryRef,
} from '../src/xo.js';
import { parseFleetXo } from '../src/fleet.js';
import { listRecentIdeas } from '../src/ideas-store.js';
import type { Proposal } from '../src/proposals.js';
import type { ShipResult } from '../src/verdict.js';
import { executeFleet } from '../src/execute.js';
import { FleetAiCircuit, FleetAiDependencyError } from '../src/ai-resilience.js';
import {
  freshState,
  installGitHubFetch,
  memoryKV,
  memoryD1,
  aiStub,
  makeEnv,
  makeJob,
  type GitHubState,
  type AiStub,
} from './harness.js';

// ---------------------------------------------------------------------------
// think-span stripping

describe('stripThinkSpans', () => {
  it('removes complete <think>…</think> spans (multiple)', () => {
    const raw = '<think>step 1</think>answer<think>step 2</think> more';
    expect(stripThinkSpans(raw)).toBe('answer more');
  });

  it('drops everything before an orphan closing tag (template opened the think block)', () => {
    expect(stripThinkSpans('reasoning without opener</think>\n[1]')).toBe('[1]');
  });

  it('drops everything after an orphan opening tag (output truncated mid-think)', () => {
    expect(stripThinkSpans('[1]\n<think>truncated reasoni')).toBe('[1]');
  });

  it('leaves tag-free output untouched (trimmed)', () => {
    expect(stripThinkSpans('  plain json []  ')).toBe('plain json []');
  });

  it('returns empty for empty/think-only output', () => {
    expect(stripThinkSpans('')).toBe('');
    expect(stripThinkSpans('<think>only reasoning</think>')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// model resolution (Workers AI ONLY)

describe('resolveXoModel', () => {
  it('defaults to the @cf/ deepseek distill when unset', () => {
    expect(resolveXoModel(undefined)).toBe(DEFAULT_XO_MODEL);
    expect(resolveXoModel('')).toBe(DEFAULT_XO_MODEL);
  });

  it('honors an explicit @cf/ override', () => {
    expect(resolveXoModel('@cf/qwen/qwen3-30b-a3b-fp8')).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });

  it('IGNORES any non-@cf/ id — the XO can never leave Workers AI', () => {
    expect(resolveXoModel('claude-sonnet-4')).toBe(DEFAULT_XO_MODEL);
    expect(resolveXoModel('gpt-4o')).toBe(DEFAULT_XO_MODEL);
    expect(resolveXoModel('anthropic/claude-3-haiku')).toBe(DEFAULT_XO_MODEL);
  });
});

// ---------------------------------------------------------------------------
// xo flag parsing (fleet.ts)

describe('parseFleetXo', () => {
  it('is OFF by default — absent key means no consent', () => {
    expect(parseFleetXo('fleet:\n  name: test\n  agents: {}\n')).toBe(false);
  });

  it('opts in only on strict true / "true"', () => {
    expect(parseFleetXo('fleet:\n  xo: true\n')).toBe(true);
    expect(parseFleetXo("fleet:\n  xo: 'true'\n")).toBe(true);
  });

  it('rejects YAML-ish truthiness and garbage docs', () => {
    expect(parseFleetXo('fleet:\n  xo: 1\n')).toBe(false);
    expect(parseFleetXo('fleet:\n  xo: on\n')).toBe(false);
    expect(parseFleetXo('not: yaml: {{{{')).toBe(false);
    expect(parseFleetXo('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// edit-list parse + apply

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    title: 'Idea',
    rationale: 'Because.',
    evidence: [],
    action: 'roadmap',
    ...over,
  };
}

describe('parseXoEditList', () => {
  it('parses a fenced edit list wrapped in think spans', () => {
    const raw =
      '<think>0 and 1 look the same…</think>\n```json\n' +
      '[{"op":"keep","index":0},{"op":"drop","index":1,"duplicateOf":"Old idea"}]\n```';
    expect(parseXoEditList(raw)).toEqual([
      { op: 'keep', index: 0 },
      { op: 'drop', index: 1, duplicateOf: 'Old idea' },
    ]);
  });

  it('parses a bare (unfenced) JSON array', () => {
    expect(parseXoEditList('Here you go: [{"op":"retitle","index":0,"title":"Better"}]')).toEqual([
      { op: 'retitle', index: 0, title: 'Better' },
    ]);
  });

  it('rejects the WHOLE list on any malformed element', () => {
    expect(parseXoEditList('[{"op":"explode","index":0}]')).toBeNull();
    expect(parseXoEditList('[{"op":"keep","index":-1}]')).toBeNull();
    expect(parseXoEditList('[{"op":"keep","index":1.5}]')).toBeNull();
    expect(parseXoEditList('[{"op":"merge","index":0,"absorb":["x"]}]')).toBeNull();
    expect(parseXoEditList('{"op":"keep","index":0}')).toBeNull(); // not an array
    expect(parseXoEditList('{ broken')).toBeNull();
    expect(parseXoEditList('')).toBeNull();
  });
});

describe('applyXoEdits', () => {
  it('drop removes, retitle rewrites, unreferenced proposals are KEPT as-is', () => {
    const batch = [
      proposal({ title: 'A' }),
      proposal({ title: 'B' }),
      proposal({ title: 'C' }),
    ];
    const out = applyXoEdits(batch, [
      { op: 'drop', index: 1 },
      { op: 'retitle', index: 0, title: 'A sharpened' },
    ]);
    expect(out.map(p => p.title)).toEqual(['A sharpened', 'C']);
  });

  it('merge unions evidence into the survivor and preserves its action/prompt/files', () => {
    const batch = [
      proposal({ title: 'A', evidence: ['x.ts'], action: 'assign', prompt: 'build it' }),
      proposal({ title: 'B', evidence: ['y.ts', 'x.ts'] }),
    ];
    const out = applyXoEdits(batch, [
      { op: 'merge', index: 0, absorb: [1], title: 'A+B', rationale: 'combined' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('A+B');
    expect(out[0].rationale).toBe('combined');
    expect(out[0].evidence).toEqual(['x.ts', 'y.ts']);
    expect(out[0].action).toBe('assign');
    expect(out[0].prompt).toBe('build it');
  });

  it('ignores out-of-range indices and self-absorption — nothing lost by accident', () => {
    const batch = [proposal({ title: 'A' }), proposal({ title: 'B' })];
    const out = applyXoEdits(batch, [
      { op: 'drop', index: 99 },
      { op: 'merge', index: 0, absorb: [0, 42] },
    ]);
    expect(out.map(p => p.title)).toEqual(['A', 'B']);
  });

  it('does not mutate the input batch (pure)', () => {
    const batch = [proposal({ title: 'A', evidence: ['x'] })];
    applyXoEdits(batch, [{ op: 'retitle', index: 0, title: 'Z' }]);
    expect(batch[0].title).toBe('A');
    expect(batch[0].evidence).toEqual(['x']);
  });
});

// ---------------------------------------------------------------------------
// editor pass (fail-open contract)

function fakeAi(handler: (args: { messages: Array<{ role: string; content: string }> }) => unknown): Ai {
  return { run: vi.fn(async (_m: string, args: never) => handler(args as never)) } as unknown as Ai;
}

describe('runXoEditorPass', () => {
  const batch = [proposal({ title: 'A' }), proposal({ title: 'B' })];

  it('applies a valid mocked edit list', async () => {
    const ai = fakeAi(() => ({
      response: '<think>dupes</think>[{"op":"drop","index":1,"duplicateOf":"A"}]',
    }));
    const out = await runXoEditorPass({ ai, model: DEFAULT_XO_MODEL, proposals: batch, recentIdeas: [] });
    expect(out.applied).toBe(true);
    expect(out.proposals.map(p => p.title)).toEqual(['A']);
  });

  it('falls back to the ORIGINAL batch when the model throws', async () => {
    const ai = fakeAi(() => {
      throw new Error('Workers AI down');
    });
    const out = await runXoEditorPass({ ai, model: DEFAULT_XO_MODEL, proposals: batch, recentIdeas: [] });
    expect(out.applied).toBe(false);
    expect(out.proposals).toEqual(batch);
    expect(out.reason).toContain('Workers AI down');
  });

  it('propagates a shared retryable provider-circuit fault instead of hiding it as an XO fallback', async () => {
    const ai = fakeAi(() => {
      throw Object.assign(new Error('no capacity'), { status: 429, code: 3040 });
    });
    await expect(runXoEditorPass({
      ai,
      model: DEFAULT_XO_MODEL,
      proposals: batch,
      recentIdeas: [],
      aiCircuit: new FleetAiCircuit(),
    })).rejects.toBeInstanceOf(FleetAiDependencyError);
  });

  it('falls back to the ORIGINAL batch on malformed / empty output', async () => {
    for (const response of ['not json at all', '', '<think>all reasoning, no answer']) {
      const ai = fakeAi(() => ({ response }));
      const out = await runXoEditorPass({ ai, model: DEFAULT_XO_MODEL, proposals: batch, recentIdeas: [] });
      expect(out.applied).toBe(false);
      expect(out.proposals).toEqual(batch);
    }
  });

  it('never calls the model for an empty batch', async () => {
    const ai = fakeAi(() => ({ response: '[]' }));
    const out = await runXoEditorPass({ ai, model: DEFAULT_XO_MODEL, proposals: [], recentIdeas: [] });
    expect(out.applied).toBe(false);
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    void out;
  });

  it('fails open without dispatching an over-budget editor request', async () => {
    // Titles and rationales are bounded by the editor projection, but callers
    // can still hand it an arbitrarily large proposal batch/evidence list.
    // The final request gate must preserve every proposal rather than making a
    // doomed Workers AI call or silently slicing the input.
    const oversized = Array.from({ length: 80 }, (_, index) =>
      proposal({
        title: `Proposal ${index}`,
        evidence: ['e'.repeat(1_024), 'e'.repeat(1_024), 'e'.repeat(1_024)],
      }),
    );
    const ai = fakeAi(() => ({ response: '[]' }));

    const out = await runXoEditorPass({
      ai,
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      proposals: oversized,
      recentIdeas: [],
    });

    expect(out).toMatchObject({ applied: false, proposals: oversized });
    expect(out.reason).toMatch(/context admission rejected/i);
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// recent-ideas reader (best-effort)

describe('listRecentIdeas', () => {
  it('returns recent canonical title/rationale rows', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [{ title: 'T', rationale: 'R' }] }),
        }),
      }),
    } as unknown as D1Database;
    expect(await listRecentIdeas(db, 30)).toEqual([{ title: 'T', rationale: 'R' }]);
  });

  it('returns [] on any D1 failure (never throws into the capture path)', async () => {
    const db = {
      prepare: () => {
        throw new Error('no such table');
      },
    } as unknown as D1Database;
    expect(await listRecentIdeas(db, 30)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// triage: collect + parse + render

function advisory(over: Partial<AdvisoryRef> = {}): AdvisoryRef {
  return { ship: 'qa', path: 'src/x.ts', line: 3, severity: 'MEDIUM', body: 'missing test', ...over };
}

describe('collectAdvisoryFindings', () => {
  it('collects findings from NON-BLOCKING ships only', () => {
    const results: ShipResult[] = [
      {
        ship: 'code-reviewer',
        blocking: true,
        verdict: 'PASS',
        errored: false,
        findings: [{ path: 'a.ts', line: 1, severity: 'HIGH', body: 'gate-side' }],
      },
      {
        ship: 'qa',
        blocking: false,
        verdict: 'PASS',
        errored: false,
        findings: [{ path: 'b.ts', line: 2, severity: 'LOW', body: 'advisory-side' }],
      },
      { ship: 'spark', blocking: false, verdict: 'PASS', errored: false },
    ];
    const out = collectAdvisoryFindings(results);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ship: 'qa', path: 'b.ts', body: 'advisory-side' });
  });
});

describe('parseXoOrders', () => {
  it('parses the {"orders":[…]} contract (think-wrapped) and a bare array', () => {
    const wrapped = '<think>only #0 matters</think>{"orders":[{"index":0,"why":"on the diff"}]}';
    expect(parseXoOrders(wrapped, 3)).toEqual([{ index: 0, why: 'on the diff' }]);
    expect(parseXoOrders('[{"index":1,"why":"real"}]', 3)).toEqual([{ index: 1, why: 'real' }]);
  });

  it('filters invalid/duplicate indices per-element and caps the shortlist', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ index: i, why: `w${i}` }));
    expect(parseXoOrders(JSON.stringify({ orders: many }), 10)).toHaveLength(XO_MAX_ORDERS);
    const messy = [
      { index: 0, why: 'ok' },
      { index: 0, why: 'dupe' },
      { index: 99, why: 'out of range' },
      { index: 1 }, // no why
      'garbage',
      { index: 1, why: 'ok too' },
    ];
    expect(parseXoOrders(JSON.stringify(messy), 2)).toEqual([
      { index: 0, why: 'ok' },
      { index: 1, why: 'ok too' },
    ]);
  });

  it('accepts a valid empty shortlist and rejects malformed payloads', () => {
    expect(parseXoOrders('{"orders":[]}', 4)).toEqual([]);
    expect(parseXoOrders('no json here', 4)).toBeNull();
    expect(parseXoOrders('{"nope":true}', 4)).toBeNull();
  });
});

describe('renderXoOrdersSection', () => {
  it('renders demanded items with justification and summarizes the rest as a COUNT', () => {
    const advisories = [advisory({ body: 'first' }), advisory({ body: 'second' }), advisory({ body: 'third' })];
    const md = renderXoOrdersSection([{ index: 1, why: 'directly on the diff' }], advisories);
    expect(md).toContain("XO's orders");
    expect(md).toContain('advisory');
    expect(md).toContain('second');
    expect(md).toContain('directly on the diff');
    expect(md).toContain('2 other advisory findings');
    expect(md).not.toContain('first'); // not re-listed — summarized as the count
  });

  it('renders an honest "demands none" line for a valid empty shortlist', () => {
    const md = renderXoOrdersSection([], [advisory()]);
    expect(md).toContain('demands none');
  });

  it('returns "" when there were no advisories at all', () => {
    expect(renderXoOrdersSection([], [])).toBe('');
  });
});

describe('xoOrdersSection (fail-open contract)', () => {
  const advisories = [advisory()];

  it('returns the rendered section on a valid orders payload', async () => {
    const ai = fakeAi(() => ({ response: '{"orders":[{"index":0,"why":"worth it"}]}' }));
    const md = await xoOrdersSection({ ai, model: DEFAULT_XO_MODEL, advisories, changedPaths: ['src/x.ts'] });
    expect(md).toContain("XO's orders");
    expect(md).toContain('worth it');
  });

  it('returns "" when the model throws or emits garbage — comment unchanged', async () => {
    const throwing = fakeAi(() => {
      throw new Error('boom');
    });
    expect(await xoOrdersSection({ ai: throwing, model: DEFAULT_XO_MODEL, advisories, changedPaths: [] })).toBe('');
    const garbage = fakeAi(() => ({ response: 'not json' }));
    expect(await xoOrdersSection({ ai: garbage, model: DEFAULT_XO_MODEL, advisories, changedPaths: [] })).toBe('');
  });

  it('propagates a shared retryable provider-circuit fault so the queue owns its bounded retry', async () => {
    const ai = fakeAi(() => {
      throw Object.assign(new Error('no capacity'), { status: 429, code: 3040 });
    });
    await expect(xoOrdersSection({
      ai,
      model: DEFAULT_XO_MODEL,
      advisories,
      changedPaths: [],
      aiCircuit: new FleetAiCircuit(),
    })).rejects.toBeInstanceOf(FleetAiDependencyError);
  });

  it('returns "" with zero advisories, spending no AI', async () => {
    const ai = fakeAi(() => ({ response: '{"orders":[]}' }));
    expect(await xoOrdersSection({ ai, model: DEFAULT_XO_MODEL, advisories: [], changedPaths: [] })).toBe('');
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('fails open without dispatching an over-budget triage request', async () => {
    const ai = fakeAi(() => ({ response: '{"orders":[]}' }));
    const result = await xoOrdersSection({
      ai,
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      advisories,
      changedPaths: ['src/' + 'x'.repeat(40_000) + '.ts'],
    });

    expect(result).toBe('');
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Integration through executeFleet (harness)

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Seed a KV cache hit so the orchestrator never mints (avoids real crypto). */
function seedToken(kv: KVNamespace, installationId: number): void {
  void kv.put(
    `github_inst_${installationId}`,
    JSON.stringify({ token: 'seeded-tok', expiresAt: Date.now() + 60 * 60 * 1000 }),
  );
}

/**
 * A pd-fleet.yml with one ship, optionally opting the tenant into the XO.
 * Prompts embed the ship name so the base AI stub can route per-ship output.
 */
function shipYaml(opts: { name: string; ideation?: boolean; xo?: boolean }): string {
  return [
    'fleet:',
    '  name: test',
    ...(opts.xo ? ['  xo: true'] : []),
    '  agents:',
    `    ${opts.name}:`,
    '      trigger: pull_request:opened',
    ...(opts.ideation ? ['      class: ideation'] : []),
    '      fallbacks:',
    '        - backend: cloudflare',
    "          model: '@cf/qwen/qwen3-30b-a3b-fp8'",
    '      prompt: |',
    `        ${opts.name} ship: do your job on this diff.`,
    '',
  ].join('\n');
}

/**
 * Wrap the base AI stub with XO awareness: calls whose system prompt carries
 * the XO EDITOR / XO TRIAGE duty markers are answered (or exploded) here and
 * counted; embedding calls (no `messages`) return a tiny vector; everything
 * else delegates to the base per-ship stub.
 */
function xoAwareAi(
  base: AiStub,
  opts: {
    editorOutput?: string;
    triageOutput?: string;
    throwOnXo?: boolean;
    retryableXoFailure?: boolean;
    retryableEmbeddingFailure?: boolean;
  },
): { ai: Ai; counters: { editor: number; triage: number } } {
  const counters = { editor: 0, triage: 0 };
  const run = async (model: string, args: unknown, o?: unknown): Promise<unknown> => {
    const messages = (args as { messages?: Array<{ role: string; content: string }> }).messages;
    if (!messages) {
      if (opts.retryableEmbeddingFailure) {
        throw Object.assign(new Error('embedding provider capacity'), { status: 429, code: 3040 });
      }
      return { data: [[0.1, 0.2, 0.3]] };
    }
    const sys = messages.find(m => m.role === 'system')?.content ?? '';
    if (sys.includes('XO EDITOR')) {
      counters.editor += 1;
      if (opts.retryableXoFailure) {
        throw Object.assign(new Error('XO provider capacity'), { status: 429, code: 3040 });
      }
      if (opts.throwOnXo) throw new Error('XO exploded');
      return { response: opts.editorOutput ?? '' };
    }
    if (sys.includes('XO TRIAGE')) {
      counters.triage += 1;
      if (opts.retryableXoFailure) {
        throw Object.assign(new Error('XO provider capacity'), { status: 429, code: 3040 });
      }
      if (opts.throwOnXo) throw new Error('XO exploded');
      return { response: opts.triageOutput ?? '' };
    }
    return (base.ai as unknown as { run: (m: string, a: unknown, o?: unknown) => Promise<unknown> }).run(model, args, o);
  };
  return { ai: { run: vi.fn(run) } as unknown as Ai, counters };
}

function commentBodiesOf(s: GitHubState): string[] {
  return s.records
    .filter(r => r.method === 'POST' && /\/issues\/\d+\/comments$/.test(r.url))
    .map(r => (r.body as { body?: string }).body ?? '');
}

const TWO_PROPOSALS =
  '```json\n' +
  JSON.stringify([
    { title: 'Wire the relay dashboard', rationale: 'why one', evidence: ['a.ts'], action: 'roadmap' },
    { title: 'Wire the relay dashboards', rationale: 'why two', evidence: ['b.ts'], action: 'roadmap' },
  ]) +
  '\n```\nFLEET-VERDICT: PASS';

const QA_FINDINGS =
  '```json\n' +
  JSON.stringify([
    { path: 'src/x.ts', line: 3, severity: 'MEDIUM', body: 'changed logic has no test' },
    { path: 'src/x.ts', line: 9, severity: 'LOW', body: 'nit that can wait' },
  ]) +
  '\n```\n\nFLEET-VERDICT: PASS';

describe('XO integration — editor pass', () => {
  it('applies a mocked edit list: the dropped duplicate never reaches the comment', async () => {
    state.files.set('main:pd-fleet.yml', shipYaml({ name: 'spark', ideation: true, xo: true }));
    const kv = memoryKV();
    seedToken(kv, 42);
    const { ai, counters } = xoAwareAi(aiStub({ perShip: { spark: TWO_PROPOSALS } }), {
      editorOutput:
        '<think>1 duplicates 0</think>\n```json\n' +
        '[{"op":"keep","index":0},{"op":"drop","index":1,"duplicateOf":"Wire the relay dashboard"}]\n```',
    });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    expect(counters.editor).toBe(1);
    const bodies = commentBodiesOf(state);
    expect(bodies.some(b => b.includes('Wire the relay dashboard'))).toBe(true);
    expect(bodies.some(b => b.includes('Wire the relay dashboards'))).toBe(false);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('editor failure ⇒ the ORIGINAL batch survives (cosine-only fallback path)', async () => {
    state.files.set('main:pd-fleet.yml', shipYaml({ name: 'spark', ideation: true, xo: true }));
    const kv = memoryKV();
    seedToken(kv, 42);
    const { ai, counters } = xoAwareAi(aiStub({ perShip: { spark: TWO_PROPOSALS } }), {
      throwOnXo: true,
    });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    expect(counters.editor).toBe(1);
    const bodies = commentBodiesOf(state);
    // BOTH proposals reach the comment untouched — nothing lost to the XO outage.
    expect(bodies.some(b => b.includes('Wire the relay dashboard'))).toBe(true);
    expect(bodies.some(b => b.includes('Wire the relay dashboards'))).toBe(true);
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('retryable editor dependency failure propagates to the queue before later work', async () => {
    state.files.set('main:pd-fleet.yml', shipYaml({ name: 'spark', ideation: true, xo: true }));
    const kv = memoryKV();
    seedToken(kv, 42);
    const { ai, counters } = xoAwareAi(aiStub({ perShip: { spark: TWO_PROPOSALS } }), {
      retryableXoFailure: true,
    });

    await expect(executeFleet(
      makeJob(),
      makeEnv({ FLEET_TOKENS: kv, AI: ai }),
      { queueAttempt: 1 },
    )).rejects.toBeInstanceOf(FleetAiDependencyError);

    expect(counters.editor).toBe(1);
    expect(state.completed).toHaveLength(0);
  });

  it('xo flag default-off: no XO call is ever made without `xo: true`', async () => {
    state.files.set('main:pd-fleet.yml', shipYaml({ name: 'spark', ideation: true }));
    const kv = memoryKV();
    seedToken(kv, 42);
    const { ai, counters } = xoAwareAi(aiStub({ perShip: { spark: TWO_PROPOSALS } }), {
      editorOutput: '[{"op":"drop","index":0}]',
    });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    expect(counters.editor).toBe(0);
    expect(counters.triage).toBe(0);
    const bodies = commentBodiesOf(state);
    expect(bodies.some(b => b.includes('Wire the relay dashboard'))).toBe(true);
    expect(bodies.some(b => b.includes('Wire the relay dashboards'))).toBe(true);
  });
});

describe('XO integration — advisory triage', () => {
  it('appends the "XO\'s orders" section to the review; check summary + conclusion untouched', async () => {
    state.files.set('main:pd-fleet.yml', shipYaml({ name: 'qa', xo: true }));
    const kv = memoryKV();
    seedToken(kv, 42);
    const { ai, counters } = xoAwareAi(aiStub({ perShip: { qa: QA_FINDINGS } }), {
      triageOutput:
        '<think>#0 is on the diff, #1 is a nit</think>{"orders":[{"index":0,"why":"directly on the changed lines"}]}',
    });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    expect(counters.triage).toBe(1);
    expect(state.reviews).toHaveLength(1);
    const body = state.reviews[0].body;
    expect(body).toContain("XO's orders");
    expect(body).toContain('directly on the changed lines');
    expect(body).toContain('changed logic has no test');
    expect(body).toContain('1 other advisory finding'); // the nit: counted, not hidden
    // The gate is untouched: advisory qa PASS ⇒ success, and the CHECK summary
    // (not the review body) carries no XO section.
    expect(state.completed[0].conclusion).toBe('success');
    expect(state.completed[0].summary).not.toContain("XO's orders");
  });

  it('triage failure ⇒ the review comment renders EXACTLY as today', async () => {
    state.files.set('main:pd-fleet.yml', shipYaml({ name: 'qa', xo: true }));
    const kv = memoryKV();
    seedToken(kv, 42);
    const { ai, counters } = xoAwareAi(aiStub({ perShip: { qa: QA_FINDINGS } }), {
      throwOnXo: true,
    });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai }));

    expect(counters.triage).toBe(1);
    expect(state.reviews).toHaveLength(1);
    const body = state.reviews[0].body;
    expect(body).not.toContain("XO's orders");
    // The human review body remains unchanged; only the bot-owned check output
    // gains the machine-readable generation receipt on its first line.
    expect(state.completed[0].summary).toBe(
      `${state.completed[0].summary.split('\n')[0]}\n${body}`,
    );
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('retryable triage dependency failure returns to the queue while budget remains', async () => {
    state.files.set('main:pd-fleet.yml', shipYaml({ name: 'qa', xo: true }));
    const kv = memoryKV();
    seedToken(kv, 42);
    const { ai, counters } = xoAwareAi(aiStub({ perShip: { qa: QA_FINDINGS } }), {
      retryableXoFailure: true,
    });

    await expect(executeFleet(
      makeJob(),
      makeEnv({ FLEET_TOKENS: kv, AI: ai }),
      { queueAttempt: 1 },
    )).rejects.toBeInstanceOf(FleetAiDependencyError);

    expect(counters.triage).toBe(1);
    expect(state.completed).toHaveLength(0);
  });

  it('disables optional triage after its final provider attempt without changing the verdict', async () => {
    state.files.set('main:pd-fleet.yml', shipYaml({ name: 'qa', xo: true }));
    const kv = memoryKV();
    seedToken(kv, 42);
    const { ai, counters } = xoAwareAi(aiStub({ perShip: { qa: QA_FINDINGS } }), {
      retryableXoFailure: true,
    });

    await executeFleet(
      makeJob(),
      makeEnv({ FLEET_TOKENS: kv, AI: ai }),
      { queueAttempt: 3 },
    );

    expect(counters.triage).toBe(1);
    expect(state.completed[0].conclusion).toBe('success');
    expect(state.reviews[0].body).not.toContain("XO's orders");
  });
});

describe('semantic idea capture — shared provider circuit', () => {
  it('returns a retryable embedding failure to the queue instead of hanging best-effort capture', async () => {
    state.files.set('main:pd-fleet.yml', shipYaml({ name: 'spark', ideation: true }));
    const kv = memoryKV();
    const d1 = memoryD1();
    const db = {
      prepare(sql: string) {
        const statement = d1.db.prepare(sql);
        return {
          bind: (...args: unknown[]) => statement.bind(...args),
          run: async () => ({ success: true, meta: {} }),
        };
      },
    } as unknown as D1Database;
    seedToken(kv, 42);
    const { ai } = xoAwareAi(aiStub({ perShip: { spark: TWO_PROPOSALS } }), {
      retryableEmbeddingFailure: true,
    });

    await expect(executeFleet(
      makeJob(),
      makeEnv({ FLEET_TOKENS: kv, DB: db, AI: ai }),
      { queueAttempt: 1 },
    )).rejects.toBeInstanceOf(FleetAiDependencyError);

    expect(state.completed).toHaveLength(0);
    const embeddingCalls = (ai.run as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([, args]) => !(args as { messages?: unknown }).messages,
    );
    expect(embeddingCalls).toHaveLength(1);
  });
});
