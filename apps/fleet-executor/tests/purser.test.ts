import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  runPurser,
  parseSteelMan,
  parseAuthoredFiles,
  testPlanSystemPrompt,
  buildContractBodySection,
  PURSER_CONTRACT_START,
  PURSER_CONTRACT_END,
  type TranscriptLike,
  type PurserMetrics,
} from '../src/purser.js';
import { parseFleetShips, PURSER_DEFAULT_GRAFT, type ShipConfig } from '../src/fleet.js';
import { aggregateConclusion } from '../src/verdict.js';
import { executeFleet } from '../src/execute.js';
import type { PRContext } from '../src/github.js';
import { extractJestTestMatch, matchesAnyTestMatch } from '../src/purser-executability.js';
import { encodeFingerprint, fingerprintDiff, withAuthoredTests } from '../src/purser-rerun.js';
import { FleetAiCircuit, FleetAiDependencyError } from '../src/ai-resilience.js';
import { assessContextAdmission } from '../src/context-admission.js';
import {
  freshState,
  installGitHubFetch,
  memoryKV,
  aiStub,
  makeEnv,
  makeJob,
  type GitHubState,
} from './harness.js';

const OWNER = 'erichowens';
const REPO = 'port-daddy';

// ---------------------------------------------------------------------------
// Fixtures

const STEELMAN_JSON = [
  '```json',
  JSON.stringify({
    purpose: 'Guarantee the widget frobs deterministically.',
    contract: {
      obligations: ['frobs on empty input without throwing', 'rejects negative ids with a typed error'],
    },
    testTargets: ['src/widget.ts'],
  }),
  '```',
].join('\n');

const TESTS_JSON = [
  '```json',
  JSON.stringify({
    files: [
      { path: 'tests/purser/widget.contract.test.ts', contents: 'it("frobs empty input", () => {});' },
    ],
  }),
  '```',
].join('\n');

function mkShip(over: Partial<ShipConfig> = {}): ShipConfig {
  return {
    name: 'purser',
    trigger: 'pull_request:opened',
    prompt: 'You are pd-purser.',
    cfModel: '@cf/qwen/qwen3-30b-a3b-fp8',
    temperature: null,
    role: 'Hold the PR to its best interpretation.',
    telos: 'Steel-man, then demand.',
    blocking: false,
    needsExecution: false,
    ideation: false,
    purser: true,
    blockWithoutSandbox: false,
    testPaths: [],
    graft: [],
    ...over,
  };
}

function mkCtx(over: Partial<PRContext> = {}): PRContext {
  return {
    owner: OWNER,
    repo: REPO,
    prNumber: 7,
    title: 'Add widget frobbing',
    body: 'Frobs the widget.',
    headSha: 'HEADSHA',
    headRef: 'feat/widget',
    baseSha: 'BASESHA',
    baseRef: 'main',
    isFork: false,
    authorLogin: 'a-human',
    authorType: 'User',
    // Open PR: the lifecycle gate must let these fixtures through.
    state: 'open',
    merged: false,
    installationId: 0,
    files: [{ filename: 'src/widget.ts', status: 'modified', additions: 3, deletions: 1 }],
    diff: 'diff --git a/src/widget.ts b/src/widget.ts\n+frob',
    diffBytes: 0,
    diffTruncated: false,
    filesTruncated: false,
    ...over,
  };
}

/** Sequential AI: returns queued responses in order (steel-man, then tests). */
function seqAi(responses: string[]): { ai: Ai; calls: number } {
  const box = { calls: 0 };
  const run = vi.fn(async () => ({ response: responses[box.calls++] ?? '' }));
  return { ai: { run } as unknown as Ai, get calls() { return box.calls; } } as { ai: Ai; calls: number };
}

interface RecordedStep { kind: string; ship: string | null; title: string; detail: unknown }

function recorder(): { steps: RecordedStep[]; transcript: TranscriptLike } {
  const steps: RecordedStep[] = [];
  return {
    steps,
    transcript: {
      async step(kind, ship, title, detail) {
        steps.push({ kind, ship, title, detail });
      },
    },
  };
}

function freshMetrics(): PurserMetrics {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    calls: 0,
    allEmpty: true,
    usageReports: 0,
  };
}

/** A fake Cloudflare Sandbox instance stub (structural: just `exec`). */
function sandboxStub(exitCode: number, output = 'test run output'): unknown {
  const summary = {
    numFailedTests: exitCode === 0 ? 0 : 1,
    numFailedTestSuites: exitCode === 0 ? 0 : 1,
    numPassedTests: exitCode === 0 ? 1 : 0,
    numRuntimeErrorTestSuites: 0,
    numTotalTests: 1,
    success: exitCode === 0,
  };
  const stdout = [
    '__PD_PURSER_TEST_STARTED__',
    output,
    `__PD_PURSER_JEST_SUMMARY__:${btoa(JSON.stringify(summary))}`,
  ].join('\n');
  return { exec: async () => ({ exitCode, stdout, stderr: '' }) };
}

function sandboxHarnessFailure(output = 'Test suite failed to run'): unknown {
  const summary = {
    numFailedTests: 0,
    numFailedTestSuites: 1,
    numPassedTests: 0,
    numRuntimeErrorTestSuites: 1,
    numTotalTests: 0,
    success: false,
  };
  const stdout = [
    '__PD_PURSER_TEST_STARTED__',
    output,
    `__PD_PURSER_JEST_SUMMARY__:${btoa(JSON.stringify(summary))}`,
  ].join('\n');
  return { exec: async () => ({ exitCode: 1, stdout, stderr: '' }) };
}

function purserCommentBodies(state: GitHubState): string[] {
  return state.records
    .filter(r => (r.method === 'POST' && /\/issues\/\d+\/comments$/.test(r.url)) ||
                 (r.method === 'PATCH' && /\/issues\/comments\/\d+/.test(r.url)))
    .map(r => (r.body as { body?: string }).body ?? '')
    .filter(b => b.includes('pd-ship:purser'));
}

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe('parseSteelMan / parseAuthoredFiles — strict fenced JSON', () => {
  it('parses the contract, accepting contract as {obligations} or a bare array', () => {
    expect(parseSteelMan(STEELMAN_JSON)).toEqual({
      purpose: 'Guarantee the widget frobs deterministically.',
      obligations: ['frobs on empty input without throwing', 'rejects negative ids with a typed error'],
      testTargets: ['src/widget.ts'],
    });
    const bare = '```json\n' + JSON.stringify({ purpose: 'p', contract: ['a', 'b'] }) + '\n```';
    expect(parseSteelMan(bare)?.obligations).toEqual(['a', 'b']);
  });

  it('returns null on missing fence, broken JSON, missing purpose, or empty obligations', () => {
    expect(parseSteelMan('no fence here')).toBeNull();
    expect(parseSteelMan('```json\n{ broken\n```')).toBeNull();
    expect(parseSteelMan('```json\n' + JSON.stringify({ contract: ['a'] }) + '\n```')).toBeNull();
    expect(parseSteelMan('```json\n' + JSON.stringify({ purpose: 'p', contract: [] }) + '\n```')).toBeNull();
  });

  it('parses files from {files:[...]} or a bare array; null on malformed/empty', () => {
    expect(parseAuthoredFiles(TESTS_JSON)).toEqual([
      { path: 'tests/purser/widget.contract.test.ts', contents: 'it("frobs empty input", () => {});' },
    ]);
    const bare = '```json\n' + JSON.stringify([{ path: 'a.ts', contents: 'x' }]) + '\n```';
    expect(parseAuthoredFiles(bare)).toEqual([{ path: 'a.ts', contents: 'x' }]);
    expect(parseAuthoredFiles('```json\n[]\n```')).toBeNull();
    expect(parseAuthoredFiles('```json\n' + JSON.stringify([{ path: 'a.ts' }]) + '\n```')).toBeNull();
    expect(parseAuthoredFiles(STEELMAN_JSON)).toBeNull(); // an object without files[]
  });
});

describe('parseSteelMan — extraction tolerance (2026-08-04: 1416 chars discarded)', () => {
  const contract = { purpose: 'p', contract: { obligations: ['a'] }, testTargets: ['src/x.ts'] };

  it('tolerates a <think> preamble around the fenced contract', () => {
    const out = `<think>Let me consider the diff…</think>\n\n\`\`\`json\n${JSON.stringify(contract)}\n\`\`\``;
    expect(parseSteelMan(out)?.obligations).toEqual(['a']);
  });

  it('prefers the FINAL answer over a draft fence inside the <think> span', () => {
    // The old regex matched the first fence anywhere, so a reasoning model's
    // discarded draft could be parsed as the answer.
    const draft = JSON.stringify({ purpose: 'draft', contract: { obligations: ['WRONG'] } });
    const out =
      `<think>maybe: \`\`\`json\n${draft}\n\`\`\` — no, revise</think>\n\n` +
      `\`\`\`json\n${JSON.stringify(contract)}\n\`\`\``;
    expect(parseSteelMan(out)?.obligations).toEqual(['a']);
    expect(parseSteelMan(out)?.purpose).toBe('p');
  });

  it('tolerates an unlabelled or differently-cased fence', () => {
    expect(parseSteelMan('```\n' + JSON.stringify(contract) + '\n```')?.obligations).toEqual(['a']);
    expect(parseSteelMan('```JSON\n' + JSON.stringify(contract) + '\n```')?.obligations).toEqual(['a']);
  });

  it('tolerates markdown prose around a bare, unfenced JSON object', () => {
    const out = `Here is the contract for this PR:\n\n${JSON.stringify(contract)}\n\nHope that helps.`;
    expect(parseSteelMan(out)?.obligations).toEqual(['a']);
  });

  it('does NOT weaken shape validation — a wrong shape is still null', () => {
    // Tolerance changes WHICH substring is parsed, never what counts as valid.
    expect(parseSteelMan('{"contract":{"obligations":["a"]}}')).toBeNull(); // no purpose
    expect(parseSteelMan('{"purpose":"p","contract":{"obligations":[]}}')).toBeNull(); // empty
    expect(parseSteelMan('{"purpose":"p","contract":{"obligations":[1,2]}}')).toBeNull(); // not strings
  });

  it('never fabricates a contract when parsing genuinely fails', () => {
    expect(parseSteelMan('I refuse to emit JSON.')).toBeNull();
    expect(parseSteelMan('```json\n{ broken\n```')).toBeNull();
    expect(parseSteelMan('')).toBeNull();
  });

  it('applies the same tolerance to authored test files', () => {
    const files = { files: [{ path: 'tests/a.test.ts', contents: 'it("x", () => {});' }] };
    const out = `<think>drafting</think>\n\n\`\`\`\n${JSON.stringify(files)}\n\`\`\``;
    expect(parseAuthoredFiles(out)).toEqual([
      { path: 'tests/a.test.ts', contents: 'it("x", () => {});' },
    ]);
  });
});

