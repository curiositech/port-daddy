/**
 * pd-transcript.v1 HTML viewer (Phase 2 — docs/FLEET-SESSION-TRANSCRIPTS.md):
 * the no-script turn-card timeline served at /fleet/runs/:id/transcript/:ship.
 *
 * Invariants under test:
 *   1. Same authorization as the receipt and the .jsonl route — no credential
 *      ⇒ 404, indistinguishable from a missing transcript.
 *   2. Model output renders ESCAPED — a transcript is untrusted model text and
 *      the page ships under a no-script CSP; an unescaped '<script>' here would
 *      be a stored-XSS-shaped defect even with CSP as the backstop.
 *   3. The format's own affordances render: sysRef repeats point at the first
 *      occurrence, truncation is explicitly badged, malformed / unknown-major
 *      lines are skipped WITH an honest notice, never silently.
 *   4. The viewer links the raw .jsonl and the run receipt, carrying the
 *      viewer's own capability token onward.
 */

import { describe, it, expect } from 'vitest';
import {
  handleFleetRunTranscriptPage,
  renderTranscriptViewerPage,
} from '../src/fleet-run-page.js';
import type { Env } from '../src/types.js';

const RUN_ID = 'run:11111111-2222-3333-4444-555555555555';
const OPERATOR = 'op-token-0123456789abcdef0123456789abcdef';
const AUTH = { Authorization: `Bearer ${OPERATOR}` };

function turn(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    runId: RUN_ID,
    ship: 'qa',
    attempt: 2,
    seq: 0,
    phase: 'map',
    chunk: { index: 0, count: 2 },
    kind: 'assistant',
    model: '@cf/test/model',
    ts: 1_700_000_000,
    latencyMs: 4200,
    usage: { prompt: 100, completion: 20 },
    costUsd: 0.0012,
    content: [{ type: 'text', text: 'FLEET-VERDICT: PASS' }],
    sysRef: null,
    truncated: false,
    ...over,
  };
}

const JSONL =
  [
    turn({ seq: 0, kind: 'system', content: [{ type: 'text', text: 'You are pd-qa.' }], sysRef: 'fnv1a:aa:14' }),
    turn({ seq: 1, kind: 'user', content: [{ type: 'text', text: 'diff chunk one' }] }),
    turn({ seq: 2, kind: 'assistant' }),
    turn({ seq: 3, kind: 'system', content: [], sysRef: 'fnv1a:aa:14' }),
    turn({ seq: 4, kind: 'error', content: [{ type: 'text', text: 'Workers AI 429' }], truncated: true }),
    turn({ seq: 5, kind: 'assistant', content: [{ type: 'text', text: '<script>alert(1)</script>' }] }),
  ]
    .map(t => JSON.stringify(t))
    .join('\n') + '\nnot-json-at-all\n' + JSON.stringify(turn({ seq: 9, v: 2 })) + '\n';

function makeEnv(objects: Record<string, string>): Env {
  const rows = [
    { ship: 'qa', attempt: 2, r2_key: 'v1/run/qa.2.jsonl' },
    { ship: 'qa', attempt: 1, r2_key: 'v1/run/qa.1.jsonl' },
  ];
  return {
    DB: {
      prepare: (sql: string) => ({
        bind: (...bound: unknown[]) => ({
          // Honors the ship-scoped bind (`AND ship = ?`) like the real index
          // would, so the handler's D1-side scoping is genuinely under test.
          all: async () => ({
            results: sql.includes('fleet_run_transcripts')
              ? rows.filter(r => !sql.includes('AND ship = ?') || r.ship === bound[1])
              : [],
          }),
          first: async () => null,
          run: async () => ({ success: true, meta: { changes: 0 } }),
        }),
      }),
    },
    TRANSCRIPTS: {
      get: async (key: string) =>
        key in objects ? ({ text: async () => objects[key] } as unknown as R2ObjectBody) : null,
    },
    RELAY_OPERATOR_TOKEN: OPERATOR,
  } as unknown as Env;
}

function req(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://relay.example${path}`, { headers });
}

