/**
 * Building a successor's warm brief from a dead body's transcript.
 *
 * The handoff machinery — capsule schema, fail-closed sanitizer, successor
 * prompt renderer, the /continue route that picks native resume vs sanitized
 * handoff — was all built and wired, and NOTHING ever constructed a capsule.
 * Every path took one from a client. This suite pins the producer, and pins the
 * two properties that make it safe to run inside a failure:
 *
 *   - it degrades to null (cold successor) rather than throwing, because it runs
 *     while a dispatch is already dying;
 *   - it does NOT degrade past the secret scanner. A capsule that cannot be
 *     proven clean is not sent at a lower standard.
 *
 * And the property that makes it useful: a capsule is a BRIEF, not a replay. The
 * successor gets the objective, what a human actually said, a bounded tail, and
 * pointers — not the predecessor's whole conversation.
 */

import { describe, test, expect } from '@jest/globals';

const { draftCapsule, findTranscriptForDispatch, buildHandoffFromTranscript } = await import(
  '../../lib/dispatch/handoff-from-transcript.js'
);

/** A gitleaks runner that always reports clean, so tests don't shell out. */
const cleanScanner = () => ({ ok: true, findings: [] });

function dispatchLike(over = {}) {
  return {
    id: 'disp-1',
    goal: 'Write a 400-word design note on salvage vs reap',
    tags: [],
    baseBranch: 'main',
    mergePolicy: 'review',
    requestedBy: 'operator',
    backend: 'cli:codex',
    budgetUsd: 1,
    costUsd: null,
    timeoutMs: null,
    sessionId: 'sess-1',
    worktreePath: '/tmp/wt/disp-1',
    branch: 'dispatch/note-disp1',
    spawnedAgentId: 'agent-77',
    failoverAttempt: 0,
    failoverChain: null,
    ...over,
  };
}

function transcriptLike(over = {}) {
  return {
    id: 't-1',
    ship: 'dispatch',
    session_id: 'sess-1',
    spawned_agent_id: 'agent-77',
    trigger: 'dispatch',
    backend: 'cli:codex',
    model: 'gpt-5.3-codex',
    status: 'failed',
    started_at: 1_700_000_000_000,
    project: 'port-daddy',
    messages: [
      { role: 'user', content: 'Write the note. Cover why salvage preserves the worktree.', timestamp: 1_700_000_001_000 },
      { role: 'assistant', content: 'Reading lib/dispatch/worker.ts…', timestamp: 1_700_000_002_000 },
      { role: 'tool', content: 'worker.ts:351 branches on salvage', timestamp: 1_700_000_003_000 },
      { role: 'assistant', content: 'Draft outline: 1. reap destroys evidence…', timestamp: 1_700_000_004_000 },
    ],
    outputs: [{ type: 'pr', url: 'https://github.com/x/y/pull/1', summary: 'draft PR' }],
    ...over,
  };
}

/** A transcripts module stub with just the two reads the extractor uses. */
function transcriptsStub(entries) {
  return {
    listTranscripts: ({ agentId } = {}) =>
      entries.filter((e) => !agentId || e.spawned_agent_id === agentId),
    getTranscript: (id) => entries.find((e) => e.id === id) ?? null,
  };
}

describe('findTranscriptForDispatch', () => {
  test('joins on spawnedAgentId — the column that made the join possible at all', () => {
    const found = findTranscriptForDispatch(dispatchLike(), {
      transcripts: transcriptsStub([transcriptLike()]),
    });
    expect(found.id).toBe('t-1');
  });

  test('a dispatch with no recorded agent id has no transcript to draw on', () => {
    const found = findTranscriptForDispatch(dispatchLike({ spawnedAgentId: null }), {
      transcripts: transcriptsStub([transcriptLike()]),
    });
    expect(found).toBeNull();
  });

  test('picks the newest run when a body wrote more than one', () => {
    const older = transcriptLike({ id: 't-old', started_at: 1_600_000_000_000 });
    const newer = transcriptLike({ id: 't-new', started_at: 1_800_000_000_000 });
    const found = findTranscriptForDispatch(dispatchLike(), {
      transcripts: transcriptsStub([older, newer]),
    });
    expect(found.id).toBe('t-new');
  });

  test('a throwing transcript store yields null, never an exception', () => {
    // This runs while a dispatch is dying; an exception here converts a
    // recoverable failure into a dead dispatch.
    const found = findTranscriptForDispatch(dispatchLike(), {
      transcripts: {
        listTranscripts: () => {
          throw new Error('db is gone');
        },
        getTranscript: () => null,
      },
    });
    expect(found).toBeNull();
  });
});

