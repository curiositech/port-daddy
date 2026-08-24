/**
 * Raw session transcript read path (fleet-run-page.ts's
 * handleFleetRunTranscript + the run page's per-ship transcript links) —
 * Phase 1 of docs/FLEET-SESSION-TRANSCRIPTS.md.
 *
 * The invariants under test:
 *   1. The route enforces EXACTLY the run page's capability scheme: operator
 *      bearer or `?t=<hmac>` opens it; nothing else does, and every failure —
 *      bad ship, no rows, no object, no access — is an indistinguishable 404.
 *   2. `?attempt=N` selects an attempt; default is the NEWEST.
 *   3. The page renders a raw-transcript link per ship with a captured
 *      transcript, carrying the viewer's own token onward.
 */

import { describe, it, expect } from 'vitest';
import {
  handleFleetRunTranscript,
  handleFleetRunTranscriptIndex,
  renderFleetRunReceiptPage,
} from '../src/fleet-run-page.js';
import type { Env } from '../src/types.js';
import type { FleetRunStepRow } from '../src/db.js';

const RUN_ID = 'run:11111111-2222-3333-4444-555555555555';
const OPERATOR = 'op-token-0123456789abcdef0123456789abcdef';

interface IndexRow {
  ship: string;
  attempt: number;
  r2_key: string;
  turns?: number;
  bytes?: number;
  models_csv?: string;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  cost_usd?: number | null;
  incomplete?: number;
  created_at?: number;
}

/**
 * Minimal Env: a D1 serving fleet_run_transcripts rows + an R2 with objects.
 * The mock honors the query's bind params — the ship-scoped variant
 * (`AND ship = ?`) filters here exactly as the real index would, so the
 * handlers' scoping is actually under test, not papered over.
 */
function makeEnv(rows: IndexRow[], objects: Record<string, string>): Env {
  const db = {
    prepare: (sql: string) => ({
      bind: (...bound: unknown[]) => ({
        all: async () => {
          if (sql.includes('fleet_run_transcripts')) {
            const ship = sql.includes('AND ship = ?') ? bound[1] : undefined;
            const filtered = rows
              .filter(r => ship === undefined || r.ship === ship)
              .slice()
              .sort((a, b) => (a.ship < b.ship ? -1 : a.ship > b.ship ? 1 : b.attempt - a.attempt));
            return { results: filtered };
          }
          return { results: [] };
        },
        first: async () => null,
        run: async () => ({ success: true, meta: { changes: 0 } }),
      }),
    }),
  };
  const bucket = {
    get: async (key: string) =>
      key in objects
        ? ({ body: objects[key], text: async () => objects[key] } as unknown as R2ObjectBody)
        : null,
  };
  return {
    DB: db,
    TRANSCRIPTS: bucket,
    RELAY_OPERATOR_TOKEN: OPERATOR,
  } as unknown as Env;
}

function req(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://relay.example${path}`, { headers });
}

const AUTH = { Authorization: `Bearer ${OPERATOR}` };
const ROWS: IndexRow[] = [
  { ship: 'qa', attempt: 2, r2_key: 'v1/run/qa.2.jsonl' },
  { ship: 'qa', attempt: 1, r2_key: 'v1/run/qa.1.jsonl' },
];
const OBJECTS = {
  'v1/run/qa.2.jsonl': '{"v":1,"seq":0}\n',
  'v1/run/qa.1.jsonl': '{"v":1,"seq":99}\n',
};

