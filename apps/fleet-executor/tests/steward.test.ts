/**
 * The steward's safety argument, made executable.
 *
 * Structure mirrors the argument in src/steward.ts:
 *   1. DETERMINISM — the merge gate is synchronous and cannot consult a model.
 *   2. Every precondition, violated INDEPENDENTLY, returns false.
 *   3. The merge/push call sites re-assert the invariants and throw.
 *   4. The dispute path replies and still refuses.
 *   5. Branch/body freshness stays inside the same envelope.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  evaluateMerge,
  evaluateBranchUpdate,
  guardrailFilesIn,
  partitionChecks,
  isSubstantiveDispute,
  classifyDisputes,
  appendStewardChangelog,
  resolveStewardModel,
  mergeFleetPr,
  updateFleetPrBranch,
  refreshFleetPrBody,
  runStewardPass,
  runStewardSweep,
  recordStewardCandidate,
  readPauseForSteward,
  readMergeBudget,
  DEFAULT_STEWARD_MODEL,
  MAX_MERGES_PER_SWEEP,
  CHANGELOG_MARKER,
  type MergeInputs,
  type StewardCandidate,
} from '../src/steward.js';
import type { FleetAuthorship } from '../src/fleet-identity.js';
import type { StewardPrSnapshot } from '../src/github.js';
import { makeEnv, memoryKV } from './harness.js';
import type { ExecutorEnv } from '../src/env.js';

// ---------------------------------------------------------------------------
// Fixtures — a PR that satisfies EVERYTHING, so each test can break exactly one.

const APP = 'port-daddy[bot]';

const OK_AUTHORSHIP: FleetAuthorship = {
  fleetAuthored: true,
  signal: 'app-identity',
  reason: `authored by the fleet's own GitHub App (${APP})`,
  branchMatches: true,
};

function okPr(over: Partial<StewardPrSnapshot> = {}): StewardPrSnapshot {
  return {
    number: 4792,
    title: 'purser: adversarial tests for #4763',
    body: 'Adversarial tests.',
    isDraft: false,
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    headSha: 'HEADSHA',
    headRef: 'purser/pr-4763-tests',
    baseRef: 'main',
    authorLogin: APP,
    authorType: 'Bot',
    reviewDecision: '',
    changedFiles: ['tests/purser/widget.contract.test.ts'],
    checks: [
      { name: 'unit-tests', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'Port Daddy Fleet', status: 'COMPLETED', conclusion: 'NEUTRAL' },
    ],
    checksReported: true,
    threads: [],
    ...over,
  };
}

function okInputs(over: Partial<MergeInputs> = {}): MergeInputs {
  return {
    stewardEnabled: true,
    paused: false,
    authorship: OK_AUTHORSHIP,
    pr: okPr(),
    openThreads: 0,
    mergesThisHour: 0,
    mergesThisSweep: 0,
    ...over,
  };
}

/** An AI binding that FAILS the test if anything calls it. */
function forbiddenAi(): Ai {
  return {
    run: vi.fn(() => {
      throw new Error('the merge gate consulted a model — this must never happen');
    }),
  } as unknown as Ai;
}