describe('runPurser — steel-man failure modes', () => {
  it('projects oversized PR metadata explicitly while every dispatched request remains admitted', async () => {
    const responses = [STEELMAN_JSON, TESTS_JSON];
    const run = vi.fn(async (
      _model: string,
      _request: { messages: Array<{ role: string; content: string }>; max_tokens: number },
    ) => ({ response: responses[run.mock.calls.length - 1] ?? '' }));
    const rec = recorder();
    const bodyTail = 'BODY-TAIL-MUST-NOT-REACH-THE-MODEL';
    const titleTail = 'TITLE-TAIL-MUST-NOT-REACH-THE-MODEL';

    const result = await runPurser(
      mkShip(),
      mkCtx({
        title: `${'T'.repeat(4_096)}${titleTail}`,
        body: `${'B'.repeat(64_000)}${bodyTail}`,
      }),
      makeEnv({ AI: { run } as unknown as Ai }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result.errored).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
    const firstRequest = run.mock.calls[0][1] as {
      messages: Array<{ role: string; content: string }>;
      max_tokens: number;
    };
    const user = firstRequest.messages.find(message => message.role === 'user')!.content;
    expect(user).toContain('[PR title projection:');
    expect(user).toContain('[PR description projection:');
    expect(user).not.toContain(titleTail);
    expect(user).not.toContain(bodyTail);

    for (const [model, request] of run.mock.calls) {
      const aiRequest = request as {
        messages: Array<{ role: string; content: string }>;
        max_tokens: number;
      };
      expect(
        assessContextAdmission(
          String(model),
          aiRequest.messages,
          aiRequest.max_tokens,
        ).accepted,
      ).toBe(true);
    }
  });

  it('marks Purser’s own diff projection partial instead of returning a clean fleet result', async () => {
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();
    const result = await runPurser(
      mkShip(),
      mkCtx({
        diff:
          'diff --git a/src/widget.ts b/src/widget.ts\n--- a/src/widget.ts\n+++ b/src/widget.ts\n' +
          '+reviewed-prefix\n'.repeat(2_000),
      }),
      makeEnv({ AI: ai }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ errored: false, reviewCoverage: 'partial' });
    expect(result.reviewCoverageReason).toContain('first 24000 characters');
    expect(aggregateConclusion([result])).toBe('neutral');
    expect(rec.steps).toContainEqual(expect.objectContaining({ kind: 'purser-context-partial' }));
  });

  it('does not reuse a prefix-only Purser fingerprint after GitHub truncates the raw diff', async () => {
    const first = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();
    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: first.ai }), 'tok', rec.transcript, freshMetrics());

    const second = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const truncated = await runPurser(
      mkShip(),
      mkCtx({ diffTruncated: true, diffBytes: 2_000_000 }),
      makeEnv({ AI: second.ai }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(second.calls).toBeGreaterThan(0);
    expect(truncated).toMatchObject({ errored: false, reviewCoverage: 'partial' });
    expect(truncated.reviewCoverageReason).toContain('GitHub stopped the raw diff read');
    expect(aggregateConclusion([truncated])).toBe('neutral');
  });

  it('fails visibly before Workers AI when an indivisible full request exceeds capacity', async () => {
    const run = vi.fn(async () => ({ response: STEELMAN_JSON }));
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, prompt: 'system evidence '.repeat(4_000) }),
      mkCtx(),
      makeEnv({ AI: { run } as unknown as Ai }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(run).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ship: 'purser',
      verdict: 'BLOCK',
      errored: true,
      failureReason: expect.stringContaining('context admission rejected before model dispatch'),
    });
    expect(aggregateConclusion([result])).toBe('failure');
    expect(rec.steps).toContainEqual(expect.objectContaining({
      kind: 'ship-error',
      detail: expect.objectContaining({
        model: '@cf/qwen/qwen3-30b-a3b-fp8',
        contextWindowTokens: 32_768,
      }),
    }));
  });

  it('fails visibly before Workers AI when a configured Purser model has no context contract', async () => {
    const run = vi.fn(async () => ({ response: STEELMAN_JSON }));
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, cfModel: '@cf/example/unknown-context' }),
      mkCtx(),
      makeEnv({ AI: { run } as unknown as Ai }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(run).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      errored: true,
      failureReason: expect.stringContaining('has no known context window'),
    });
    expect(rec.steps).toContainEqual(expect.objectContaining({
      kind: 'ship-error',
      detail: expect.objectContaining({
        model: '@cf/example/unknown-context',
        contextWindowTokens: null,
      }),
    }));
  });

  it('propagates a silent AI deadline to the queue while provider budget remains', async () => {
    const run = vi.fn(() => new Promise<never>(() => undefined));
    const rec = recorder();

    await expect(runPurser(
      mkShip({ blocking: true }),
      mkCtx(),
      makeEnv({ AI: { run } as unknown as Ai }),
      'tok',
      rec.transcript,
      freshMetrics(),
      '',
      'run:deadline',
      false,
      new FleetAiCircuit(10),
      1,
    )).rejects.toBeInstanceOf(FleetAiDependencyError);

    expect(run).toHaveBeenCalledTimes(1);
    expect(rec.steps).toContainEqual(expect.objectContaining({
      kind: 'ship-error',
      detail: expect.objectContaining({
        status: 408,
        code: 3007,
        retryable: true,
        providerCircuitOpen: true,
        providerAttempt: 1,
      }),
    }));
    expect(rec.steps.some(step => step.kind === 'ship-verdict')).toBe(false);
  });

  it('fails the Purser honestly after the final provider deadline instead of retrying forever', async () => {
    const run = vi.fn(() => new Promise<never>(() => undefined));
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true }),
      mkCtx(),
      makeEnv({ AI: { run } as unknown as Ai }),
      'tok',
      rec.transcript,
      freshMetrics(),
      '',
      'run:deadline',
      false,
      new FleetAiCircuit(10),
      3,
    );

    expect(result).toMatchObject({
      ship: 'purser',
      verdict: 'BLOCK',
      errored: true,
      failureReason: expect.stringContaining('10ms deadline'),
      brokenAdjudicated: {
        scope: 'fleet',
        reason: expect.stringContaining('3/3 provider attempts'),
      },
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not let contract repair swallow a retryable provider deadline', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ response: 'I refuse to emit JSON.' })
      .mockImplementationOnce(() => new Promise<never>(() => undefined));
    const rec = recorder();

    await expect(runPurser(
      mkShip({ blocking: true }),
      mkCtx(),
      makeEnv({ AI: { run } as unknown as Ai }),
      'tok',
      rec.transcript,
      freshMetrics(),
      '',
      'run:repair-deadline',
      false,
      new FleetAiCircuit(10),
      1,
    )).rejects.toBeInstanceOf(FleetAiDependencyError);

    expect(run).toHaveBeenCalledTimes(2);
    expect(rec.steps.some(step => step.kind === 'ship-repair')).toBe(false);
    expect(rec.steps).toContainEqual(expect.objectContaining({
      kind: 'ship-error',
      detail: expect.objectContaining({ retryable: true, providerCircuitOpen: true }),
    }));
  });

  it('malformed steel-man ⇒ transcript error step, BROKEN-SHIP result, and a hard stop (no second AI call, no git writes)', async () => {
    const { ai } = seqAi(['I refuse to emit JSON.', TESTS_JSON]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true }), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics(),
    );

    // Broken-ship doctrine (2026-08-19): the purser never bluffs a contract it
    // failed to build, but it also never quietly passes over its own breakage —
    // errored:true fails the run so the malformed steel-man gets fixed.
    expect(result).toMatchObject({ ship: 'purser', blocking: true, verdict: 'BLOCK', errored: true });
    // …and that errored result really does resolve to a run-level failure.
    expect(aggregateConclusion([result])).toBe('failure');
    const step = rec.steps.find(s => s.kind === 'purser-steelman');
    expect(step).toBeDefined();
    expect(step!.title).toMatch(/MALFORMED/);
    expect((step!.detail as { error: string }).error).toMatch(/fenced JSON/);
    // The REPAIR pass (src/repair.ts) got its two bounded attempts — one on
    // the ship's own model, one on the escalation tier — and both failed, so
    // the transcript carries an honest ship-repair FAILED step. 1 original +
    // 2 repair calls, and still nothing touched on the Git Data API.
    const repairStep = rec.steps.find(s => s.kind === 'ship-repair')!;
    expect(repairStep).toBeDefined();
    expect(repairStep.title).toMatch(/repair FAILED after 2 attempt/);
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
    expect(state.records.filter(r => r.url.includes('/git/'))).toHaveLength(0);
  });

  it('a malformed steel-man that REPAIRS on retry proceeds normally (healed, not broken)', async () => {
    // Call 1: garbage. Call 2 (repair, same model): the real contract. The
    // purser then continues into planning/authoring as if nothing happened.
    const { ai } = seqAi(['I refuse to emit JSON.', STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true }), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics(),
    );

    expect(result.errored).toBe(false);
    const repairStep = rec.steps.find(s => s.kind === 'ship-repair')!;
    expect(repairStep.title).toMatch(/repair HEALED/);
    const steelStep = rec.steps.find(s => s.kind === 'purser-steelman')!;
    expect(steelStep.title).toContain('2 obligation(s)');
    // The healed contract still reaches the PR summary.
    expect(state.prPatches.some(p => typeof p.body === 'string')).toBe(true);
  });

  it('a well-formed steel-man is written into the PR SUMMARY (the PR body), between markers', async () => {
    // Operator mandate (2026-08-19): the steel-man argument and its
    // obligations are the best chronology of what a PR should be — an agent
    // maintains them in the PR body, not only in a comment that scrolls away.
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();

    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics());

    const bodyPatch = state.prPatches.find(p => p.number === 7 && typeof p.body === 'string');
    expect(bodyPatch).toBeDefined();
    const body = bodyPatch!.body!;
    expect(body).toContain(PURSER_CONTRACT_START);
    expect(body).toContain(PURSER_CONTRACT_END);
    expect(body).toContain('Contract (steel-manned by pd-purser)');
    expect(body).toContain('Guarantee the widget frobs deterministically.');
    expect(body).toContain('1. frobs on empty input without throwing');
    expect(body).toContain('2. rejects negative ids with a typed error');

    const step = rec.steps.find(s => s.kind === 'purser-contract-posted')!;
    expect(step).toBeDefined();
    expect(step.title).toContain('written into the PR summary');
    expect(step.detail).toMatchObject({ posted: true, obligationCount: 2 });
  });

  it('buildContractBodySection renders the purpose and every numbered obligation', () => {
    const section = buildContractBodySection({
      purpose: 'p',
      obligations: ['first', 'second', 'third'],
      testTargets: [],
    });
    expect(section).toContain('**Purpose:** p');
    expect(section).toContain('1. first');
    expect(section).toContain('3. third');
    expect(section).toContain('Maintained by pd-purser');
  });

  it('a well-formed steel-man records purpose + the full obligations text (not just the count) in the transcript', async () => {
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();

    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics());

    const step = rec.steps.find(s => s.kind === 'purser-steelman')!;
    expect(step.title).toContain('2 obligation(s)');
    expect(step.detail).toMatchObject({
      purpose: 'Guarantee the widget frobs deterministically.',
      obligationCount: 2,
      // The run page renders these verbatim (fleet-run-page.ts's
      // purser-steelman case) — only the count used to survive to D1, which
      // meant the operator had to open the PR to read what was actually held.
      obligations: ['frobs on empty input without throwing', 'rejects negative ids with a typed error'],
    });
  });
});

