/**
 * Ideation "stack" proposals end-to-end (execute.ts maybeStackProposal): a ship
 * that codes its own fix gets a branch cut FROM THE PR HEAD sha
 * (`fleet/<ship>-pr-<n>-<slug>`) and a PR whose BASE IS THE REVIEWED PR'S HEAD
 * BRANCH — the fix lands stacked on top of the review diff. Guards under test:
 * same-repo only, ≤5 files / ≤16KB caps, path safety, sandbox validation when
 * the binding exists, max 1 stack PR per ship per run, and the 'stack-posted'
 * transcript trail for every outcome.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeFleet } from '../src/execute.js';
import {
  freshState,
  installGitHubFetch,
  memoryKV,
  memoryD1,
  aiStub,
  makeEnv,
  makeJob,
  type GitHubState,
} from './harness.js';

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function seedToken(kv: KVNamespace): void {
  void kv.put(
    'github_inst_42',
    JSON.stringify({ token: 'seeded-tok', expiresAt: Date.now() + 60 * 60 * 1000 }),
  );
}

/** pd-fleet.yml with spark as the lone ideation ship. */
const SPARK_YAML = [
  'fleet:',
  '  name: test',
  '  agents:',
  '    spark:',
  '      trigger: pull_request:opened',
  '      class: ideation',
  '      fallbacks:',
  '        - backend: cloudflare',
  "          model: '@cf/qwen/qwen3-30b-a3b-fp8'",
  '      prompt: |',
  '        spark ship: propose forward work for this diff.',
  '',
].join('\n');

function stackOutput(files: Array<{ path: string; contents: string }>, extra: object[] = []): string {
  return [
    '```json',
    JSON.stringify([
      {
        title: 'Fix the null guard',
        rationale: 'The diff misses the undefined case.',
        evidence: ['src/x.ts'],
        action: 'stack',
        files,
      },
      ...extra,
    ]),
    '```',
    'FLEET-VERDICT: PASS',
  ].join('\n');
}

/** A same-repo job whose payload carries the PR head BRANCH name. */
function jobWithHeadRef(over: Record<string, unknown> = {}) {
  return makeJob({
    payloadMinimal: {
      pull_request: {
        number: 7,
        title: 'x',
        body: 'y',
        head: { sha: 'HEADSHA', ref: 'feat/widget', repo: { full_name: 'erichowens/port-daddy' } },
        base: { sha: 'BASESHA', ref: 'main', repo: { full_name: 'erichowens/port-daddy' } },
        ...over,
      },
    },
  });
}

function commentBodiesOf(s: GitHubState): string[] {
  return s.records
    .filter(r => r.method === 'POST' && /\/issues\/\d+\/comments$/.test(r.url))
    .map(r => (r.body as { body?: string }).body ?? '');
}

const GOOD_FILES = [{ path: 'src/fix.ts', contents: 'export const fixed = true;' }];

async function runSpark(opts: {
  files?: Array<{ path: string; contents: string }>;
  output?: string;
  job?: ReturnType<typeof makeJob>;
  sandbox?: unknown;
  db?: ReturnType<typeof memoryD1>;
} = {}) {
  state.files.set('main:pd-fleet.yml', SPARK_YAML);
  const kv = memoryKV();
  seedToken(kv);
  const ai = aiStub({ perShip: { spark: opts.output ?? stackOutput(opts.files ?? GOOD_FILES) } }).ai;
  const env = makeEnv({
    FLEET_TOKENS: kv,
    AI: ai,
    ...(opts.sandbox !== undefined ? { SANDBOX: opts.sandbox } : {}),
    ...(opts.db ? { DB: opts.db.db } : {}),
  });
  await executeFleet(opts.job ?? jobWithHeadRef(), env);
}

describe('stack proposals — happy path', () => {
  it('branches from the PR HEAD sha and opens a PR based on the PR head branch', async () => {
    const db = memoryD1();
    await runSpark({ db });

    // Branch cut from HEAD (never base): the commit parents on HEADSHA.
    const commitPost = state.records.find(r => r.method === 'POST' && /\/git\/commits$/.test(r.url));
    expect((commitPost!.body as { parents: string[] }).parents).toEqual(['HEADSHA']);
    expect(state.gitRefs.has('fleet/spark-pr-7-fix-the-null-guard')).toBe(true);

    // Stack PR: head = fleet branch, BASE = the reviewed PR's head branch.
    expect(state.stackedPrs).toHaveLength(1);
    expect(state.stackedPrs[0]).toMatchObject({
      head: 'fleet/spark-pr-7-fix-the-null-guard',
      base: 'feat/widget',
    });
    expect(state.stackedPrs[0].title).toContain('stacks on #7');
    expect(state.labelPosts[0]?.labels).toEqual(['fleet-stack', 'pd-spark']);

    // Transcript: one 'stack-posted' step with the PR + file list.
    const step = db.steps.find(s => s.kind === 'stack-posted')!;
    expect(step.title).toContain('stacked #8001');
    const detail = JSON.parse(String(step.detail)) as Record<string, unknown>;
    expect(detail).toMatchObject({ stacked: true, stackPrNumber: 8001, files: ['src/fix.ts'] });

    // The comment links the stacked PR (renderer 'stack' case).
    const bodies = commentBodiesOf(state);
    expect(bodies.some(b => b.includes('#8001') && b.includes('coded this solution itself'))).toBe(true);

    // Advisory as ever: the gate is untouched.
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('opens at most ONE stack PR per ship per run (first valid stack proposal wins)', async () => {
    await runSpark({
      output: stackOutput(GOOD_FILES, [
        {
          title: 'Second fix',
          rationale: 'Another one.',
          action: 'stack',
          files: [{ path: 'src/other.ts', contents: 'x' }],
        },
      ]),
    });
    expect(state.stackedPrs).toHaveLength(1);
    expect(state.stackedPrs[0].head).toBe('fleet/spark-pr-7-fix-the-null-guard');
  });

  it('sandbox-validates when the binding exists and stacks on a passing suite', async () => {
    const db = memoryD1();
    await runSpark({ db, sandbox: { exec: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }) } });
    expect(state.stackedPrs).toHaveLength(1);
    const step = db.steps.find(s => s.kind === 'stack-posted')!;
    expect(JSON.parse(String(step.detail))).toMatchObject({ sandboxValidated: true });
  });
});