describe('handleFleetRunTranscriptPage', () => {
  const env = makeEnv({ 'v1/run/qa.2.jsonl': JSONL, 'v1/run/qa.1.jsonl': JSON.stringify(turn({ seq: 0 })) + '\n' });

  it('serves the newest attempt as a no-store HTML timeline under bearer auth', async () => {
    const res = await handleFleetRunTranscriptPage(
      req(`/fleet/runs/${RUN_ID}/transcript/qa`, AUTH),
      env,
      RUN_ID,
      'qa',
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain('raw session transcript');
    expect(html).toContain('id="t2"');
    expect(html).toContain('FLEET-VERDICT: PASS');
  });

  it('escapes model output — a transcript is untrusted text', async () => {
    const res = await handleFleetRunTranscriptPage(
      req(`/fleet/runs/${RUN_ID}/transcript/qa`, AUTH),
      env,
      RUN_ID,
      'qa',
    );
    const html = await res.text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('404s without any credential and selects ?attempt=N with one', async () => {
    expect(
      (await handleFleetRunTranscriptPage(req(`/fleet/runs/${RUN_ID}/transcript/qa`), env, RUN_ID, 'qa')).status,
    ).toBe(404);
    const res = await handleFleetRunTranscriptPage(
      req(`/fleet/runs/${RUN_ID}/transcript/qa?attempt=1`, AUTH),
      env,
      RUN_ID,
      'qa',
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('attempt 1');
  });

  it('survives corrupt envelopes: wrong-typed content counts as malformed; garbage usage/chunk render without invented metrics', async () => {
    const corrupt =
      [
        turn({ seq: 0 }),
        turn({ seq: 1, content: 'not-an-array' }),
        turn({ seq: 2, content: { type: 'text', text: 'object-not-array' } }),
        turn({ seq: 3, usage: { prompt: 'NaN', completion: 20 } }),
        turn({ seq: 4, chunk: { index: 'x', count: 2 } }),
        turn({ seq: 5, latencyMs: -4200 }),
      ]
        .map(t => JSON.stringify(t))
        .join('\n') + '\n';
    const res = await handleFleetRunTranscriptPage(
      req(`/fleet/runs/${RUN_ID}/transcript/qa`, AUTH),
      makeEnv({ 'v1/run/qa.2.jsonl': corrupt }),
      RUN_ID,
      'qa',
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('2 malformed line(s)');
    expect(html).toContain('id="t3"'); // garbage-usage turn still renders…
    expect(html).not.toContain('NaN in'); // …but with its metrics dropped, not invented
    expect(html).toContain('id="t4"');
    expect(html).not.toContain('object-not-array');
    expect(html).toContain('id="t5"'); // negative-latency turn renders…
    expect(html).not.toContain('-4.2s'); // …without a nonsense negative duration
  });

  it('404s on unknown ship, missing object, absent bucket, hostile names', async () => {
    expect(
      (await handleFleetRunTranscriptPage(req(`/fleet/runs/${RUN_ID}/transcript/ghost`, AUTH), env, RUN_ID, 'ghost'))
        .status,
    ).toBe(404);
    expect(
      (
        await handleFleetRunTranscriptPage(
          req(`/fleet/runs/${RUN_ID}/transcript/qa`, AUTH),
          makeEnv({}),
          RUN_ID,
          'qa',
        )
      ).status,
    ).toBe(404);
    const noBucket = { ...env, TRANSCRIPTS: undefined } as unknown as Env;
    expect(
      (await handleFleetRunTranscriptPage(req(`/fleet/runs/${RUN_ID}/transcript/qa`, AUTH), noBucket, RUN_ID, 'qa'))
        .status,
    ).toBe(404);
    expect(
      (await handleFleetRunTranscriptPage(req(`/x`, AUTH), env, RUN_ID, '../up')).status,
    ).toBe(404);
  });
});

describe('renderTranscriptViewerPage', () => {
  const parsedTurns = JSONL.split('\n')
    .filter(Boolean)
    .map(l => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((t): t is ReturnType<typeof turn> => t !== null && (t as { v?: number }).v === 1) as never[];

  const page = renderTranscriptViewerPage({
    runId: RUN_ID,
    ship: 'qa',
    attempt: 2,
    attempts: [2, 1],
    turns: parsedTurns,
    badLines: 1,
    unsupportedVersion: 1,
    tokenSuffix: 'v1.abc',
  });

  it('renders phase chips, kind chips, per-turn metrics, and the truncation badge', () => {
    expect(page).toContain('MAP 1/2');
    expect(page).toContain('SYSTEM');
    expect(page).toContain('ERROR');
    expect(page).toContain('TRUNCATED');
    expect(page).toContain('100 in / 20 out');
  });

  it('resolves a sysRef repeat to a link at the first occurrence', () => {
    expect(page).toContain('same system prompt as <a href="#t0">#t0</a>');
  });

  it('reports skipped material honestly instead of pretending completeness', () => {
    expect(page).toContain('1 malformed line(s) and 1 unsupported-version envelope(s) were skipped');
  });

  it('links the run receipt, other attempts, and the raw JSONL — all token-carrying', () => {
    expect(page).toContain(`/fleet/runs/${encodeURIComponent(RUN_ID)}?t=v1.abc`);
    expect(page).toContain('?attempt=1&t=v1.abc');
    expect(page).toContain('.jsonl?attempt=2&t=v1.abc');
  });

  it('folds prompts in <details> — the page carries zero scripts', () => {
    expect(page).toContain('<details><summary>system prompt');
    expect(page).toContain('<details><summary>user message');
    expect(page).not.toContain('<script');
  });
});