describe('runPurser — authored-test validation', () => {
  it('path traversal in authored tests is rejected: transcript error, BROKEN-SHIP result, no git writes', async () => {
    const evil = '```json\n' + JSON.stringify({ files: [{ path: '../../etc/evil.test.ts', contents: 'x' }] }) + '\n```';
    const { ai } = seqAi([STEELMAN_JSON, evil]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true }), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics(),
    );

    // Rejected output never reaches git — and the broken ship fails the run.
    expect(result).toMatchObject({ blocking: true, verdict: 'BLOCK', errored: true });
    const step = rec.steps.find(s => s.kind === 'purser-tests')!;
    expect(step.title).toMatch(/REJECTED/);
    expect((step.detail as { error: string }).error).toMatch(/traversal/);
    expect(state.records.filter(r => r.url.includes('/git/'))).toHaveLength(0);
    expect(state.stackedPrs).toHaveLength(0);
  });

  it('a testPaths-constrained purser rejects tests outside its path prefixes', async () => {
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]); // authored under tests/purser/
    const rec = recorder();

    const result = await runPurser(
      mkShip({ testPaths: ['spec/adversarial'] }), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics(),
    );

    expect(result.verdict).toBe('PASS');
    const step = rec.steps.find(s => s.kind === 'purser-tests')!;
    expect((step.detail as { error: string }).error).toMatch(/testPaths/);
    expect(state.stackedPrs).toHaveLength(0);
  });

  it('the plan prompt asks for a DIRECTORY, not a string prefix', () => {
    // The failure this pins, observed on #7175: the prompt said "prefixes:
    // tests/purser", the model planned `tests/purser-authoring.test.ts`
    // (mirroring the file it was grilling), and the validator — which requires
    // `path === g || path.startsWith(g + '/')` — rejected every file. The run
    // stacked nothing, and the transcript read as though the purser had failed
    // to produce tests rather than having been asked for the wrong shape.
    const prompt = testPlanSystemPrompt(
      mkShip({ testPaths: ['tests/purser'] }),
      { purpose: 'p', obligations: ['o'], testTargets: ['src/widget.ts'] },
      '',
    );

    expect(prompt).toContain('tests/purser/');
    expect(prompt).toMatch(/INSIDE one of these directories/);
    // The sibling path is named as a counter-example, so the instruction and
    // the enforcement agree on the one case that silently produced no tests.
    expect(prompt).toContain('tests/purser-my-case.test.ts');
    expect(prompt).not.toMatch(/under one of these prefixes/);
  });

  it('valid tests record files + bytes in the purser-tests step', async () => {
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();

    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics());

    const step = rec.steps.find(s => s.kind === 'purser-tests')!;
    expect(step.title).toContain('authored 1 adversarial test file(s)');
    const detail = step.detail as { files: Array<{ path: string; bytes: number }>; totalBytes: number };
    expect(detail.files[0].path).toBe('tests/purser/widget.contract.test.ts');
    expect(detail.totalBytes).toBeGreaterThan(0);
  });
});

describe('runPurser — stacking', () => {
  it('same-repo PR, tests EXECUTED and PASSED: branch from BASE sha, stacked test PR opened, original PR retargeted onto the tests', async () => {
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();

    await runPurser(
      mkShip(), mkCtx(), makeEnv({ AI: ai, SANDBOX: sandboxStub(0) }), 'tok', rec.transcript, freshMetrics(),
    );

    // Branch cut from the PR's BASE sha (never head): the commit parents on BASESHA.
    const commitPost = state.records.find(r => r.method === 'POST' && /\/git\/commits$/.test(r.url));
    expect((commitPost!.body as { parents: string[] }).parents).toEqual(['BASESHA']);
    expect(state.gitRefs.has('purser/pr-7-tests')).toBe(true);

    // Stacked PR: head = purser branch, base = the PR's base branch.
    expect(state.stackedPrs).toHaveLength(1);
    expect(state.stackedPrs[0]).toMatchObject({
      head: 'purser/pr-7-tests',
      base: 'main',
      title: 'purser: adversarial tests for #7',
    });
    expect(state.stackedPrs[0].body).toContain('Obligations under test');

    // The reviewed PR was retargeted ONTO the test branch (stacked on top) —
    // only because sandbox.executed is true (the tests actually ran).
    expect(state.prPatches).toContainEqual(
      expect.objectContaining({ number: 7, base: 'purser/pr-7-tests' }),
    );

    const step = rec.steps.find(s => s.kind === 'purser-stacked')!;
    expect(step.detail).toMatchObject({ testPrNumber: 8001, retargeted: true, sandboxExecuted: true });

    // The demand comment is posted, firm and referenced.
    const bodies = purserCommentBodies(state);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('steel-manned');
    expect(bodies[0]).toContain('retargeted onto that test branch');
  });

  it('same-repo PR, tests NOT EXECUTED (no SANDBOX binding): stacked test PR opened, but the reviewed PR is NOT retargeted', async () => {
    // Reproduces the root cause of #5860: a purser retargeted the reviewed PR
    // onto a test branch whose tests had never been executed ("the body
    // admitted they were not run"). Retargeting must never happen on faith.
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();

    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics());

    // The test PR is still opened (advisory evidence of the contract)...
    expect(state.stackedPrs).toHaveLength(1);
    // ...but the implementation PR's base is explicitly left UNCHANGED.
    expect(state.prPatches.filter(p => p.number === 7 && p.base)).toHaveLength(0);

    const step = rec.steps.find(s => s.kind === 'purser-stacked')!;
    expect(step.detail).toMatchObject({ retargeted: false, sandboxExecuted: false });
    expect((step.detail as { retargetSkipped?: string }).retargetSkipped).toMatch(/not executed/);

    const bodies = purserCommentBodies(state);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('NOT been retargeted');
    expect(bodies[0]).toContain('not executed');
  });

  it('same-repo PR, generated assertions FAIL: the reviewed PR is blocked but never retargeted', async () => {
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();

    const result = await runPurser(
      mkShip(),
      mkCtx(),
      makeEnv({ AI: ai, SANDBOX: sandboxStub(1, '  ✕ rejects a placeholder mismatch') }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'BLOCK' });
    expect(result.errored).not.toBe(true);
    expect(state.stackedPrs).toHaveLength(1);
    expect(state.prPatches.filter(p => p.number === 7 && p.base)).toHaveLength(0);
    const step = rec.steps.find(s => s.kind === 'purser-stacked')!;
    expect((step.detail as { retargetSkipped?: string }).retargetSkipped).toMatch(
      /did not pass/,
    );
  });

  it('same-repo PR, generated suite loads zero tests: disables Purser as broken machinery and never retargets', async () => {
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true }),
      mkCtx(),
      makeEnv({ AI: ai, SANDBOX: sandboxHarnessFailure('zero tests registered') }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'BLOCK', errored: true });
    expect(state.stackedPrs).toHaveLength(1);
    expect(state.prPatches.filter(p => p.number === 7 && p.base)).toHaveLength(0);
    const sandboxStep = rec.steps.find(s => s.kind === 'purser-sandbox')!;
    expect(sandboxStep.title).toContain('RUNNER ERROR');
    expect(sandboxStep.detail).toMatchObject({ outcomeKind: 'harness-failure' });
    const stackedStep = rec.steps.find(s => s.kind === 'purser-stacked')!;
    expect((stackedStep.detail as { retargetSkipped?: string }).retargetSkipped).toMatch(
      /broken for this run/,
    );
    expect(purserCommentBodies(state)[0]).toContain('NO AUTHOR FAILURE CLAIMED');
  });

  it('fork PR: the test PR is opened + comment posted, but NO retarget', async () => {
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();

    await runPurser(
      mkShip(), mkCtx({ isFork: true }), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics(),
    );

    expect(state.stackedPrs).toHaveLength(1);
    // No base-retarget PATCH ever hit PR #7.
    expect(state.prPatches.filter(p => p.number === 7 && p.base)).toHaveLength(0);
    const step = rec.steps.find(s => s.kind === 'purser-stacked')!;
    expect(step.detail).toMatchObject({ retargeted: false });
    const bodies = purserCommentBodies(state);
    expect(bodies[0]).toContain('comes from a fork');
    expect(bodies[0]).toContain('must satisfy those tests');
  });

  it('403 (App lacks contents:write): degrades honestly — tests inline in the comment, permission named, broken ship fails the run', async () => {
    state.failGitWrites403 = true;
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, blockWithoutSandbox: true }),
      mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics(),
    );

    // No fabricated sandbox verdict — but the fleet's machinery could not do
    // its job, so the run fails (errored) until the permission lands. The
    // comment + interruption below still name the exact human ask.
    expect(result).toMatchObject({ blocking: true, verdict: 'BLOCK', errored: true });
    expect(state.stackedPrs).toHaveLength(0);

    const step = rec.steps.find(s => s.kind === 'purser-stacked')!;
    expect(step.title).toMatch(/degraded/);
    expect((step.detail as { degraded: string }).degraded).toMatch(/contents: write/);

    const bodies = purserCommentBodies(state);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('contents: write');
    // The authored test contents are posted inline so nothing is lost.
    expect(bodies[0]).toContain('tests/purser/widget.contract.test.ts');
    expect(bodies[0]).toContain('it("frobs empty input", () => {});');
  });

  it('re-run is idempotent: same branch force-updated, same test PR reused, no duplicates', async () => {
    const mk = () => seqAi([STEELMAN_JSON, TESTS_JSON]).ai;
    const rec = recorder();

    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: mk() }), 'tok', rec.transcript, freshMetrics());
    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: mk() }), 'tok', rec.transcript, freshMetrics());

    expect(state.refCreates).toBe(1);
    expect(state.refUpdates).toBe(1); // second run force-moved the ref
    expect(state.stackedPrs).toHaveLength(1); // no duplicate test PR
  });
});

