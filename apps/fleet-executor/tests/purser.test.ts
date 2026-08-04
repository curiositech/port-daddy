import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runPurser, parseSteelMan, parseAuthoredFiles, type TranscriptLike, type PurserMetrics } from '../src/purser.js';
import { parseFleetShips, PURSER_DEFAULT_GRAFT, type ShipConfig } from '../src/fleet.js';
import { executeFleet } from '../src/execute.js';
import type { PRContext } from '../src/github.js';
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
    installationId: 0,
    files: [{ filename: 'src/widget.ts', status: 'modified', additions: 3, deletions: 1 }],
    diff: 'diff --git a/src/widget.ts b/src/widget.ts\n+frob',
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
  return { exec: async () => ({ exitCode, stdout: output, stderr: '' }) };
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
  it('malformed steel-man ⇒ transcript error step, advisory PASS, and a hard stop (no second AI call, no git writes)', async () => {
    const { ai } = seqAi(['I refuse to emit JSON.', TESTS_JSON]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true }), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics(),
    );

    // Advisory PASS: even a BLOCKING purser cannot gate on a contract it failed to build.
    expect(result).toMatchObject({ ship: 'purser', blocking: false, verdict: 'PASS', errored: false });
    const step = rec.steps.find(s => s.kind === 'purser-steelman');
    expect(step).toBeDefined();
    expect(step!.title).toMatch(/MALFORMED/);
    expect((step!.detail as { error: string }).error).toMatch(/fenced JSON/);
    // Stopped: exactly one AI call, nothing touched on the Git Data API.
    expect((ai.run as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(state.records.filter(r => r.url.includes('/git/'))).toHaveLength(0);
  });

  it('a well-formed steel-man records purpose + obligation count in the transcript', async () => {
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();

    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics());

    const step = rec.steps.find(s => s.kind === 'purser-steelman')!;
    expect(step.title).toContain('2 obligation(s)');
    expect(step.detail).toMatchObject({
      purpose: 'Guarantee the widget frobs deterministically.',
      obligationCount: 2,
    });
  });
});

describe('runPurser — authored-test validation', () => {
  it('path traversal in authored tests is rejected: transcript error, advisory PASS, no git writes', async () => {
    const evil = '```json\n' + JSON.stringify({ files: [{ path: '../../etc/evil.test.ts', contents: 'x' }] }) + '\n```';
    const { ai } = seqAi([STEELMAN_JSON, evil]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true }), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics(),
    );

    expect(result).toMatchObject({ blocking: false, verdict: 'PASS', errored: false });
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
  it('same-repo PR: branch from BASE sha, stacked test PR opened, original PR retargeted onto the tests', async () => {
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();

    await runPurser(mkShip(), mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics());

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

    // The reviewed PR was retargeted ONTO the test branch (stacked on top).
    expect(state.prPatches).toContainEqual(
      expect.objectContaining({ number: 7, base: 'purser/pr-7-tests' }),
    );

    const step = rec.steps.find(s => s.kind === 'purser-stacked')!;
    expect(step.detail).toMatchObject({ testPrNumber: 8001, retargeted: true });

    // The demand comment is posted, firm and referenced.
    const bodies = purserCommentBodies(state);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('steel-manned');
    expect(bodies[0]).toContain('retargeted onto that test branch');
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

  it('403 (App lacks contents:write): degrades honestly — tests inline in the comment, permission named, verdict advisory', async () => {
    state.failGitWrites403 = true;
    const { ai } = seqAi([STEELMAN_JSON, TESTS_JSON]);
    const rec = recorder();

    const result = await runPurser(
      mkShip({ blocking: true, blockWithoutSandbox: true }),
      mkCtx(), makeEnv({ AI: ai }), 'tok', rec.transcript, freshMetrics(),
    );

    // Verdict stays advisory: blocking + blockWithoutSandbox cannot bite on a 403.
    expect(result).toMatchObject({ blocking: false, verdict: 'PASS', errored: false });
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
        // The purser's two calls both get this non-JSON response → it steel-man
        // fails and stops with an advisory PASS (fine for the ordering test).
        purser: 'no json from me',
      },
    });

    await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, AI: ai.ai }));

    const order = ai.calls.map(c => c.ship);
    expect(order).toContain('code-reviewer');
    expect(order).toContain('purser');
    expect(order.indexOf('purser')).toBeGreaterThan(order.lastIndexOf('code-reviewer'));
    // The purser's malformed steel-man never destabilizes the gate.
    expect(state.completed[0].conclusion).toBe('success');
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

    expect(result.errored).toBe(false); // escalation never disturbs the run
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