describe('draftCapsule — a brief, not a replay', () => {
  const capsule = draftCapsule(
    dispatchLike(),
    transcriptLike(),
    'cli:codex',
    'cli:claude-code',
    () => 1_700_000_010_000,
  );

  test('the objective survives the body change unchanged', () => {
    expect(capsule.telos).toBe('Write a 400-word design note on salvage vs reap');
  });

  test('operator turns are carried — the successor cannot re-derive what a human said', () => {
    expect(capsule.operatorTurns).toHaveLength(1);
    expect(capsule.operatorTurns[0].text).toMatch(/why salvage preserves the worktree/);
  });

  test('artifacts are carried as POINTERS, so the successor looks rather than believes', () => {
    expect(capsule.artifacts[0].path).toBe('https://github.com/x/y/pull/1');
  });

  test('the workspace names where to verify, and the source names both ends of the hop', () => {
    expect(capsule.workspace.branch).toBe('dispatch/note-disp1');
    expect(capsule.source.adapter).toBe('cli:codex');
    expect(capsule.target.adapter).toBe('cli:claude-code');
    expect(capsule.source.transcriptRef).toBe('t-1');
    expect(capsule.source.workflowId).toBe('disp-1');
  });

  test('the tail is bounded, and reports what it omitted rather than hiding it', () => {
    const long = transcriptLike({
      messages: Array.from({ length: 40 }, (_, i) => ({
        role: 'assistant',
        content: `step ${i}`,
        timestamp: 1_700_000_000_000 + i,
      })),
    });
    const c = draftCapsule(dispatchLike(), long, 'cli:codex', 'cli:agy');
    expect(c.tail.length).toBeLessThanOrEqual(8);
    expect(c.budget.omitted.tail).toBeGreaterThan(0);
  });

  test('a single enormous message cannot become the whole brief', () => {
    const huge = transcriptLike({
      messages: [{ role: 'user', content: 'x'.repeat(50_000), timestamp: 1 }],
    });
    const c = draftCapsule(dispatchLike(), huge, 'cli:codex', 'cli:agy');
    expect(c.operatorTurns[0].text.length).toBeLessThan(2_200);
    expect(c.operatorTurns[0].text).toMatch(/truncated for the handoff brief/);
  });
});

describe('buildHandoffFromTranscript', () => {
  test('renders a successor brief that names the succession, not just the goal', async () => {
    const handoff = await buildHandoffFromTranscript({
      dispatch: dispatchLike(),
      fromBackend: 'cli:codex',
      toBackend: 'cli:claude-code',
      deps: {
        transcripts: transcriptsStub([transcriptLike()]),
        sanitizeOptions: { gitleaksRunner: cleanScanner },
      },
    });
    expect(handoff).not.toBeNull();
    expect(handoff.goal).toMatch(/Continue this work on cli:claude-code/);
    expect(handoff.goal).toMatch(/did not finish/);
    // The successor is told to re-verify rather than trust the brief.
    expect(handoff.goal).toMatch(/Revalidate repository and runtime truth/);
    expect(handoff.episodeId).toMatch(/^handoff_/);
  });

  test('no transcript → null, so the caller mints a COLD successor honestly', async () => {
    // A brief built from nothing but the goal IS the cold path. Dressing the
    // goal up as a handoff would claim context that does not exist.
    const handoff = await buildHandoffFromTranscript({
      dispatch: dispatchLike({ spawnedAgentId: null }),
      fromBackend: 'cli:codex',
      toBackend: 'cli:claude-code',
      deps: { transcripts: transcriptsStub([]), sanitizeOptions: { gitleaksRunner: cleanScanner } },
    });
    expect(handoff).toBeNull();
  });

  test('an empty transcript is treated as no transcript', async () => {
    const handoff = await buildHandoffFromTranscript({
      dispatch: dispatchLike(),
      fromBackend: 'cli:codex',
      toBackend: 'cli:claude-code',
      deps: {
        transcripts: transcriptsStub([transcriptLike({ messages: [] })]),
        sanitizeOptions: { gitleaksRunner: cleanScanner },
      },
    });
    expect(handoff).toBeNull();
  });

  test('a capsule that cannot be proven clean is NOT sent at a lower standard', async () => {
    // The one degradation this module refuses. A secret finding means no
    // capsule; the successor goes cold rather than carrying the finding across
    // a harness boundary.
    const handoff = await buildHandoffFromTranscript({
      dispatch: dispatchLike(),
      fromBackend: 'cli:codex',
      toBackend: 'cli:claude-code',
      deps: {
        transcripts: transcriptsStub([transcriptLike()]),
        sanitizeOptions: {
          gitleaksRunner: () => ({ ok: false, findings: [{ ruleId: 'aws-key', line: 3 }] }),
        },
      },
    });
    expect(handoff).toBeNull();
  });

  test('a scanner that cannot run at all also yields a cold successor, not a raw capsule', async () => {
    const handoff = await buildHandoffFromTranscript({
      dispatch: dispatchLike(),
      fromBackend: 'cli:codex',
      toBackend: 'cli:claude-code',
      deps: {
        transcripts: transcriptsStub([transcriptLike()]),
        sanitizeOptions: {
          gitleaksRunner: () => {
            throw new Error('gitleaks binary missing');
          },
        },
      },
    });
    expect(handoff).toBeNull();
  });
});