describe('runPurser — executability gate (regression: PR #5860 non-executable Purser theater)', () => {
  // Read the repository's actual config instead of copying its two patterns
  // into a test fixture that could drift while continuing to pass.
  const REAL_JEST_CONFIG = readFileSync(new URL('../../../jest.config.js', import.meta.url), 'utf8');

  function seedRealJestConfig(): void {
    state.files.set('BASESHA:jest.config.js', REAL_JEST_CONFIG);
  }

  it('#5860 exact shape: tests/purser/test_*.js outside testMatch AND importing nonexistent ../support ⇒ rejected as non-executable, no branch/PR/retarget', async () => {
    seedRealJestConfig();
    const badTests = [
      '```json',
      JSON.stringify({
        files: [
          {
            path: 'tests/purser/test_error-handling.js',
            contents:
              "const { isRetryable } = require('../support');\n" +
              "it('flags retryable errors', () => { isRetryable(new Error('x')); });",
          },
        ],
      }),
      '```',
    ].join('\n');
    const { ai } = seqAi([STEELMAN_JSON, badTests]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, blockWithoutSandbox: true }),
      mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics(),
    );

    // No fabricated sandbox result for tests that structurally could not run —
    // but a purser that authored undiscoverable tests is a BROKEN SHIP, and
    // the run fails (errored) until the authoring/config defect is fixed.
    expect(result).toMatchObject({ blocking: true, verdict: 'BLOCK', errored: true });

    const step = rec.steps.find(s => s.kind === 'purser-tests' && /NON-EXECUTABLE/.test(s.title));
    expect(step).toBeDefined();
    expect((step!.detail as { error: string }).error).toMatch(/outside the repo's configured test discovery path/);

    // Fail closed BEFORE ever WRITING to the Git Data API: no branch, no
    // blobs, no commits, no stacked test PR, and — the actual #5860 defect —
    // the reviewed implementation PR's base is left completely untouched.
    // (A read-only GET against /git/trees/.../recursive=1 IS expected: that is
    // this very gate fetching its own evidence.)
    expect(
      state.records.filter(r => r.url.includes('/git/') && r.method !== 'GET'),
    ).toHaveLength(0);
    expect(state.stackedPrs).toHaveLength(0);
    expect(state.prPatches.filter(p => p.number === 7 && p.base)).toHaveLength(0);

    // The prompts/contract are still preserved as ADVISORY EVIDENCE — a human
    // can read what the purser demanded even though nothing was stacked.
    const bodies = purserCommentBodies(state);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('steel-manned');
    expect(bodies[0]).toContain('executability gate');
    expect(bodies[0]).toContain('tests/purser/test_error-handling.js');
  });

  it('#8298 exact shape: a non-discoverable plan is repaired BEFORE authoring, then reaches sandbox and stacks', async () => {
    seedRealJestConfig();
    const trustedPatterns = extractJestTestMatch(REAL_JEST_CONFIG)!;
    expect(matchesAnyTestMatch(
      'tests/unit/purser/test-legacy-phrase-variants.ts',
      trustedPatterns,
    )).toBe(false);
    expect(matchesAnyTestMatch(
      'tests/unit/purser/legacy-phrase-variants.test.ts',
      trustedPatterns,
    )).toBe(true);
    const badPlan = [
      '```json',
      JSON.stringify({
        files: [{
          path: 'tests/unit/purser/test-legacy-phrase-variants.ts',
          intent: 'grill the legacy dead-letter phrase',
        }],
      }),
      '```',
    ].join('\n');
    const repairedPlan = [
      '```json',
      JSON.stringify({
        files: [{
          path: 'tests/unit/purser/legacy-phrase-variants.test.ts',
          intent: 'grill the legacy dead-letter phrase',
        }],
      }),
      '```',
    ].join('\n');
    const authoredFile = [
      '```ts',
      "describe('legacy phrase', () => {",
      "  it('keeps the exact phrase', () => expect('dead-lettered').toContain('dead-lettered'));",
      '});',
      '```',
    ].join('\n');
    const { ai } = seqAi([STEELMAN_JSON, badPlan, repairedPlan, authoredFile]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ testPaths: ['tests/unit/purser'] }),
      mkCtx(),
      makeEnv({ AI: ai, SANDBOX: sandboxStub(0) }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'PASS', errored: false });
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
    const repairRequest = (ai.run as ReturnType<typeof vi.fn>).mock.calls[2][1] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(repairRequest.messages[0].content).toContain(
      '<rootDir>/tests/unit/**/*.test.{js,ts}',
    );
    const repairStep = rec.steps.find(s => s.kind === 'ship-repair')!;
    expect(repairStep.title).toContain('HEALED');
    expect((repairStep.detail as { reason: string }).reason).toContain(
      'tests/unit/purser/test-legacy-phrase-variants.ts',
    );
    const planStep = rec.steps.find(s => s.kind === 'purser-plan')!;
    expect(planStep.detail).toMatchObject({
      files: [{ path: 'tests/unit/purser/legacy-phrase-variants.test.ts' }],
    });
    expect(rec.steps.find(s => s.kind === 'purser-sandbox')?.detail).toMatchObject({
      executed: true,
      passed: true,
    });
    expect(state.stackedPrs).toHaveLength(1);
  });

  it('#9761 live shape: a malformed plan repair cannot heal to undiscoverable paths without runner evidence', async () => {
    seedRealJestConfig();
    const malformedPlan = 'I cannot provide the requested JSON file plan.';
    const undiscoverableRepair = [
      '```json',
      JSON.stringify({
        files: [{
          path: 'tests/unit/purser/invalid-syntax.ts',
          intent: 'reject malformed generated source before side effects',
        }],
      }),
      '```',
    ].join('\n');
    const discoverableRepair = [
      '```json',
      JSON.stringify({
        files: [{
          path: 'tests/unit/purser/invalid-syntax.test.ts',
          intent: 'reject malformed generated source before side effects',
        }],
      }),
      '```',
    ].join('\n');
    const authoredFile = [
      '```ts',
      "it('rejects malformed source', () => expect('complete source').not.toContain('...'));",
      '```',
    ].join('\n');
    const { ai } = seqAi([
      STEELMAN_JSON,
      malformedPlan,
      undiscoverableRepair,
      discoverableRepair,
      authoredFile,
    ]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ testPaths: ['tests/unit/purser'] }),
      mkCtx(),
      makeEnv({ AI: ai, SANDBOX: sandboxStub(0) }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'PASS', errored: false });
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(5);
    const firstRepairRequest = (ai.run as ReturnType<typeof vi.fn>).mock.calls[2][1] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(firstRepairRequest.messages[0].content).toContain(
      '<rootDir>/tests/unit/**/*.test.{js,ts}',
    );
    expect(rec.steps.find(s => s.kind === 'purser-plan')?.detail).toMatchObject({
      files: [{ path: 'tests/unit/purser/invalid-syntax.test.ts' }],
    });
    expect(rec.steps.some(step => JSON.stringify(step.detail).includes('invalid-syntax.ts'))).toBe(false);
    expect(rec.steps.find(s => s.kind === 'purser-sandbox')?.detail).toMatchObject({
      executed: true,
      passed: true,
    });
    expect(state.stackedPrs).toHaveLength(1);
  });

  it('#8335 exact shape: one nested import is repaired deterministically without touching a valid sibling, then stacks', async () => {
    seedRealJestConfig();
    state.treeFiles.set('BASESHA', ['scripts/check-pr-comments-answered.mjs']);
    const plan = [
      '```json',
      JSON.stringify({
        files: [
          {
            path: 'tests/unit/purser/test-pagination-truncation.test.js',
            intent: 'grill incomplete pagination without a false green',
          },
          {
            path: 'tests/unit/purser/valid-sibling.test.js',
            intent: 'retain an already executable sibling byte-for-byte',
          },
        ],
      }),
      '```',
    ].join('\n');
    const shallowImport = [
      '```js',
      "import { decideCommentGate } from '../../scripts/check-pr-comments-answered.mjs';",
      "it('fails closed', () => decideCommentGate([], 'author', { truncated: true }));",
      '```',
    ].join('\n');
    const validSibling = [
      '```js',
      "const VALID_SIBLING_MARKER = 'keep-these-bytes';",
      "it('keeps the sibling', () => VALID_SIBLING_MARKER);",
      '```',
    ].join('\n');
    const { ai } = seqAi([
      STEELMAN_JSON,
      plan,
      shallowImport,
      validSibling,
    ]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ testPaths: ['tests/unit/purser'] }),
      mkCtx(),
      makeEnv({ AI: ai, SANDBOX: sandboxStub(0) }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'PASS', errored: false });
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
    expect(rec.steps.find(s => s.kind === 'purser-author-repair')).toMatchObject({
      title: expect.stringContaining('HEALED'),
      detail: expect.objectContaining({
        attempts: 0,
        strategy: 'trusted-tree-relative-import',
        repairs: [expect.objectContaining({
          fromSpecifier: '../../scripts/check-pr-comments-answered.mjs',
          toSpecifier: '../../../scripts/check-pr-comments-answered.mjs',
        })],
      }),
    });
    expect(rec.steps.some(s => s.kind === 'purser-tests' && /NON-EXECUTABLE/.test(s.title))).toBe(false);
    expect(state.stackedPrs).toHaveLength(1);
    const blobBodies = state.records
      .filter(record => record.url.includes('/git/blobs'))
      .map(record => String((record.body as { content?: string })?.content ?? ''));
    expect(blobBodies).toContain("const VALID_SIBLING_MARKER = 'keep-these-bytes';\nit('keeps the sibling', () => VALID_SIBLING_MARKER);");
    expect(blobBodies.some(body => body.includes("from '../../../scripts/check-pr-comments-answered.mjs'"))).toBe(true);
    expect(blobBodies.some(body => body.includes("from '../../scripts/check-pr-comments-answered.mjs'"))).toBe(false);
  });

  it('does not batch-replan an out-of-testPaths sibling or discard a valid nested file', async () => {
    seedRealJestConfig();
    const mixedPlan = [
      '```json',
      JSON.stringify({
        files: [
          {
            path: 'tests/unit/else/outside.test.ts',
            intent: 'outside this ship but visible to the repository runner',
          },
          {
            path: 'tests/unit/purser/nested/inside.test.ts',
            intent: 'valid nested file that must survive its invalid sibling',
          },
        ],
      }),
      '```',
    ].join('\n');
    const outsideBody = '```ts\nit("outside", () => {});\n```';
    const insideBody = '```ts\nit("inside", () => {});\n```';
    const { ai } = seqAi([STEELMAN_JSON, mixedPlan, outsideBody, insideBody]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ testPaths: ['tests/unit/purser'] }),
      mkCtx(),
      makeEnv({ AI: ai, SANDBOX: sandboxStub(0) }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'PASS', errored: false });
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
    expect(rec.steps.some(s => s.kind === 'ship-repair')).toBe(false);
    const testsStep = rec.steps.find(s => s.kind === 'purser-tests')!;
    expect((testsStep.detail as { files: Array<{ path: string }> }).files).toEqual([
      expect.objectContaining({ path: 'tests/unit/purser/nested/inside.test.ts' }),
    ]);
    expect((testsStep.detail as { failures: Array<{ path: string }> }).failures).toEqual([
      expect.objectContaining({ path: 'tests/unit/else/outside.test.ts' }),
    ]);
    expect(state.stackedPrs).toHaveLength(1);
  });

  it('stops after bounded plan repair when every attempt keeps an invisible filename', async () => {
    seedRealJestConfig();
    const badPlan = [
      '```json',
      JSON.stringify({
        files: [{
          path: 'tests/unit/purser/test-never-discovered.ts',
          intent: 'this must not consume an authoring call',
        }],
      }),
      '```',
    ].join('\n');
    const { ai } = seqAi([STEELMAN_JSON, badPlan, badPlan, badPlan]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, testPaths: ['tests/unit/purser'] }),
      mkCtx(),
      makeEnv({ AI: ai }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'BLOCK', errored: true });
    // Steel-man + plan + exactly two bounded repair attempts. No file-author
    // call is made for a path the trusted test runner cannot discover.
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
    const step = rec.steps.find(s => s.kind === 'purser-plan' && /NON-DISCOVERABLE/.test(s.title));
    expect(step?.detail).toMatchObject({
      files: ['tests/unit/purser/test-never-discovered.ts'],
    });
    expect(state.stackedPrs).toHaveLength(0);
  });

  it('a path-valid file with an unresolved relative import is rejected on import resolution alone', async () => {
    seedRealJestConfig();
    // Seed a tree WITHOUT tests/unit/support.* — the import must not resolve.
    state.treeFiles.set('BASESHA', ['tests/unit/other.test.js']);
    const badImportTests = [
      '```json',
      JSON.stringify({
        files: [
          {
            path: 'tests/unit/widget.contract.test.js',
            contents: "const { helper } = require('../support');\nit('x', () => { helper(); });",
          },
        ],
      }),
      '```',
    ].join('\n');
    const stillBadRepair = [
      '```js',
      "const { helper } = require('../support');",
      "it('x', () => { helper(); });",
      '```',
    ].join('\n');
    const { ai } = seqAi([STEELMAN_JSON, badImportTests, stillBadRepair]);
    const rec = recorder();

    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics());

    const step = rec.steps.find(s => s.kind === 'purser-tests' && /NON-EXECUTABLE/.test(s.title));
    expect(step).toBeDefined();
    expect((step!.detail as { error: string }).error).toMatch(/does not resolve to any file/);
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
    const repairSteps = rec.steps.filter(s => s.kind === 'purser-author-repair');
    expect(repairSteps).toHaveLength(2);
    expect(repairSteps[1]).toMatchObject({
      title: expect.stringContaining('FAILED'),
      detail: expect.objectContaining({ attempts: 2 }),
    });
    expect(state.stackedPrs).toHaveLength(0);
    // No retarget PATCH — the only PR PATCH allowed here is the steel-man
    // contract being written into the PR summary (carries `body`, never `base`).
    expect(state.prPatches.filter(p => p.base)).toHaveLength(0);
  });

  it('#9789: a second bounded escalation rewrite heals when the first rewrite is still malformed', async () => {
    seedRealJestConfig();
    const malformedTests = [
      '```json',
      JSON.stringify({
        files: [{
          path: 'tests/unit/release-token-fallback.test.js',
          contents: 'export function parseStableVersion(value) { ... }',
        }],
      }),
      '```',
    ].join('\n');
    const firstRepairWithEvolvedError = [
      '```js',
      "const { helper } = require('../missing-support');",
      "test('first repair is syntactically complete', () => { helper(); });",
      '```',
    ].join('\n');
    const completeRepair = [
      '```js',
      "test('complete source reaches the trusted runner', () => {",
      '  expect(1).toBe(1);',
      '});',
      '```',
    ].join('\n');
    const { ai } = seqAi([
      STEELMAN_JSON,
      malformedTests,
      firstRepairWithEvolvedError,
      completeRepair,
    ]);
    const sandboxExec = vi.fn(async () => ({ exitCode: 0, stdout: 'PASS', stderr: '' }));
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true }),
      mkCtx(),
      makeEnv({ AI: ai, SANDBOX: { exec: sandboxExec } as unknown }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'PASS', errored: false });
    const repairSteps = rec.steps.filter(s => s.kind === 'purser-author-repair');
    expect(repairSteps).toHaveLength(2);
    expect(repairSteps[0]).toMatchObject({
      title: expect.stringContaining('FAILED'),
      detail: expect.objectContaining({
        attempts: 1,
        result: expect.stringContaining('does not resolve to any file'),
      }),
    });
    expect(repairSteps[1]).toMatchObject({
      title: expect.stringContaining('HEALED'),
      detail: expect.objectContaining({ attempts: 2 }),
    });
    expect(rec.steps.find(s => s.kind === 'purser-tests' && /NON-EXECUTABLE/.test(s.title)))
      .toBeUndefined();
    const secondRepairRequest = (ai.run as ReturnType<typeof vi.fn>).mock.calls[3][1] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(secondRepairRequest.messages[0].content).toContain(
      'does not resolve to any file',
    );
    expect(secondRepairRequest.messages[0].content).toContain(
      "test('first repair is syntactically complete'",
    );
    expect(secondRepairRequest.messages[0].content).toContain('<rejected-draft>');
    expect(secondRepairRequest.messages[1].content).toContain('Target path: tests/unit/release-token-fallback.test.js');
    expect(secondRepairRequest.messages[1].content).toContain('- src/widget.ts');
    expect(secondRepairRequest.messages[1].content).not.toContain('## Diff');
    expect(sandboxExec).toHaveBeenCalledTimes(1);
    expect(state.stackedPrs).toHaveLength(1);
  });

  it('#9893: deterministically heals an import introduced by the first model rewrite without spending the second call', async () => {
    seedRealJestConfig();
    state.treeFiles.set('BASESHA', ['scripts/release-workflow-state.mjs']);
    const testPath = 'tests/unit/purser/prerelease-exclusion.test.js';
    const plan = [
      '```json',
      JSON.stringify({
        files: [{ path: testPath, intent: 'exclude prerelease tags from stable selection' }],
      }),
      '```',
    ].join('\n');
    const missingRegistration = [
      '```js',
      "export const candidate = 'v3.30.3';",
      '```',
    ].join('\n');
    const firstRewriteWithShallowImport = [
      '```js',
      "import { latestStableTag } from '../../scripts/release-workflow-state.mjs';",
      "test('excludes prereleases', () => expect(latestStableTag(['v3.30.3-rc.1', 'v3.30.2'])).toBe('v3.30.2'));",
      '```',
    ].join('\n');
    const { ai } = seqAi([
      STEELMAN_JSON,
      plan,
      missingRegistration,
      firstRewriteWithShallowImport,
    ]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, testPaths: ['tests/unit/purser'] }),
      mkCtx({
        files: [{
          filename: 'scripts/release-workflow-state.mjs',
          status: 'modified',
          additions: 3,
          deletions: 1,
        }],
      }),
      makeEnv({ AI: ai, SANDBOX: sandboxStub(0) }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'PASS', errored: false });
    // Steel-man + plan + initial author + exactly one model rewrite. The
    // trusted-tree repair handles the evolved import failure locally.
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
    expect(rec.steps.find(step =>
      step.kind === 'purser-author-repair' &&
      (step.detail as { strategy?: string }).strategy ===
        'trusted-tree-relative-import-after-model-rewrite'
    )).toMatchObject({
      title: expect.stringContaining('HEALED'),
      detail: expect.objectContaining({
        attempts: 0,
        fromSpecifier: '../../scripts/release-workflow-state.mjs',
        toSpecifier: '../../../scripts/release-workflow-state.mjs',
      }),
    });
    expect(rec.steps.find(step =>
      step.kind === 'purser-tests' && /NON-EXECUTABLE/.test(step.title)
    )).toBeUndefined();
    expect(state.stackedPrs).toHaveLength(1);
  });

  it('#9892: rescues a no-content initial author with the existing bounded escalation budget', async () => {
    seedRealJestConfig();
    const testPath = 'tests/unit/purser/signing-discovery-edge-cases.test.ts';
    const plan = [
      '```json',
      JSON.stringify({ files: [{ path: testPath, intent: 'grill nested Mach-O discovery' }] }),
      '```',
    ].join('\n');
    const rescuedFile = [
      '```ts',
      "test('discovers nested Mach-O files', () => {",
      "  expect(['native/libonnxruntime.dylib']).toHaveLength(1);",
      '});',
      '```',
    ].join('\n');
    const { ai } = seqAi([STEELMAN_JSON, plan, 'I cannot provide the requested file.', rescuedFile]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, testPaths: ['tests/unit/purser'] }),
      mkCtx(),
      makeEnv({ AI: ai, SANDBOX: sandboxStub(0) }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'PASS', errored: false });
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
    expect(rec.steps.find(step =>
      step.kind === 'purser-author-repair' &&
      (step.detail as { strategy?: string }).strategy === 'bounded-empty-author-escalation'
    )).toMatchObject({
      title: expect.stringContaining(`HEALED ${testPath}`),
      detail: expect.objectContaining({ attempts: 1, repairNumber: 1 }),
    });
    expect(state.stackedPrs).toHaveLength(1);
  });

  it('drops sequential exhausted malformed files while executing a valid sibling', async () => {
    seedRealJestConfig();
    const firstBrokenPath = 'tests/unit/purser/malformed-generated-a.test.ts';
    const secondBrokenPath = 'tests/unit/purser/malformed-generated-b.test.ts';
    const validPath = 'tests/unit/purser/valid-generated.test.ts';
    const plan = [
      '```json',
      JSON.stringify({
        files: [
          { path: firstBrokenPath, intent: 'grill first malformed generation' },
          { path: secondBrokenPath, intent: 'grill second malformed generation' },
          { path: validPath, intent: 'retain valid adversarial evidence' },
        ],
      }),
      '```',
    ].join('\n');
    const firstMalformed = '```ts\nexport function brokenA() { ... }\n```';
    const secondMalformed = '```ts\nexport function brokenB() { ... }\n```';
    const valid = '```ts\ntest("valid sibling", () => expect(true).toBe(true));\n```';
    const firstRepairOne = '```ts\nconst valueA: = 1;\ntest("still bad A", () => valueA);\n```';
    const firstRepairTwo = '```ts\nfunction nopeA( {\ntest("still bad A", () => true);\n```';
    const secondRepairOne = '```ts\nconst valueB: = 1;\ntest("still bad B", () => valueB);\n```';
    const secondRepairTwo = '```ts\nfunction nopeB( {\ntest("still bad B", () => true);\n```';
    const { ai } = seqAi([
      STEELMAN_JSON,
      plan,
      firstMalformed,
      secondMalformed,
      valid,
      firstRepairOne,
      firstRepairTwo,
      secondRepairOne,
      secondRepairTwo,
    ]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, testPaths: ['tests/unit/purser'] }),
      mkCtx(),
      makeEnv({ AI: ai, SANDBOX: sandboxStub(0) }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'PASS', errored: false });
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(9);
    const drops = rec.steps.filter(step =>
      step.kind === 'purser-author-repair' &&
      (step.detail as { strategy?: string }).strategy === 'bounded-partial-executability'
    );
    expect(drops).toHaveLength(2);
    expect(drops[0]).toMatchObject({
      title: expect.stringContaining(`DROPPED ${firstBrokenPath}`),
      detail: expect.objectContaining({
        attempts: 2,
        survivors: [secondBrokenPath, validPath],
      }),
    });
    expect(drops[1]).toMatchObject({
      title: expect.stringContaining(`DROPPED ${secondBrokenPath}`),
      detail: expect.objectContaining({
        attempts: 2,
        survivors: [validPath],
        result: 'trusted executability gate passed on survivors',
      }),
    });
    expect(rec.steps.find(step =>
      step.kind === 'purser-tests' && /NON-EXECUTABLE/.test(step.title)
    )).toBeUndefined();
    expect(state.stackedPrs).toHaveLength(1);
  });

  it('reapplies trusted zero-model repair after the global model budget drops an exhausted sibling', async () => {
    seedRealJestConfig();
    const target = 'apps/fleet-executor/src/purser-executability.ts';
    state.treeFiles.set('BASESHA', [target]);
    const brokenPaths = [
      'tests/unit/purser/exhaust-budget-a.test.ts',
      'tests/unit/purser/exhaust-budget-b.test.ts',
      'tests/unit/purser/exhaust-budget-c.test.ts',
    ];
    const repairablePath = 'tests/unit/purser/repair-after-budget.test.ts';
    const plan = [
      '```json',
      JSON.stringify({
        files: [
          ...brokenPaths.map(path => ({ path, intent: `consume bounded repair budget for ${path}` })),
          { path: repairablePath, intent: 'verify trusted import repair survives exhausted model budget' },
        ],
      }),
      '```',
    ].join('\n');
    const malformed = (name: string) => `\`\`\`ts\nfunction ${name}( {\ntest('still malformed', () => true);\n\`\`\``;
    const repairable = [
      '```ts',
      "import { checkGeneratedTestsExecutable } from '../../apps/fleet-executor/src/purser-executability';",
      "test('loads the trusted gate', () => expect(checkGeneratedTestsExecutable).toBeDefined());",
      '```',
    ].join('\n');
    const { ai } = seqAi([
      STEELMAN_JSON,
      plan,
      malformed('brokenA'),
      malformed('brokenB'),
      malformed('brokenC'),
      repairable,
      malformed('repairA1'),
      malformed('repairA2'),
      malformed('repairB1'),
      malformed('repairB2'),
      malformed('repairC1'),
    ]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, testPaths: ['tests/unit/purser'] }),
      mkCtx({ files: [{ filename: target, status: 'modified', additions: 3, deletions: 1 }] }),
      makeEnv({ AI: ai, SANDBOX: sandboxStub(0) }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'PASS', errored: false });
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(11);
    expect(rec.steps.filter(step =>
      step.kind === 'purser-author-repair' &&
      (step.detail as { strategy?: string }).strategy === 'bounded-partial-executability'
    )).toHaveLength(3);
    expect(rec.steps.find(step =>
      step.kind === 'purser-author-repair' &&
      (step.detail as { strategy?: string }).strategy ===
        'trusted-tree-relative-import-after-sibling-drop'
    )).toMatchObject({
      title: expect.stringContaining(`HEALED ${repairablePath}`),
      detail: expect.objectContaining({
        attempts: 0,
        fromSpecifier: '../../apps/fleet-executor/src/purser-executability',
        toSpecifier: '../../../apps/fleet-executor/src/purser-executability.ts',
      }),
    });
    expect(rec.steps.find(step =>
      step.kind === 'purser-tests' && /NON-EXECUTABLE/.test(step.title)
    )).toBeUndefined();
    expect(state.stackedPrs).toHaveLength(1);
  });

  it('lets the sole malformed survivor consume the residual shared repair call', async () => {
    seedRealJestConfig();
    const firstPath = 'tests/unit/purser/exhausted-sibling.test.ts';
    const survivorPath = 'tests/unit/purser/sole-survivor.test.ts';
    const plan = [
      '```json',
      JSON.stringify({
        files: [
          { path: firstPath, intent: 'consume two bounded repairs before being dropped' },
          { path: survivorPath, intent: 'use the residual shared repair call' },
        ],
      }),
      '```',
    ].join('\n');
    const malformed = (name: string) =>
      `\`\`\`ts\nfunction ${name}( {\ntest('still malformed', () => true);\n\`\`\``;
    const healed = [
      '```ts',
      "test('sole survivor executes', () => expect(true).toBe(true));",
      '```',
    ].join('\n');
    const { ai } = seqAi([
      STEELMAN_JSON,
      plan,
      malformed('firstDraft'),
      malformed('survivorDraft'),
      malformed('firstRepairOne'),
      malformed('firstRepairTwo'),
      malformed('survivorRepairOne'),
      malformed('survivorRepairTwo'),
      healed,
    ]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, testPaths: ['tests/unit/purser'] }),
      mkCtx(),
      makeEnv({ AI: ai, SANDBOX: sandboxStub(0) }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'PASS', errored: false });
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(9);
    expect(rec.steps.find(step =>
      step.kind === 'purser-author-repair' &&
      step.title.includes(`HEALED ${survivorPath}`)
    )).toMatchObject({
      detail: expect.objectContaining({ attempts: 3, repairNumber: 5 }),
    });
    expect(state.stackedPrs).toHaveLength(1);
  });

  it('#9789: two malformed escalation rewrites still fail closed without sandbox or stack effects', async () => {
    seedRealJestConfig();
    const malformedTests = [
      '```json',
      JSON.stringify({
        files: [{
          path: 'tests/unit/release-token-fallback.test.js',
          contents: 'export function parseStableVersion(value) { ... }',
        }],
      }),
      '```',
    ].join('\n');
    const malformedRepair = [
      '```js',
      'if (parse',
      '… (diff truncated...)',
      '```',
    ].join('\n');
    const { ai } = seqAi([STEELMAN_JSON, malformedTests, malformedRepair, malformedRepair]);
    const sandboxExec = vi.fn(async () => ({ exitCode: 0, stdout: 'should not run', stderr: '' }));
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true }),
      mkCtx(),
      makeEnv({ AI: ai, SANDBOX: { exec: sandboxExec } as unknown }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'BLOCK', errored: true });
    const repairSteps = rec.steps.filter(s => s.kind === 'purser-author-repair');
    expect(repairSteps).toHaveLength(2);
    expect(repairSteps[1]).toMatchObject({
      title: expect.stringContaining('FAILED'),
      detail: expect.objectContaining({ attempts: 2 }),
    });
    expect(rec.steps.find(s => s.kind === 'purser-tests' && /NON-EXECUTABLE/.test(s.title)))
      .toBeDefined();
    expect(sandboxExec).not.toHaveBeenCalled();
    expect(state.stackedPrs).toHaveLength(0);
    expect(state.prPatches.filter(p => p.base)).toHaveLength(0);
  });

  it('repairs one mixed-runner draft, then fails as broken machinery instead of stacking incompatible tests', async () => {
    seedRealJestConfig();
    state.files.set('BASESHA:package.json', '{"type":"module"}');
    const incompatibleTests = [
      '```json',
      JSON.stringify({
        files: [{
          path: 'tests/unit/purser/mixed-runner.test.ts',
          contents: "import { test } from 'bun:test';\ntest('contract', () => {});",
        }],
      }),
      '```',
    ].join('\n');
    const stillIncompatible = [
      '```ts',
      "import { test } from 'node:test';",
      "test('contract', () => {});",
      '```',
    ].join('\n');
    const { ai } = seqAi([STEELMAN_JSON, incompatibleTests, stillIncompatible]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, testPaths: ['tests/unit/purser'] }),
      mkCtx(),
      makeEnv({ AI: ai, SANDBOX: sandboxStub(0) }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'BLOCK', errored: true });
    expect(rec.steps.find(s => s.kind === 'purser-author-repair')).toMatchObject({
      title: expect.stringContaining('FAILED'),
      detail: expect.objectContaining({
        originalError: expect.stringContaining("imports 'bun:test'"),
        result: expect.stringContaining("imports 'node:test'"),
      }),
    });
    expect(state.stackedPrs).toHaveLength(0);
    expect(state.prPatches.filter(p => p.base)).toHaveLength(0);
  });

  it('deterministically removes a redundant Vitest import when every binding is a trusted Jest global', async () => {
    seedRealJestConfig();
    state.files.set('BASESHA:package.json', '{"type":"module"}');
    const testPath = 'tests/unit/purser/jest-globals.test.ts';
    const plan = [
      '```json',
      JSON.stringify({ files: [{ path: testPath, intent: 'exercise the release contract' }] }),
      '```',
    ].join('\n');
    const authoredFile = [
      '```ts',
      "import { describe, it, expect, beforeEach } from 'vitest';",
      "describe('release contract', () => {",
      "  beforeEach(() => undefined);",
      "  it('runs under Jest', () => expect(true).toBe(true));",
      '});',
      '```',
    ].join('\n');
    const { ai } = seqAi([STEELMAN_JSON, plan, authoredFile]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, testPaths: ['tests/unit/purser'] }),
      mkCtx(),
      makeEnv({ AI: ai, SANDBOX: sandboxStub(0) }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'PASS', errored: false });
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
    expect(rec.steps.find(s => s.kind === 'purser-author-repair')).toMatchObject({
      title: expect.stringContaining(`HEALED ${testPath}`),
      detail: expect.objectContaining({
        strategy: 'trusted-jest-global-import-removal',
        attempts: 0,
        removedBindings: ['describe', 'it', 'expect', 'beforeEach'],
      }),
    });
    expect(state.blobsCreated).toBe(1);
    expect(state.stackedPrs).toHaveLength(1);
  });

  it('does not rewrite Vitest-only bindings under Jest evidence', async () => {
    seedRealJestConfig();
    state.files.set('BASESHA:package.json', '{"type":"module"}');
    const testPath = 'tests/unit/purser/vitest-only.test.ts';
    const plan = [
      '```json',
      JSON.stringify({ files: [{ path: testPath, intent: 'exercise the release contract' }] }),
      '```',
    ].join('\n');
    const authoredFile = [
      '```ts',
      "import { describe, it, expect, vi } from 'vitest';",
      "describe('release contract', () => it('mocks', () => expect(vi.fn()).toBeDefined()));",
      '```',
    ].join('\n');
    const stillIncompatible = [
      '```ts',
      "import { test } from 'node:test';",
      "test('contract', () => {});",
      '```',
    ].join('\n');
    const malformedRepair = ['```ts', 'if (', '```'].join('\n');
    const { ai } = seqAi([
      STEELMAN_JSON,
      plan,
      authoredFile,
      stillIncompatible,
      malformedRepair,
    ]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, testPaths: ['tests/unit/purser'] }),
      mkCtx(),
      makeEnv({ AI: ai, SANDBOX: sandboxStub(0) }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'BLOCK', errored: true });
    const repairs = rec.steps.filter(s => s.kind === 'purser-author-repair');
    expect(repairs).toHaveLength(2);
    expect(repairs[0]).toMatchObject({
      detail: expect.objectContaining({ originalError: expect.stringContaining("imports 'vitest'") }),
    });
    expect(repairs.some(step =>
      (step.detail as { strategy?: string }).strategy === 'trusted-jest-global-import-removal'
    )).toBe(false);
    expect(state.stackedPrs).toHaveLength(0);
  });

  it('repairs a discoverable file that registers no Jest test before sandbox or stacking', async () => {
    seedRealJestConfig();
    const testPath = 'tests/unit/purser/registration.test.ts';
    const plan = [
      '```json',
      JSON.stringify({ files: [{ path: testPath, intent: 'exercise the release contract' }] }),
      '```',
    ].join('\n');
    const missingRegistration = [
      '```ts',
      'export const stableVersion = "3.30.3";',
      '```',
    ].join('\n');
    const repairedFile = [
      '```ts',
      "test('registers the release contract', () => {",
      "  expect('3.30.3').toBe('3.30.3');",
      '});',
      '```',
    ].join('\n');
    const { ai } = seqAi([STEELMAN_JSON, plan, missingRegistration, repairedFile]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, testPaths: ['tests/unit/purser'] }),
      mkCtx(),
      makeEnv({ AI: ai, SANDBOX: sandboxStub(0) }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'PASS', errored: false });
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
    expect(rec.steps.find(s => s.kind === 'purser-author-repair')).toMatchObject({
      title: expect.stringContaining(`HEALED ${testPath}`),
      detail: expect.objectContaining({
        originalError: expect.stringContaining('registers no Jest test or it case'),
        attempts: 1,
        repairNumber: 1,
      }),
    });
    expect(rec.steps.find(s => s.kind === 'purser-sandbox')?.detail).toMatchObject({
      executed: true,
      passed: true,
    });
    expect(state.stackedPrs).toHaveLength(1);
  });

  it('authors with trusted Jest evidence and repairs three incompatible siblings before stacking', async () => {
    seedRealJestConfig();
    state.files.set('BASESHA:package.json', '{"type":"module"}');
    const paths = [
      'tests/unit/purser/release-version.test.ts',
      'tests/unit/purser/release-manifest.test.ts',
      'tests/unit/purser/release-artifacts.test.ts',
    ];
    const plan = [
      '```json',
      JSON.stringify({
        files: paths.map(path => ({ path, intent: `grill ${path}` })),
      }),
      '```',
    ].join('\n');
    const vitestFiles = paths.map((_, index) => [
      '```ts',
      "import { describe, it, expect } from 'vitest';",
      `describe('foreign-${index}', () => it('loads', () => expect(true).toBe(true)));`,
      '```',
    ].join('\n'));
    const jestFiles = paths.map((_, index) => [
      '```ts',
      `describe('jest-${index}', () => it('loads', () => expect(true).toBe(true)));`,
      '```',
    ].join('\n'));
    const { ai } = seqAi([
      STEELMAN_JSON,
      plan,
      ...vitestFiles,
      ...jestFiles,
    ]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, testPaths: ['tests/unit/purser'] }),
      mkCtx(),
      makeEnv({ AI: ai, SANDBOX: sandboxStub(0) }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'PASS', errored: false });
    const calls = (ai.run as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(5);
    for (const callIndex of [2, 3, 4]) {
      const request = calls[callIndex][1] as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(request.messages[0].content).toContain(
        'Trusted runner evidence (authoritative, not inferred from the PR diff)',
      );
      expect(request.messages[0].content).toContain('<rootDir>/tests/unit/**/*.test.{js,ts}');
      expect(request.messages[0].content).toContain(
        "Never import from 'vitest', 'bun:test', or 'node:test'",
      );
      expect(request.messages[0].content).toContain(
        'type=module, so do not use an unbound __dirname',
      );
    }
    const repairSteps = rec.steps.filter(s => s.kind === 'purser-author-repair');
    expect(repairSteps).toHaveLength(3);
    for (const [index, step] of repairSteps.entries()) {
      expect(step).toMatchObject({
        detail: expect.objectContaining({
          strategy: 'trusted-jest-global-import-removal',
          attempts: 0,
          path: paths[index],
          removedBindings: ['describe', 'it', 'expect'],
        }),
      });
      const resultDetail = (step.detail as { result: string }).result;
      if (index < paths.length - 1) {
        expect(resultDetail).toContain(
          `${paths[index + 1]} imports 'vitest'`,
        );
      } else {
        expect(resultDetail).toBe('trusted executability gate passed after deterministic rewrite');
      }
    }
    expect(rec.steps.find(s => s.kind === 'purser-sandbox')?.detail).toMatchObject({
      executed: true,
      passed: true,
    });
    expect(state.blobsCreated).toBe(3);
    expect(state.stackedPrs).toHaveLength(1);
  });

  it('re-authors an incompatible reused suite in place instead of preserving a broken runner loop', async () => {
    seedRealJestConfig();
    state.files.set('BASESHA:package.json', '{"type":"module"}');
    const testPath = 'tests/unit/purser/reused-runner.test.ts';
    const branch = 'purser/pr-7-tests';
    const fingerprint = withAuthoredTests(fingerprintDiff(mkCtx().diff ?? ''), [testPath]);
    (state.openPRs as Array<Record<string, unknown>>).push({
      number: 8669,
      title: 'purser: adversarial tests for #7',
      head: { ref: branch },
      base: { ref: 'main' },
      html_url: 'https://github.com/test/pr/8669',
      body: encodeFingerprint(fingerprint),
    });
    state.files.set(
      `${branch}:${testPath}`,
      "import { test } from 'bun:test';\ntest('contract', () => {});",
    );
    state.gitRefs.set(branch, 'old-invalid-commit');

    const plan = [
      '```json',
      JSON.stringify({ files: [{ path: testPath, intent: 'exercise the release contract' }] }),
      '```',
    ].join('\n');
    const repairedFile = [
      '```ts',
      "describe('release contract', () => {",
      "  it('runs under the trusted Jest globals', () => expect(true).toBe(true));",
      '});',
      '```',
    ].join('\n');
    const { ai } = seqAi([STEELMAN_JSON, plan, repairedFile]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, testPaths: ['tests/unit/purser'] }),
      mkCtx(),
      makeEnv({ AI: ai, SANDBOX: sandboxStub(0) }),
      'tok',
      rec.transcript,
      freshMetrics(),
    );

    expect(result).toMatchObject({ verdict: 'PASS', errored: false });
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
    expect(rec.steps.find(s => s.kind === 'purser-rerun')).toMatchObject({
      title: expect.stringContaining('REJECTED non-executable reused tests'),
      detail: expect.objectContaining({ action: 'author-fresh' }),
    });
    expect(state.refUpdates).toBe(1);
    expect(state.refCreates).toBe(0);
    expect(state.stackedPrs).toHaveLength(0);
    expect(state.prPatches).toContainEqual(expect.objectContaining({
      number: 8669,
      body: expect.stringContaining('purser-contract-fingerprint'),
    }));
  });

  it('positive control: a path-valid file whose relative import DOES resolve passes the gate and stacks normally', async () => {
    seedRealJestConfig();
    // '../support' from tests/unit/widget.contract.test.js resolves to
    // tests/support.js — see the "unresolved" test above for the negative case.
    state.treeFiles.set('BASESHA', ['tests/support.js']);
    const goodImportTests = [
      '```json',
      JSON.stringify({
        files: [
          {
            path: 'tests/unit/widget.contract.test.js',
            contents: "const { helper } = require('../support');\nit('x', () => { helper(); });",
          },
        ],
      }),
      '```',
    ].join('\n');
    const { ai } = seqAi([STEELMAN_JSON, goodImportTests]);
    const rec = recorder();

    await runPurser(
      mkShip(), mkCtx(), makeEnv({ AI: ai, SANDBOX: sandboxStub(0) }), 'tok', rec.transcript, freshMetrics(),
    );

    const rejected = rec.steps.find(s => s.kind === 'purser-tests' && /NON-EXECUTABLE/.test(s.title));
    expect(rejected).toBeUndefined();
    expect(state.stackedPrs).toHaveLength(1);
    expect(state.prPatches).toContainEqual(
      expect.objectContaining({ number: 7, base: 'purser/pr-7-tests' }),
    );
  });

  it('missing/unparseable jest config (no evidence) fails closed, even for an otherwise well-formed file', async () => {
    state.files.delete('BASESHA:jest.config.js'); // no discovery evidence at all
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();

    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics());

    const step = rec.steps.find(s => s.kind === 'purser-tests' && /NON-EXECUTABLE/.test(s.title));
    expect(step).toBeDefined();
    expect((step!.detail as { error: string }).error).toMatch(/could not be found or parsed/);
    expect(state.stackedPrs).toHaveLength(0);
  });
});