describe('handleFleetRunTranscript', () => {
  it('streams the NEWEST attempt as ndjson under operator bearer auth', async () => {
    const res = await handleFleetRunTranscript(
      req(`/fleet/runs/${RUN_ID}/transcript/qa.jsonl`, AUTH),
      makeEnv(ROWS, OBJECTS),
      RUN_ID,
      'qa',
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/x-ndjson');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.text()).toBe('{"v":1,"seq":0}\n');
  });

  it('selects an explicit ?attempt=N', async () => {
    const res = await handleFleetRunTranscript(
      req(`/fleet/runs/${RUN_ID}/transcript/qa.jsonl?attempt=1`, AUTH),
      makeEnv(ROWS, OBJECTS),
      RUN_ID,
      'qa',
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"v":1,"seq":99}\n');
  });

  it('404s without any credential — token possession IS the authorization', async () => {
    const res = await handleFleetRunTranscript(
      req(`/fleet/runs/${RUN_ID}/transcript/qa.jsonl`),
      makeEnv(ROWS, OBJECTS),
      RUN_ID,
      'qa',
    );
    expect(res.status).toBe(404);
  });

  it('404s indistinguishably: unknown ship, unknown attempt, missing object, no bucket', async () => {
    const env = makeEnv(ROWS, OBJECTS);
    for (const path of [
      `/fleet/runs/${RUN_ID}/transcript/ghost.jsonl`,
      `/fleet/runs/${RUN_ID}/transcript/qa.jsonl?attempt=7`,
    ]) {
      const ship = path.includes('ghost') ? 'ghost' : 'qa';
      expect((await handleFleetRunTranscript(req(path, AUTH), env, RUN_ID, ship)).status).toBe(404);
    }
    const missingObject = makeEnv(ROWS, {});
    expect(
      (
        await handleFleetRunTranscript(
          req(`/fleet/runs/${RUN_ID}/transcript/qa.jsonl`, AUTH),
          missingObject,
          RUN_ID,
          'qa',
        )
      ).status,
    ).toBe(404);
    const noBucket = { ...makeEnv(ROWS, OBJECTS), TRANSCRIPTS: undefined } as unknown as Env;
    expect(
      (
        await handleFleetRunTranscript(
          req(`/fleet/runs/${RUN_ID}/transcript/qa.jsonl`, AUTH),
          noBucket,
          RUN_ID,
          'qa',
        )
      ).status,
    ).toBe(404);
  });

  it('slices with ?after=<seq> — only envelopes strictly beyond the watermark, seq-less lines omitted', async () => {
    const objects = {
      'v1/run/qa.2.jsonl':
        '{"v":1,"seq":0}\n{"v":1,"seq":1}\nnot-json\n{"v":1,"seq":2}\n{"no-seq":true}\n',
    };
    const env = makeEnv([{ ship: 'qa', attempt: 2, r2_key: 'v1/run/qa.2.jsonl' }], objects);
    const sliced = await handleFleetRunTranscript(
      req(`/fleet/runs/${RUN_ID}/transcript/qa.jsonl?after=0`, AUTH),
      env,
      RUN_ID,
      'qa',
    );
    expect(sliced.status).toBe(200);
    expect(await sliced.text()).toBe('{"v":1,"seq":1}\n{"v":1,"seq":2}\n');
    // Caught up: an empty (but 200) body, not a 404 — the transcript exists.
    const caughtUp = await handleFleetRunTranscript(
      req(`/fleet/runs/${RUN_ID}/transcript/qa.jsonl?after=2`, AUTH),
      env,
      RUN_ID,
      'qa',
    );
    expect(caughtUp.status).toBe(200);
    expect(await caughtUp.text()).toBe('');
    // A non-numeric after is ignored — the full raw object streams.
    const raw = await handleFleetRunTranscript(
      req(`/fleet/runs/${RUN_ID}/transcript/qa.jsonl?after=zzz`, AUTH),
      env,
      RUN_ID,
      'qa',
    );
    expect(await raw.text()).toContain('not-json');
  });

  it('rejects path-hostile ship names and run ids before touching storage', async () => {
    const env = makeEnv(ROWS, OBJECTS);
    expect(
      (
        await handleFleetRunTranscript(
          req(`/fleet/runs/${RUN_ID}/transcript/x.jsonl`, AUTH),
          env,
          RUN_ID,
          '../secrets',
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handleFleetRunTranscript(
          req(`/fleet/runs/bad/transcript/qa.jsonl`, AUTH),
          env,
          'run:..:up',
          'qa',
        )
      ).status,
    ).toBe(404);
  });
});

describe('handleFleetRunTranscriptIndex (transcripts.json — Phase 3)', () => {
  const LEDGER: IndexRow[] = [
    {
      ship: 'qa', attempt: 2, r2_key: 'v1/run/qa.2.jsonl', turns: 9, bytes: 4200,
      models_csv: '@cf/test/model', prompt_tokens: 1000, completion_tokens: 200,
      cost_usd: 0.0031, incomplete: 0, created_at: 1_700_000_100,
    },
    {
      ship: 'purser', attempt: 2, r2_key: 'v1/run/purser.2.jsonl', turns: 14, bytes: 9000,
      models_csv: '@cf/test/model,@cf/test/plan', prompt_tokens: null, completion_tokens: null,
      cost_usd: null, incomplete: 1, created_at: 1_700_000_090,
    },
  ];

  it('serves the full ledger — outcome columns, split models, paths — under bearer auth', async () => {
    const res = await handleFleetRunTranscriptIndex(
      req(`/fleet/runs/${RUN_ID}/transcripts.json`, AUTH),
      makeEnv(LEDGER, {}),
      RUN_ID,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as {
      runId: string;
      transcripts: Array<Record<string, unknown>>;
    };
    expect(body.runId).toBe(RUN_ID);
    expect(body.transcripts).toHaveLength(2);
    const qa = body.transcripts.find(t => t.ship === 'qa');
    expect(qa).toMatchObject({
      attempt: 2, turns: 9, bytes: 4200, models: ['@cf/test/model'],
      promptTokens: 1000, completionTokens: 200, costUsd: 0.0031, incomplete: false,
    });
    expect(qa?.viewerPath).toBe(`/fleet/runs/${encodeURIComponent(RUN_ID)}/transcript/qa?attempt=2`);
    expect(qa?.jsonlPath).toBe(`/fleet/runs/${encodeURIComponent(RUN_ID)}/transcript/qa.jsonl?attempt=2`);
    const purser = body.transcripts.find(t => t.ship === 'purser');
    expect(purser).toMatchObject({ models: ['@cf/test/model', '@cf/test/plan'], incomplete: true });
  });

  it('ignores stray query params (?after= belongs to the .jsonl route) — full ledger, 200', async () => {
    const res = await handleFleetRunTranscriptIndex(
      req(`/fleet/runs/${RUN_ID}/transcripts.json?after=3&attempt=1`, AUTH),
      makeEnv(LEDGER, {}),
      RUN_ID,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transcripts: unknown[] };
    expect(body.transcripts).toHaveLength(2); // unsliced, unfiltered
  });

  it('404s indistinguishably: no credential, hostile run id, empty ledger', async () => {
    const env = makeEnv(LEDGER, {});
    expect(
      (await handleFleetRunTranscriptIndex(req(`/fleet/runs/${RUN_ID}/transcripts.json`), env, RUN_ID)).status,
    ).toBe(404);
    expect(
      (await handleFleetRunTranscriptIndex(req(`/x`, AUTH), env, 'run:..:up')).status,
    ).toBe(404);
    expect(
      (
        await handleFleetRunTranscriptIndex(
          req(`/fleet/runs/${RUN_ID}/transcripts.json`, AUTH),
          makeEnv([], {}),
          RUN_ID,
        )
      ).status,
    ).toBe(404);
  });
});

describe('run page raw-transcript links', () => {
  const STEP: FleetRunStepRow = {
    run_id: RUN_ID,
    seq: 1,
    kind: 'map-chunk',
    ship: 'qa',
    title: 'MAP chunk 1/1',
    detail: JSON.stringify({}),
    created_at: 1_700_000_005,
  };
  const RUN = {
    id: RUN_ID,
    delivery_id: 'd1',
    repo_full_name: 'octo/widgets',
    pr_number: 7,
    pr_url: 'https://github.com/octo/widgets/pull/7',
    head_sha: 'a'.repeat(40),
    conclusion: 'success',
    ships_csv: 'qa',
    neurons: null,
    ms: 1000,
    created_at: 1_700_000_000,
    logical_state: 'success',
    generation: 1,
    attempt_count: 1,
    queued_at: 1_700_000_000,
    started_at: 1_700_000_000,
    last_progress_at: 1_700_000_000,
    finished_at: 1_700_000_001,
    superseded_by: null,
    last_error: null,
    expected_start_at: null,
    expected_finish_at: null,
    queue_ahead_estimate: null,
    has_transcript: true,
  };

  it('renders each ship\'s link (token-carrying) and none when nothing was captured', () => {
    const href = `/fleet/runs/${encodeURIComponent(RUN_ID)}/transcript/qa.jsonl?t=v1.abc`;
    const withLink = renderFleetRunReceiptPage(RUN as never, [STEP], {
      meta: null,
      diff: null,
      generations: [],
      transcripts: [{ ship: 'qa', attempt: 2, href }],
    });
    expect(withLink).toContain('Raw session transcript (JSONL)');
    expect(withLink).toContain('t=v1.abc');
    const withoutLink = renderFleetRunReceiptPage(RUN as never, [STEP], {
      meta: null,
      diff: null,
      generations: [],
    });
    expect(withoutLink).not.toContain('Raw session transcript');
  });
});