function recorder() {
  const steps: Array<{ kind: string; title: string; detail: unknown }> = [];
  return {
    steps,
    transcript: {
      async step(kind: string, _ship: string | null, title: string, detail: unknown) {
        steps.push({ kind, title, detail });
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 1. DETERMINISM

describe('the merge gate is deterministic code, not a model judgment', () => {
  it('evaluateMerge and its whole call graph are SYNCHRONOUS (cannot await a model)', () => {
    // A synchronous function cannot make a network call. This is the structural
    // guarantee that no model output can decide a merge — verifiable from the
    // signature alone, and asserted here so a future `async` cannot slip in.
    for (const fn of [evaluateMerge, evaluateBranchUpdate, guardrailFilesIn, partitionChecks, isSubstantiveDispute, classifyDisputes]) {
      expect(fn.constructor.name).toBe('Function');
      expect(fn.constructor.name).not.toBe('AsyncFunction');
    }
  });

  it('returns a plain boolean decision with no AI binding in scope at all', () => {
    // evaluateMerge takes no env and therefore has no access to env.AI.
    expect(evaluateMerge.length).toBe(1);
    const decision = evaluateMerge(okInputs());
    expect(decision.merge).toBe(true);
    expect(decision.code).toBe('merge');
  });

  it('is a pure function: same inputs, same decision, no hidden state', () => {
    const a = evaluateMerge(okInputs());
    const b = evaluateMerge(okInputs());
    expect(a).toEqual(b);
  });

  it('only ever routes inference through Workers AI `@cf/` ids', () => {
    expect(DEFAULT_STEWARD_MODEL.startsWith('@cf/')).toBe(true);
    expect(resolveStewardModel('@cf/meta/llama-3.1-8b-instruct')).toBe('@cf/meta/llama-3.1-8b-instruct');
    // A foreign id cannot route off Workers AI — it falls back, exactly like
    // resolveXoModel. No Anthropic / OpenAI id is ever honored.
    expect(resolveStewardModel('claude-opus-4-20250514')).toBe(DEFAULT_STEWARD_MODEL);
    expect(resolveStewardModel('gpt-5-mini')).toBe(DEFAULT_STEWARD_MODEL);
    expect(resolveStewardModel(undefined)).toBe(DEFAULT_STEWARD_MODEL);
  });
});

// ---------------------------------------------------------------------------
// 2. EVERY PRECONDITION, INDEPENDENTLY

describe('evaluateMerge refuses on each precondition violation, independently', () => {
  it('baseline: the fixture merges (so each case below breaks exactly one thing)', () => {
    expect(evaluateMerge(okInputs()).merge).toBe(true);
  });

  it.each<[string, Partial<MergeInputs>, string]>([
    ['tenant has not opted in', { stewardEnabled: false }, 'steward-disabled'],
    ['fleet kill switch set', { paused: true }, 'fleet-paused'],
    ['kill switch UNREADABLE', { paused: null }, 'pause-unreadable'],
    ['PR snapshot unavailable', { pr: null }, 'snapshot-unavailable'],
    ['authorship unclassifiable', { authorship: null }, 'authorship-unknown'],
    [
      'PR authored by a human',
      {
        authorship: {
          fleetAuthored: false,
          signal: 'none',
          reason: 'author mallory is type "User"',
          branchMatches: true,
        },
      },
      'not-fleet-authored',
    ],
    [
      'authorship only on the WEAK branch signal',
      {
        authorship: {
          fleetAuthored: true,
          signal: 'bot-and-branch',
          reason: 'weak',
          branchMatches: true,
        },
      },
      'authorship-unknown',
    ],
    ['PR is closed', { pr: okPr({ state: 'CLOSED' }) }, 'pr-not-open'],
    ['PR is a draft', { pr: okPr({ isDraft: true }) }, 'pr-draft'],
    [
      'diff modifies a CI workflow',
      { pr: okPr({ changedFiles: ['.github/workflows/ci.yml'] }) },
      'guardrail-modification',
    ],
    [
      'diff modifies a PR gate script',
      { pr: okPr({ changedFiles: ['scripts/check-pr-requirements.mjs'] }) },
      'guardrail-modification',
    ],
    [
      'diff modifies the permission tiers',
      { pr: okPr({ changedFiles: ['cli/permission-tiers.ts'] }) },
      'guardrail-modification',
    ],
    [
      'diff modifies the stewards own source',
      { pr: okPr({ changedFiles: ['apps/fleet-executor/src/steward.ts'] }) },
      'guardrail-modification',
    ],
    ['no checks reported at all', { pr: okPr({ checks: [], checksReported: false }) }, 'no-checks-reported'],
    [
      'a check is FAILING (red CI)',
      { pr: okPr({ checks: [{ name: 'unit-tests', status: 'COMPLETED', conclusion: 'FAILURE' }] }) },
      'checks-failing',
    ],
    [
      'a check is still PENDING',
      { pr: okPr({ checks: [{ name: 'unit-tests', status: 'IN_PROGRESS', conclusion: '' }] }) },
      'checks-pending',
    ],
    [
      'a check has an UNRECOGNIZED conclusion (fails closed)',
      { pr: okPr({ checks: [{ name: 'x', status: 'COMPLETED', conclusion: 'SOMETHING_NEW' }] }) },
      'checks-failing',
    ],
    ['mergeability still unknown', { pr: okPr({ mergeable: 'UNKNOWN' }) }, 'mergeability-unknown'],
    ['PR conflicts with its base', { pr: okPr({ mergeable: 'CONFLICTING' }) }, 'not-mergeable'],
    [
      'a reviewer requested changes',
      { pr: okPr({ reviewDecision: 'CHANGES_REQUESTED' }) },
      'changes-requested',
    ],
    ['an unresolved review thread exists', { openThreads: 1 }, 'unresolved-thread'],
    ['sweep merge cap reached', { mergesThisSweep: MAX_MERGES_PER_SWEEP }, 'rate-limited'],
    ['hourly merge cap reached', { mergesThisHour: 99 }, 'rate-limited'],
  ])('refuses when %s', (_label, override, code) => {
    const decision = evaluateMerge(okInputs(override));
    expect(decision.merge).toBe(false);
    expect(decision.code).toBe(code);
    expect(decision.reason.length).toBeGreaterThan(10); // always says why
  });

  it('refuses a guardrail diff even when everything else is perfectly green', () => {
    const d = evaluateMerge(okInputs({ pr: okPr({ changedFiles: ['.github/workflows/ci.yml'] }) }));
    expect(d.reason).toContain('REFUSED LOUDLY');
    expect(d.reason).toContain('.github/workflows/ci.yml');
  });

  it('a model judgment cannot clear a CHANGES_REQUESTED review or an open thread', () => {
    // These two are structural inputs; there is no parameter through which a
    // model verdict could reach them.
    expect(evaluateMerge(okInputs({ pr: okPr({ reviewDecision: 'CHANGES_REQUESTED' }), openThreads: 0 })).merge).toBe(false);
    expect(evaluateMerge(okInputs({ openThreads: 3 })).merge).toBe(false);
  });
});

describe('guardrailFilesIn', () => {
  it('names the offending paths rather than returning a bare boolean', () => {
    expect(guardrailFilesIn(['src/a.ts', '.github/workflows/ci.yml', 'scripts/check-pr-requirements.mjs']))
      .toEqual(['.github/workflows/ci.yml', 'scripts/check-pr-requirements.mjs']);
  });
  it('tolerates ./ prefixes and empty input', () => {
    expect(guardrailFilesIn(['./cli/permission-tiers.ts'])).toEqual(['cli/permission-tiers.ts']);
    expect(guardrailFilesIn(null)).toEqual([]);
  });
  it('does not over-match innocent neighbours', () => {
    expect(guardrailFilesIn(['scripts/check-docs.mjs', 'docs/.github/workflows/x.yml', 'cli/permission-tiers.test.ts']))
      .toEqual([]);
  });
});

describe('partitionChecks', () => {
  it('separates pending from failing, and accepts neutral/skipped as green', () => {
    const r = partitionChecks([
      { name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'b', status: 'COMPLETED', conclusion: 'NEUTRAL' },
      { name: 'c', status: 'COMPLETED', conclusion: 'SKIPPED' },
      { name: 'd', status: 'QUEUED', conclusion: '' },
      { name: 'e', status: 'COMPLETED', conclusion: 'TIMED_OUT' },
    ]);
    expect(r.pending).toEqual(['d']);
    expect(r.failing).toEqual(['e']);
  });
  it('treats a COMPLETED check with no conclusion as pending, not green', () => {
    expect(partitionChecks([{ name: 'x', status: 'COMPLETED', conclusion: '' }]).pending).toEqual(['x']);
  });
});

// ---------------------------------------------------------------------------
// 3. CALL-SITE ASSERTIONS

describe('the merge/push call sites re-assert the invariants and throw', () => {
  const env = makeEnv({ AI: forbiddenAi() }) as ExecutorEnv;

  it('mergeFleetPr THROWS for a non-fleet-authored PR', async () => {
    const human: FleetAuthorship = {
      fleetAuthored: false,
      signal: 'none',
      reason: 'author mallory is a human',
      branchMatches: false,
    };
    await expect(mergeFleetPr(env, okPr(), human, 'o', 'r', 'tok')).rejects.toThrow(
      /invariant violated.*refusing to merge/s,
    );
  });

  it('mergeFleetPr THROWS on the weak authorship signal', async () => {
    const weak: FleetAuthorship = {
      fleetAuthored: true,
      signal: 'bot-and-branch',
      reason: 'weak signal',
      branchMatches: true,
    };
    await expect(mergeFleetPr(env, okPr(), weak, 'o', 'r', 'tok')).rejects.toThrow(/invariant violated/);
  });

  it('mergeFleetPr THROWS when the diff touches the guardrails', async () => {
    await expect(
      mergeFleetPr(env, okPr({ changedFiles: ['.github/workflows/ci.yml'] }), OK_AUTHORSHIP, 'o', 'r', 'tok'),
    ).rejects.toThrow(/guardrails/);
  });

  it('mergeFleetPr THROWS when the head sha is unknown (cannot pin the merge)', async () => {
    await expect(mergeFleetPr(env, okPr({ headSha: '' }), OK_AUTHORSHIP, 'o', 'r', 'tok')).rejects.toThrow(
      /head sha unknown/,
    );
  });

  it('updateFleetPrBranch THROWS outside the envelope', async () => {
    const human: FleetAuthorship = { fleetAuthored: false, signal: 'none', reason: 'human', branchMatches: false };
    await expect(updateFleetPrBranch(env, okPr(), human, 'o', 'r', 'tok')).rejects.toThrow(
      /refusing to update the branch of/,
    );
  });

  it('refreshFleetPrBody THROWS rather than editing a human PR description', async () => {
    const human: FleetAuthorship = { fleetAuthored: false, signal: 'none', reason: 'human', branchMatches: false };
    await expect(refreshFleetPrBody(okPr(), human, 'o', 'r', 'note', 'tok')).rejects.toThrow(
      /refusing to edit the body of/,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. DISPUTES

describe('isSubstantiveDispute', () => {
  it('accepts a reasoned objection', () => {
    expect(
      isSubstantiveDispute(
        'I disagree with this assertion: the contract says the id may be negative, so rejecting it is wrong.',
      ),
    ).toBe(true);
  });
  it('rejects a quip and empty input', () => {
    expect(isSubstantiveDispute('wrong')).toBe(false);
    expect(isSubstantiveDispute('lgtm')).toBe(false);
    expect(isSubstantiveDispute('')).toBe(false);
    expect(isSubstantiveDispute(null)).toBe(false);
  });
  it('rejects a long comment carrying no objection marker', () => {
    expect(isSubstantiveDispute('This all looks fine to me and I appreciate the extra coverage here, thanks.')).toBe(
      false,
    );
  });
});

describe('classifyDisputes', () => {
  const thread = (over: Record<string, unknown> = {}) => ({
    id: 't1',
    isResolved: false,
    isOutdated: false,
    path: 'tests/x.test.ts',
    comments: [
      {
        databaseId: 501,
        body: 'I disagree — this test misreads the contract, negative ids are explicitly allowed.',
        authorLogin: 'erichowens',
      },
    ],
    ...over,
  });

  it('flags an unanswered substantive dispute for a reply', () => {
    const r = classifyDisputes([thread()], APP);
    expect(r.needsReply).toHaveLength(1);
    expect(r.needsReply[0].rootCommentId).toBe(501);
    expect(r.openThreads).toBe(1);
  });

  it('does NOT re-reply once the fleet spoke last (idempotent across sweeps)', () => {
    const t = thread();
    t.comments.push({ databaseId: 502, body: 'Holding: the obligation says…', authorLogin: APP });
    const r = classifyDisputes([t], APP);
    expect(r.needsReply).toHaveLength(0);
    // …but the thread still BLOCKS the merge until a human resolves it.
    expect(r.openThreads).toBe(1);
  });

  it('a non-substantive comment still BLOCKS even though it needs no reply', () => {
    const r = classifyDisputes([thread({ comments: [{ databaseId: 1, body: 'nit', authorLogin: 'x' }] })], APP);
    expect(r.needsReply).toHaveLength(0);
    expect(r.openThreads).toBe(1);
    // The heuristic can only ADD a reply obligation; it cannot subtract a block.
    expect(evaluateMerge(okInputs({ openThreads: r.openThreads })).merge).toBe(false);
  });

  it('ignores resolved and outdated threads', () => {
    const r = classifyDisputes([thread({ isResolved: true }), thread({ isOutdated: true })], APP);
    expect(r.openThreads).toBe(0);
    expect(r.needsReply).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. BRANCH + BODY FRESHNESS

describe('evaluateBranchUpdate', () => {
  const okUpdate = (over: Record<string, unknown> = {}) => ({
    stewardEnabled: true,
    paused: false as boolean | null,
    authorship: OK_AUTHORSHIP,
    pr: okPr(),
    comparison: { behindBy: 3, aheadBy: 1, status: 'behind' },
    updatesThisHour: 0,
    updatesThisSweep: 0,
    ...over,
  });

  it('updates a stale, cleanly-mergeable fleet branch', () => {
    const d = evaluateBranchUpdate(okUpdate());
    expect(d.update).toBe(true);
    expect(d.reason).toContain('3 commit(s) behind');
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['tenant has not opted in', { stewardEnabled: false }, 'steward-disabled'],
    ['fleet paused', { paused: true }, 'fleet-paused'],
    ['kill switch unreadable', { paused: null }, 'pause-unreadable'],
    ['PR is a human PR', { authorship: { fleetAuthored: false, signal: 'none', reason: 'human', branchMatches: false } }, 'not-fleet-authored'],
    ['weak authorship', { authorship: { fleetAuthored: true, signal: 'bot-and-branch', reason: 'w', branchMatches: true } }, 'authorship-unknown'],
    ['draft', { pr: okPr({ isDraft: true }) }, 'pr-draft'],
    ['guardrail diff', { pr: okPr({ changedFiles: ['.github/workflows/ci.yml'] }) }, 'guardrail-modification'],
    ['it would CONFLICT', { pr: okPr({ mergeable: 'CONFLICTING' }) }, 'would-conflict'],
    ['mergeability unknown', { pr: okPr({ mergeable: 'UNKNOWN' }) }, 'mergeability-unknown'],
    ['comparison unavailable', { comparison: null }, 'comparison-unavailable'],
    ['already current', { comparison: { behindBy: 0, aheadBy: 2, status: 'ahead' } }, 'already-current'],
    ['sweep cap reached', { updatesThisSweep: 99 }, 'rate-limited'],
    ['hourly cap reached', { updatesThisHour: 99 }, 'rate-limited'],
  ])('refuses when %s', (_label, over, code) => {
    const d = evaluateBranchUpdate(okUpdate(over));
    expect(d.update).toBe(false);
    expect(d.code).toBe(code);
  });

  it('a conflict is reported as a refusal that names a human, not a task to attempt', () => {
    const d = evaluateBranchUpdate(okUpdate({ pr: okPr({ mergeable: 'CONFLICTING' }) }));
    expect(d.reason).toContain('does NOT guess');
  });
});

describe('appendStewardChangelog', () => {
  const NOW = Date.parse('2026-08-04T12:34:56Z');

  it('creates the log section on first use', () => {
    const out = appendStewardChangelog('Original body.', 'merged `main` into this branch.', NOW);
    expect(out).toContain('Original body.');
    expect(out).toContain(CHANGELOG_MARKER);
    expect(out).toContain('- 2026-08-04 12:34Z — merged `main` into this branch.');
  });

  it('is append-only — it never rewrites the original description', () => {
    const original = 'The purser authored these tests.\n\nRoadmap-Item: none — machinery';
    const out = appendStewardChangelog(appendStewardChangelog(original, 'first', NOW), 'second', NOW);
    expect(out).toContain('The purser authored these tests.');
    expect(out).toContain('— first');
    expect(out).toContain('— second');
    expect(out.indexOf(CHANGELOG_MARKER)).toBe(out.lastIndexOf(CHANGELOG_MARKER)); // one section
  });

  it('caps the log, dropping the OLDEST entries', () => {
    let body = 'x';
    for (let i = 0; i < 14; i++) body = appendStewardChangelog(body, `entry-${i}`, NOW);
    expect(body).not.toContain('entry-0');
    expect(body).toContain('entry-13');
    expect(body.split('\n').filter(l => l.startsWith('- '))).toHaveLength(10);
  });

  it('every entry starts with "- " so none can masquerade as a trailer', () => {
    const out = appendStewardChangelog('x', 'Roadmap-Item: none — sneaky', NOW);
    for (const line of out.split('\n').filter(l => l.includes('sneaky'))) {
      expect(line.startsWith('- ')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. KILL SWITCH + BUDGETS (fail-closed directions)

describe('readPauseForSteward fails CLOSED where the reviewer fails safe', () => {
  it('absent CONTROL_KV binding ⇒ not paused (a deployment shape, not a failure)', async () => {
    const env = makeEnv({ CONTROL_KV: undefined }) as ExecutorEnv;
    expect(await readPauseForSteward(env)).toBe(false);
  });

  it('reads the JSON flag and the literal string form', async () => {
    const kv = memoryKV();
    const env = makeEnv({ CONTROL_KV: kv }) as ExecutorEnv;
    await kv.put('fleet:paused', JSON.stringify({ paused: true }));
    expect(await readPauseForSteward(env)).toBe(true);
    await kv.put('fleet:paused', 'true');
    expect(await readPauseForSteward(env)).toBe(true);
    await kv.put('fleet:paused', 'false');
    expect(await readPauseForSteward(env)).toBe(false);
  });

  it('a CORRUPT flag is UNKNOWN (null) — and evaluateMerge refuses on it', async () => {
    const kv = memoryKV();
    await kv.put('fleet:paused', '{not json');
    const env = makeEnv({ CONTROL_KV: kv }) as ExecutorEnv;
    const paused = await readPauseForSteward(env);
    expect(paused).toBeNull();
    expect(evaluateMerge(okInputs({ paused })).code).toBe('pause-unreadable');
  });

  it('a THROWING KV read is UNKNOWN, not "not paused"', async () => {
    const env = makeEnv({
      CONTROL_KV: { get: () => Promise.reject(new Error('kv down')) } as unknown as KVNamespace,
    }) as ExecutorEnv;
    expect(await readPauseForSteward(env)).toBeNull();
  });
});

describe('readMergeBudget', () => {
  it('an unreadable budget reads as SPENT, so the failure refuses rather than merges', async () => {
    const env = makeEnv({
      FLEET_TOKENS: { get: () => Promise.reject(new Error('kv down')) } as unknown as KVNamespace,
    }) as ExecutorEnv;
    const spent = await readMergeBudget(env);
    expect(evaluateMerge(okInputs({ mergesThisHour: spent })).code).toBe('rate-limited');
  });

  it('a fresh hour bucket is zero', async () => {
    expect(await readMergeBudget(makeEnv() as ExecutorEnv)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. END-TO-END PASS (fake GitHub, no network)

/**
 * Minimal GitHub fake for the steward's own surface: GraphQL snapshot, compare,
 * merge, update-branch, thread replies, and the trusted-branch config read.
 */
function installStewardFetch(opts: {
  /**
   * PR facts to override. `threads` here is the RAW GraphQL shape
   * (`comments: { nodes: [...] }`), not the flattened `ReviewThread` — the
   * point of these tests is to exercise the real normalizer in
   * `fetchStewardPrSnapshot`, so the fixture speaks GitHub's wire format.
   */
  pr: Partial<Omit<StewardPrSnapshot, 'threads'>> & { threads?: unknown[] };
  fleetYaml?: string | null;
  behindBy?: number;
  mergeOk?: boolean;
}) {
  const calls = {
    merges: [] as Array<{ sha: string; method: string }>,
    replies: [] as Array<{ commentId: string; body: string }>,
    updates: [] as Array<{ sha: string }>,
    bodyPatches: [] as string[],
  };
  const snapshot: StewardPrSnapshot = { ...okPr(), ...opts.pr, threads: [] };
  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};

    if (url === 'https://api.github.com/app') return Response.json({ slug: 'port-daddy' });
    if (url.includes('/access_tokens')) {
      return Response.json({ token: 'tok', expires_at: new Date(Date.now() + 3.6e6).toISOString() });
    }
    if (url.includes('/contents/pd-fleet.yml')) {
      if (opts.fleetYaml === null) return new Response('nf', { status: 404 });
      return Response.json({
        encoding: 'base64',
        content: btoa(opts.fleetYaml ?? 'fleet:\n  name: t\n  steward: true\n'),
      });
    }
    if (url === 'https://api.github.com/graphql') {
      return Response.json({
        data: {
          repository: {
            pullRequest: {
              number: snapshot.number,
              title: snapshot.title,
              body: snapshot.body,
              isDraft: snapshot.isDraft,
              state: snapshot.state,
              mergeable: snapshot.mergeable,
              reviewDecision: snapshot.reviewDecision || null,
              headRefName: snapshot.headRef,
              baseRefName: snapshot.baseRef,
              author: { login: snapshot.authorLogin, __typename: snapshot.authorType },
              files: { nodes: snapshot.changedFiles.map(path => ({ path })) },
              reviewThreads: { nodes: opts.pr.threads ?? [] },
              commits: {
                nodes: [
                  {
                    commit: {
                      oid: snapshot.headSha,
                      statusCheckRollup: snapshot.checksReported
                        ? {
                            contexts: {
                              nodes: snapshot.checks.map(c => ({
                                __typename: 'CheckRun',
                                name: c.name,
                                status: c.status,
                                conclusion: c.conclusion || null,
                              })),
                            },
                          }
                        : null,
                    },
                  },
                ],
              },
            },
          },
        },
      });
    }
    if (url.includes('/compare/')) {
      return Response.json({ behind_by: opts.behindBy ?? 0, ahead_by: 1, status: 'behind' });
    }
    if (url.includes('/update-branch') && method === 'PUT') {
      calls.updates.push({ sha: body.expected_head_sha });
      return Response.json({ message: 'Updating pull request branch.' });
    }
    if (/\/pulls\/\d+\/merge$/.test(url) && method === 'PUT') {
      calls.merges.push({ sha: body.sha, method: body.merge_method });
      return opts.mergeOk === false
        ? new Response('not mergeable', { status: 405 })
        : Response.json({ merged: true });
    }
    if (/\/comments\/\d+\/replies$/.test(url) && method === 'POST') {
      calls.replies.push({ commentId: url.match(/comments\/(\d+)/)![1], body: body.body });
      return Response.json({ id: 1 });
    }
    if (/\/pulls\/\d+$/.test(url) && method === 'PATCH') {
      calls.bodyPatches.push(body.body);
      return Response.json({ number: snapshot.number });
    }
    return new Response('unhandled ' + url, { status: 500 });
  };
  vi.stubGlobal('fetch', vi.fn(handler) as unknown as typeof fetch);
  return calls;
}

const CAND: StewardCandidate = {
  owner: 'erichowens',
  repo: 'port-daddy',
  prNumber: 4792,
  installationId: 42,
  recordedAt: Date.now(),
};

/** Env whose token cache is pre-seeded so no real JWT is ever minted. */
function stewardEnv(over: Partial<ExecutorEnv> = {}): ExecutorEnv {
  const kv = memoryKV();
  void kv.put('github_inst_42', JSON.stringify({ token: 'tok', expiresAt: Date.now() + 3.6e6 }));
  void kv.put('fleet_app_login', APP);
  return makeEnv({ FLEET_TOKENS: kv, AI: forbiddenAi(), ...over }) as ExecutorEnv;
}

// Every fetch-stubbing suite below shares this teardown.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runStewardPass — end to end', () => {

  it('MERGES a green, undisputed, fleet-authored PR, pinned to the evaluated sha', async () => {
    const calls = installStewardFetch({ pr: {} });
    const rec = recorder();
    const result = await runStewardPass(stewardEnv(), CAND, rec.transcript, 0);

    expect(result.merged).toBe(true);
    expect(calls.merges).toEqual([{ sha: 'HEADSHA', method: 'squash' }]);
    expect(rec.steps.some(s => s.kind === 'steward-merge')).toBe(true);
  });

  it('REFUSES and does not call the merge API when the tenant has not opted in', async () => {
    const calls = installStewardFetch({ pr: {}, fleetYaml: 'fleet:\n  name: t\n' });
    const result = await runStewardPass(stewardEnv(), CAND, recorder().transcript, 0);
    expect(result.merged).toBe(false);
    expect(result.decision.code).toBe('steward-disabled');
    expect(calls.merges).toHaveLength(0);
  });

  it('REFUSES on red CI without calling the merge API', async () => {
    const calls = installStewardFetch({
      pr: { checks: [{ name: 'unit-tests', status: 'COMPLETED', conclusion: 'FAILURE' }] },
    });
    const result = await runStewardPass(stewardEnv(), CAND, recorder().transcript, 0);
    expect(result.decision.code).toBe('checks-failing');
    expect(calls.merges).toHaveLength(0);
  });

  it('REFUSES on a draft, a gate-modifying diff, and a non-fleet author', async () => {
    for (const [pr, code] of [
      [{ isDraft: true }, 'pr-draft'],
      [{ changedFiles: ['.github/workflows/ci.yml'] }, 'guardrail-modification'],
      [{ authorLogin: 'mallory', authorType: 'User' }, 'not-fleet-authored'],
    ] as Array<[Partial<Omit<StewardPrSnapshot, 'threads'>>, string]>) {
      const calls = installStewardFetch({ pr });
      const result = await runStewardPass(stewardEnv(), CAND, recorder().transcript, 0);
      expect(result.decision.code).toBe(code);
      expect(calls.merges).toHaveLength(0);
    }
  });

  it('REFUSES while the fleet kill switch is set, before touching GitHub at all', async () => {
    const calls = installStewardFetch({ pr: {} });
    const kv = memoryKV();
    await kv.put('fleet:paused', JSON.stringify({ paused: true }));
    const result = await runStewardPass(stewardEnv({ CONTROL_KV: kv }), CAND, recorder().transcript, 0);
    expect(result.decision.code).toBe('fleet-paused');
    expect(calls.merges).toHaveLength(0);
  });

  it('DISPUTE PATH: replies on the thread and still refuses to merge', async () => {
    const ai = {
      run: vi.fn(async () => ({
        response: 'Holding: the obligation is explicit. I have not merged and will not while this is open.',
      })),
    } as unknown as Ai;
    const calls = installStewardFetch({
      pr: {
        threads: [
          {
            id: 't1',
            isResolved: false,
            isOutdated: false,
            path: 'tests/purser/widget.contract.test.ts',
            comments: {
              nodes: [
                {
                  databaseId: 501,
                  body: 'I disagree — this test misreads the contract; negative ids are explicitly allowed.',
                  author: { login: 'erichowens' },
                },
              ],
            },
          },
        ],
      },
    });
    const rec = recorder();
    const result = await runStewardPass(stewardEnv({ AI: ai }), CAND, rec.transcript, 0);

    // It answered…
    expect(result.repliesPosted).toBe(1);
    expect(calls.replies[0].commentId).toBe('501');
    // …and it did NOT merge. Answering is not agreeing.
    expect(result.merged).toBe(false);
    expect(result.decision.code).toBe('unresolved-thread');
    expect(calls.merges).toHaveLength(0);
    const reply = rec.steps.find(s => s.kind === 'steward-dispute-reply')!;
    expect((reply.detail as { clearsMerge: boolean }).clearsMerge).toBe(false);
  });

  it('never argues on a PR it may not steward (no reply on a human PR)', async () => {
    const ai = { run: vi.fn(async () => ({ response: 'x' })) } as unknown as Ai;
    const calls = installStewardFetch({
      pr: {
        authorLogin: 'mallory',
        authorType: 'User',
        threads: [
          {
            id: 't1',
            isResolved: false,
            isOutdated: false,
            path: 'a.ts',
            comments: {
              nodes: [
                { databaseId: 7, body: 'I disagree, this test is wrong and misreads the contract entirely.', author: { login: 'x' } },
              ],
            },
          },
        ],
      },
    });
    const result = await runStewardPass(stewardEnv({ AI: ai }), CAND, recorder().transcript, 0);
    expect(result.repliesPosted).toBe(0);
    expect(calls.replies).toHaveLength(0);
    expect(result.decision.code).toBe('not-fleet-authored');
  });

  it('BRANCH FRESHNESS: refreshes a stale branch, logs it in the body, and defers the merge', async () => {
    const calls = installStewardFetch({ pr: {}, behindBy: 3 });
    const rec = recorder();
    const result = await runStewardPass(stewardEnv(), CAND, rec.transcript, 0);

    expect(result.branchUpdated).toBe(true);
    expect(calls.updates).toEqual([{ sha: 'HEADSHA' }]);
    // The body records the push honestly…
    expect(calls.bodyPatches[0]).toContain(CHANGELOG_MARKER);
    expect(calls.bodyPatches[0]).toContain('3 commit(s) behind');
    // …and the merge is deferred: the evaluated commit no longer exists.
    expect(result.merged).toBe(false);
    expect(calls.merges).toHaveLength(0);
    expect(result.decision.code).toBe('checks-pending');
  });

  it('BRANCH FRESHNESS: never pushes to a human PR even when it is stale', async () => {
    const calls = installStewardFetch({
      pr: { authorLogin: 'mallory', authorType: 'User' },
      behindBy: 5,
    });
    await runStewardPass(stewardEnv(), CAND, recorder().transcript, 0);
    expect(calls.updates).toHaveLength(0);
    expect(calls.bodyPatches).toHaveLength(0);
  });

  it('BRANCH FRESHNESS: refuses to guess at a conflict', async () => {
    const calls = installStewardFetch({ pr: { mergeable: 'CONFLICTING' }, behindBy: 4 });
    const result = await runStewardPass(stewardEnv(), CAND, recorder().transcript, 0);
    expect(calls.updates).toHaveLength(0);
    expect(result.updateDecision?.code).toBe('would-conflict');
    expect(calls.merges).toHaveLength(0);
  });
});

describe('runStewardSweep', () => {

  it('inspects registered candidates and respects the per-sweep merge cap', async () => {
    const calls = installStewardFetch({ pr: {} });
    const env = stewardEnv();
    for (const n of [1, 2, 3, 4]) {
      await recordStewardCandidate(env, { ...CAND, prNumber: n });
    }
    const rec = recorder();
    const results = await runStewardSweep(env, rec.transcript);

    expect(results).toHaveLength(4);
    // Hard, unraceable bound: no more than MAX_MERGES_PER_SWEEP merges.
    expect(calls.merges.length).toBeLessThanOrEqual(MAX_MERGES_PER_SWEEP);
    expect(results.filter(r => r.merged)).toHaveLength(MAX_MERGES_PER_SWEEP);
    expect(results.filter(r => r.decision.code === 'rate-limited').length).toBeGreaterThan(0);
    expect(rec.steps.some(s => s.kind === 'steward-sweep')).toBe(true);
  });

  it('drops a corrupt registry entry instead of guessing at it', async () => {
    installStewardFetch({ pr: {} });
    const env = stewardEnv();
    await env.FLEET_TOKENS.put('steward:cand:bad', 'not json');
    const results = await runStewardSweep(env, recorder().transcript);
    expect(results).toHaveLength(0);
    expect(await env.FLEET_TOKENS.get('steward:cand:bad')).toBeNull();
  });

  it('records every refusal in the transcript, so "why has this not landed" is readable', async () => {
    installStewardFetch({ pr: { isDraft: true } });
    const env = stewardEnv();
    await recordStewardCandidate(env, CAND);
    const rec = recorder();
    await runStewardSweep(env, rec.transcript);
    const decision = rec.steps.find(s => s.kind === 'steward-decision')!;
    expect(decision.title).toContain('pr-draft');
    expect((decision.detail as { reason: string }).reason).toContain('draft');
  });
});