describe('runPurser — verdict matrix (sandbox pass/fail/absent × blocking flags)', () => {
  const run = async (opts: {
    sandbox: 'pass' | 'fail' | 'absent';
    blocking: boolean;
    blockWithoutSandbox?: boolean;
  }) => {
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();
    const env = makeEnv({
      AI: ai,
      ...(opts.sandbox === 'absent' ? {} : { SANDBOX: sandboxStub(opts.sandbox === 'pass' ? 0 : 1, 'FAIL tests/purser 1 failed') }),
    });
    const result = await runPurser(
      mkShip({ blocking: opts.blocking, blockWithoutSandbox: opts.blockWithoutSandbox ?? false }),
      mkCtx(), env, 'tok', rec.transcript, freshMetrics(),
    );
    return { result, rec };
  };

  it('sandbox PASSED + blocking ⇒ PASS (blocking)', async () => {
    const { result, rec } = await run({ sandbox: 'pass', blocking: true });
    expect(result).toMatchObject({ blocking: true, verdict: 'PASS', errored: false });
    const step = rec.steps.find(s => s.kind === 'purser-sandbox')!;
    expect(step.detail).toMatchObject({ executed: true, passed: true, failuresTail: '' });
  });

  it('sandbox FAILED + blocking ⇒ BLOCK (the PR does not satisfy its own contract)', async () => {
    const { result, rec } = await run({ sandbox: 'fail', blocking: true });
    expect(result).toMatchObject({ blocking: true, verdict: 'BLOCK' });
    const step = rec.steps.find(s => s.kind === 'purser-sandbox')!;
    const detail = step.detail as { executed: boolean; passed: boolean; failuresTail: string };
    expect(detail.executed).toBe(true);
    expect(detail.passed).toBe(false);
    expect(detail.failuresTail).toContain('1 failed');
    expect(detail.failuresTail.length).toBeLessThanOrEqual(1024);
  });

  it('sandbox FAILED + non-blocking ⇒ advisory BLOCK (objection surfaces, gate untouched)', async () => {
    const { result } = await run({ sandbox: 'fail', blocking: false });
    expect(result).toMatchObject({ blocking: false, verdict: 'BLOCK' });
  });

  it('sandbox ABSENT + blocking + blockWithoutSandbox:false ⇒ PASS (never block on tests never run)', async () => {
    const { result, rec } = await run({ sandbox: 'absent', blocking: true });
    expect(result).toMatchObject({ blocking: true, verdict: 'PASS' });
    const step = rec.steps.find(s => s.kind === 'purser-sandbox')!;
    expect(step.detail).toMatchObject({ executed: false, passed: null });
    // The comment claims NO result for unexecuted tests.
    const bodies = purserCommentBodies(state);
    expect(bodies[0]).toContain('NOT RUN');
  });

  it('sandbox ABSENT + blocking + blockWithoutSandbox:true ⇒ BLOCK (explicit fail-closed opt-in)', async () => {
    const { result } = await run({ sandbox: 'absent', blocking: true, blockWithoutSandbox: true });
    expect(result).toMatchObject({ blocking: true, verdict: 'BLOCK' });
  });

  it('sandbox ABSENT + non-blocking + blockWithoutSandbox:true ⇒ advisory BLOCK', async () => {
    const { result } = await run({ sandbox: 'absent', blocking: false, blockWithoutSandbox: true });
    expect(result).toMatchObject({ blocking: false, verdict: 'BLOCK' });
  });
});