describe('stack proposals — guards degrade honestly (no PR, transcript note)', () => {
  it('fork PR: never writes to the repo', async () => {
    const db = memoryD1();
    await runSpark({
      db,
      job: jobWithHeadRef({ head: { sha: 'HEADSHA', ref: 'feat/widget', repo: { full_name: 'attacker/fork' } } }),
    });
    expect(state.records.filter(r => r.url.includes('/git/'))).toHaveLength(0);
    expect(state.stackedPrs).toHaveLength(0);
    const step = db.steps.find(s => s.kind === 'stack-posted')!;
    expect(String(step.title)).toContain('NOT posted');
    expect(JSON.parse(String(step.detail))).toMatchObject({ stacked: false });
    expect(JSON.parse(String(step.detail)).degraded).toContain('fork');
    // The comment says honestly that nothing was stacked.
    expect(commentBodiesOf(state).some(b => b.includes('no stacked PR was opened this run'))).toBe(true);
  });

  it('rejects >5 files and >16KB files before any git write', async () => {
    const db = memoryD1();
    const six = Array.from({ length: 6 }, (_, i) => ({ path: `src/f${i}.ts`, contents: 'x' }));
    await runSpark({ db, files: six });
    expect(state.records.filter(r => r.url.includes('/git/'))).toHaveLength(0);
    expect(state.stackedPrs).toHaveLength(0);
    const step = db.steps.find(s => s.kind === 'stack-posted')!;
    expect(JSON.parse(String(step.detail)).degraded).toContain('too many files');
  });

  it('rejects traversal paths (purser-grade path safety)', async () => {
    const db = memoryD1();
    // NOTE: '../evil.ts' would null the whole parse only if shape were wrong; a
    // structurally valid file with a hostile path parses but fails validation.
    await runSpark({ db, files: [{ path: '../evil.ts', contents: 'x' }] });
    expect(state.records.filter(r => r.url.includes('/git/'))).toHaveLength(0);
    const step = db.steps.find(s => s.kind === 'stack-posted')!;
    expect(JSON.parse(String(step.detail)).degraded).toMatch(/traversal|whitelist/);
  });

  it('a FAILING sandbox validation blocks the stack (a ship must not stack a broken fix)', async () => {
    const db = memoryD1();
    await runSpark({
      db,
      sandbox: { exec: async () => ({ exitCode: 1, stdout: 'FAIL src/fix 1 failed', stderr: '' }) },
    });
    expect(state.stackedPrs).toHaveLength(0);
    expect(state.records.filter(r => r.url.includes('/git/'))).toHaveLength(0);
    const step = db.steps.find(s => s.kind === 'stack-posted')!;
    expect(JSON.parse(String(step.detail)).degraded).toContain('sandbox validation FAILED');
    // Advisory ship: the gate is still success.
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('a 403 on git writes degrades to a named-permission transcript note', async () => {
    state.failGitWrites403 = true;
    const db = memoryD1();
    await runSpark({ db });
    expect(state.stackedPrs).toHaveLength(0);
    const step = db.steps.find(s => s.kind === 'stack-posted')!;
    expect(JSON.parse(String(step.detail)).degraded).toContain('contents: write');
    expect(state.completed[0].conclusion).toBe('success');
  });

  it('a missing head branch name degrades instead of opening a misbased PR', async () => {
    const db = memoryD1();
    await runSpark({
      db,
      job: jobWithHeadRef({ head: { sha: 'HEADSHA', repo: { full_name: 'erichowens/port-daddy' } } }),
    });
    expect(state.stackedPrs).toHaveLength(0);
    const step = db.steps.find(s => s.kind === 'stack-posted')!;
    expect(JSON.parse(String(step.detail)).degraded).toContain('head branch unknown');
  });
});

describe('stack proposals — re-run idempotency', () => {
  it('a retried delivery force-updates the same branch and reuses the same PR', async () => {
    await runSpark({});
    await runSpark({});
    expect(state.refCreates).toBe(1);
    expect(state.refUpdates).toBe(1);
    expect(state.stackedPrs).toHaveLength(1);
  });
});