// ---------------------------------------------------------------------------

describe('pd-fleet.yml purser parsing', () => {
  const YAML = [
    'fleet:',
    '  name: t',
    '  agents:',
    '    purser:',
    '      class: purser',
    '      trigger: pull_request:opened',
    '      blocking: true',
    '      blockWithoutSandbox: true',
    "      model: '@cf/qwen/qwen3-30b-a3b-fp8'",
    '      testPaths:',
    '        - tests/purser',
    '',
  ].join('\n');

  it('parses a minimal class:purser entry (no prompt needed) with its fields', () => {
    const ships = parseFleetShips(YAML, 'pull_request:opened');
    expect(ships).not.toBeNull();
    const p = ships!.find(s => s.name === 'purser')!;
    expect(p.purser).toBe(true);
    expect(p.ideation).toBe(false);
    expect(p.blocking).toBe(true);
    expect(p.blockWithoutSandbox).toBe(true);
    expect(p.testPaths).toEqual(['tests/purser']);
    // No graft configured ⇒ the purser gets the default skill-graft list.
    expect(p.graft).toEqual([...PURSER_DEFAULT_GRAFT]);
    expect(p.cfModel).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    expect(p.needsExecution).toBe(false); // cloud-executable by contract
    expect(p.prompt.length).toBeGreaterThan(0); // default persona prompt
  });

  it('honors an explicit graft list (capped at 3) instead of the purser default', () => {
    const yaml = YAML.replace(
      '      testPaths:',
      ['      graft:', '        - a-skill', '        - b-skill', '        - c-skill', '        - d-skill', '      testPaths:'].join('\n'),
    );
    const p = parseFleetShips(yaml, 'pull_request:opened')!.find(s => s.name === 'purser')!;
    expect(p.graft).toEqual(['a-skill', 'b-skill', 'c-skill']); // capped at 3
    expect(p.testPaths).toEqual(['tests/purser']); // testPaths untouched
  });

  it('an unknown model pin on a purser is remapped to a known-good model', () => {
    const yaml = YAML.replace("'@cf/qwen/qwen3-30b-a3b-fp8'", "'@cf/bogus/model'");
    const p = parseFleetShips(yaml, 'pull_request:opened')!.find(s => s.name === 'purser')!;
    expect(p.cfModel).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
  });
});

describe('executeFleet wiring — purser is opt-in and runs AFTER the other ships', () => {
  function seedToken(kv: KVNamespace): void {
    void kv.put(
      'github_inst_42',
      JSON.stringify({ token: 'seeded-tok', expiresAt: Date.now() + 60 * 60 * 1000 }),
    );
  }

  it('a declared purser ship runs last even when listed first in pd-fleet.yml', async () => {
    // Purser declared FIRST; the reviewer must still run before it.
    state.files.set('main:pd-fleet.yml', [
      'fleet:',
      '  name: t',
      '  agents:',
      '    purser:',
      '      class: purser',
      '      trigger: pull_request:opened',
      '    code-reviewer:',
      '      trigger: pull_request:opened',
      '      blocking: true',
      '      fallbacks:',
      '        - backend: cloudflare',
      "          model: '@cf/qwen/qwen3-30b-a3b-fp8'",
      '      prompt: |',
      '        code-reviewer ship: review the diff.',
      '',
    ].join('\n'));
    const kv = memoryKV();
    seedToken(kv);
    const ai = aiStub({
      perShip: {
        'code-reviewer': 'looks ok\n\nFLEET-VERDICT: PASS',
        // The purser's two calls both get this non-JSON response → its
        // steel-man fails and it stops as a broken ship (fine for ordering).
        purser: 'no json from me',
      },
    });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai }));

    const order = ai.calls.map(c => c.ship);
    expect(order).toContain('code-reviewer');
    expect(order).toContain('purser');
    expect(order.indexOf('purser')).toBeGreaterThan(order.lastIndexOf('code-reviewer'));
    // Broken-ship doctrine: the purser's malformed steel-man fails the run.
    expect(state.completed[0].conclusion).toBe('failure');
  });

  it('without a declared purser ship, no purser behavior exists (default OFF)', async () => {
    state.files.set('main:pd-fleet.yml', [
      'fleet:',
      '  name: t',
      '  agents:',
      '    code-reviewer:',
      '      trigger: pull_request:opened',
      '      fallbacks:',
      '        - backend: cloudflare',
      "          model: '@cf/qwen/qwen3-30b-a3b-fp8'",
      '      prompt: |',
      '        code-reviewer ship: review the diff.',
      '',
    ].join('\n'));
    const kv = memoryKV();
    seedToken(kv);
    const ai = aiStub({ perShip: { 'code-reviewer': 'ok\n\nFLEET-VERDICT: PASS' } });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai }));

    expect(state.records.filter(r => r.url.includes('/git/'))).toHaveLength(0);
    expect(state.stackedPrs).toHaveLength(0);
    expect(state.completed[0].conclusion).toBe('success');
  });
});

describe('runPurser — HITL interruption escalation (src/interruptions.ts wiring)', () => {
  const HITL_URL = 'https://relay.example/v1/interruptions';
  const hitlEnv = { INTERRUPTIONS_URL: HITL_URL, INTERRUPTIONS_TOKEN: `pdu_${'cd'.repeat(32)}` };

  const interruptionPosts = () =>
    state.records.filter(r => r.method === 'POST' && r.url === HITL_URL);

  it('403 on stacking escalates a HIGH interruption naming contents:write (fire-and-forget)', async () => {
    state.failGitWrites403 = true;
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();

    const result = await runPurser(
      mkShip(), mkCtx(), makeEnv({ AI: ai, ...hitlEnv }), 'tok', rec.transcript, freshMetrics(),
      '', 'run:d-1', false,
    );
    // The escalation fetch is fire-and-forget (never awaited) — let it settle.
    await new Promise(r => setTimeout(r, 0));

    // The 403 itself is a broken-ship result (errored ⇒ the run fails); the
    // escalation POST is still fire-and-forget and never throws into the run.
    expect(result.errored).toBe(true);
    const posts = interruptionPosts();
    expect(posts).toHaveLength(1);
    const body = posts[0].body as {
      title: string; body: string; urgency: string; source_agent: string; source_session: string;
    };
    expect(body.urgency).toBe('high');
    expect(body.title).toContain('contents:write');
    expect(body.body).toContain('contents: write');
    expect(body.source_agent).toBe('fleet-executor/purser');
    expect(body.source_session).toBe('run:d-1');
  });

  it('sandbox ABSENT + blockWithoutSandbox ⇒ CRITICAL interruption; the BLOCK verdict stands', async () => {
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, blockWithoutSandbox: true }),
      mkCtx(), makeEnv({ AI: ai, ...hitlEnv }), 'tok', rec.transcript, freshMetrics(),
    );
    await new Promise(r => setTimeout(r, 0));

    expect(result).toMatchObject({ blocking: true, verdict: 'BLOCK' });
    const posts = interruptionPosts();
    expect(posts).toHaveLength(1);
    const body = posts[0].body as { title: string; urgency: string; body: string };
    expect(body.urgency).toBe('critical');
    expect(body.title).toContain('blockWithoutSandbox');
    expect(body.body).toContain('blockWithoutSandbox');
  });

  it('feature-gated: without INTERRUPTIONS_URL/TOKEN no escalation fetch ever happens', async () => {
    state.failGitWrites403 = true;
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();
    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics());
    await new Promise(r => setTimeout(r, 0));
    expect(interruptionPosts()).toHaveLength(0);
  });

  it('no degradation ⇒ no interruption (a healthy stack asks nothing of the operator)', async () => {
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();
    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: ai, ...hitlEnv }), 'tok', rec.transcript, freshMetrics());
    await new Promise(r => setTimeout(r, 0));
    expect(interruptionPosts()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The multi-step authoring path (plan -> one call per file).
//
// The fixtures above exercise the FAST path: they return complete
// {path, contents} files from the plan call, so the per-file calls are skipped.
// These tests drive the path that actually runs when a model obeys the plan
// contract — the path that replaced the single all-or-nothing JSON call.

const PLAN_JSON = [
  '```json',
  JSON.stringify({
    files: [
      { path: 'tests/purser/a.test.ts', intent: 'empty input' },
      { path: 'tests/purser/b.test.ts', intent: 'negative ids' },
    ],
  }),
  '```',
].join('\n');

/** A file body with the newlines and quotes that used to break JSON escaping. */
const FILE_A = ['```ts', 'it("frobs empty input", () => {', '  expect(f("")).toBe(0);', '});', '```'].join('\n');
const FILE_B = ['```ts', 'it("rejects negative ids", () => {', '  expect(() => f(-1)).toThrow("bad id");', '});', '```'].join('\n');

describe('runPurser — multi-step authoring', () => {
  it('plans, then issues ONE authoring call per planned file', async () => {
    const { ai } = seqAi([STEELMAN_JSON, PLAN_JSON, FILE_A, FILE_B]);
    const rec = recorder();

    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics());

    // steel-man + plan + one per file = 4.
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(4);
    const planStep = rec.steps.find(s => s.kind === 'purser-plan')!;
    expect(planStep.title).toContain('planned 2');

    const testsStep = rec.steps.find(s => s.kind === 'purser-tests')!;
    expect((testsStep.detail as { files: Array<{ path: string }> }).files.map(f => f.path)).toEqual([
      'tests/purser/a.test.ts',
      'tests/purser/b.test.ts',
    ]);
    expect(state.stackedPrs).toHaveLength(1);
  });

  it('commits the file body verbatim — quotes and newlines survive, unescaped', async () => {
    const { ai } = seqAi([STEELMAN_JSON, PLAN_JSON, FILE_A, FILE_B]);
    const rec = recorder();

    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics());

    const blobs = state.records.filter(r => r.url.includes('/git/blobs'));
    const bodies = blobs.map(b => String((b.body as { content?: string })?.content ?? ''));
    expect(bodies.some(b => b.includes('expect(f("")).toBe(0);'))).toBe(true);
    expect(bodies.some(b => b.includes('expect(() => f(-1)).toThrow("bad id");'))).toBe(true);
  });

  it('PARTIAL SUCCESS: one bad file no longer costs the good ones', async () => {
    // b.test.ts comes back as a refusal; a.test.ts is fine.
    const { ai } = seqAi([STEELMAN_JSON, PLAN_JSON, FILE_A, 'I cannot write this test.']);
    const rec = recorder();

    const result = await runPurser(
      mkShip(), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics(),
    );

    // The old shape returned zero files and an advisory PASS with nothing stacked.
    expect(state.stackedPrs).toHaveLength(1);
    const testsStep = rec.steps.find(s => s.kind === 'purser-tests')!;
    expect(testsStep.title).toContain('1/2');
    expect((testsStep.detail as { failures: Array<{ path: string }> }).failures[0].path).toBe(
      'tests/purser/b.test.ts',
    );
    expect(result.errored).toBe(false);
  });

  it('every file failing is an honest BROKEN-SHIP result, never a fabricated stack', async () => {
    const { ai } = seqAi([STEELMAN_JSON, PLAN_JSON, 'nope.', 'also nope.']);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true }), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics(),
    );

    // Nothing fabricated — and the ship that authored nothing fails the run.
    expect(result).toMatchObject({ blocking: true, verdict: 'BLOCK', errored: true });
    expect(state.stackedPrs).toHaveLength(0);
    const step = rec.steps.find(s => s.kind === 'purser-tests')!;
    expect(step.title).toMatch(/FAILED/);
  });

  it('a malformed plan records the RAW HEAD, not just a length', async () => {
    const { ai } = seqAi([STEELMAN_JSON, 'I would rather discuss the weather.']);
    const rec = recorder();

    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics());

    const step = rec.steps.find(s => s.kind === 'purser-plan')!;
    expect(step.title).toMatch(/MALFORMED/);
    // The whole point: a future failure is diagnosable from the transcript.
    expect((step.detail as { rawHead: string }).rawHead).toContain('rather discuss the weather');
    const repairRequest = (ai.run as ReturnType<typeof vi.fn>).mock.calls[2][1] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(repairRequest.messages[0].content).toContain(
      '<rootDir>/tests/**/*.test.{js,ts}',
    );
  });
});

describe('runPurser — per-file validation keeps the good files', () => {
  it('one unusable PATH drops that file only; the rest still stack', async () => {
    // The set-level validator used to reject all four files because one had a
    // `..` in it, quietly undoing the partial-success property that per-file
    // authoring exists to provide.
    const plan = [
      '```json',
      JSON.stringify({
        files: [
          { path: '../../etc/evil.test.ts', intent: 'escape' },
          { path: 'tests/purser/good.test.ts', intent: 'real' },
        ],
      }),
      '```',
    ].join('\n');
    const body = '```ts\nit("ok", () => {});\n```';
    const { ai } = seqAi([STEELMAN_JSON, plan, body, body]);
    const rec = recorder();

    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics());

    // The good file shipped...
    expect(state.stackedPrs).toHaveLength(1);
    const testsStep = rec.steps.find(s => s.kind === 'purser-tests')!;
    expect((testsStep.detail as { files: Array<{ path: string }> }).files.map(f => f.path)).toEqual([
      'tests/purser/good.test.ts',
    ]);
    // ...and the traversal path was never written anywhere.
    const blobs = state.records.filter(r => r.url.includes('/git/blobs'));
    expect(blobs).toHaveLength(1);
    expect(JSON.stringify(state.records)).not.toContain('etc/evil');
  });

  it('when EVERY path is unusable it is a BROKEN-SHIP result with no git writes', async () => {
    const plan = '```json' + '\n' + JSON.stringify({ files: [{ path: '../../etc/evil.test.ts' }] }) + '\n```';
    const { ai } = seqAi([STEELMAN_JSON, plan, '```ts\nit("x",()=>{});\n```']);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true }), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics(),
    );

    expect(result).toMatchObject({ blocking: true, verdict: 'BLOCK', errored: true });
    expect(state.records.filter(r => r.url.includes('/git/'))).toHaveLength(0);
    const step = rec.steps.find(s => s.kind === 'purser-tests')!;
    expect(step.title).toMatch(/REJECTED/);
    expect((step.detail as { error: string }).error).toMatch(/traversal/);
  });
});
