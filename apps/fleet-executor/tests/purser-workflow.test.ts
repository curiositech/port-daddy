import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runPurser, type PurserMetrics, type TranscriptLike } from '../src/purser.js';
import type { ShipConfig } from '../src/fleet.js';
import type { PRContext } from '../src/github.js';
import { freshState, installGitHubFetch, makeEnv, type GitHubState } from './harness.js';

const contract = JSON.stringify({ purpose: 'Reject negative widget ids.', contract: ['Reject negative ids.'], testTargets: ['src/widget.ts'] });
const authored = JSON.stringify({ files: [{ path: 'tests/purser/widget.test.ts', contents: 'it("rejects negative ids", () => { expect(() => { throw new Error("negative"); }).toThrow("negative"); });' }] });
const ctx: PRContext = {
  owner: 'erichowens', repo: 'port-daddy', prNumber: 7,
  title: 'Reject negative widget ids', body: 'Implement negative-id validation.',
  headSha: 'HEADSHA', headRef: 'feat/widget', baseSha: 'BASESHA', baseRef: 'main',
  isFork: false, authorLogin: 'a-human', authorType: 'User', state: 'open', merged: false,
  installationId: 1, files: [{ filename: 'src/widget.ts', status: 'added', additions: 3, deletions: 0 }],
  diff: 'diff --git a/src/widget.ts b/src/widget.ts\n+export function widget(id: number) { if (id < 0) throw new Error("negative"); }',
  diffBytes: 0, diffTruncated: false, filesTruncated: false, diffSource: 'raw',
};
const ship: ShipConfig = {
  name: 'purser', trigger: 'pull_request:opened', prompt: 'Review the contract.',
  cfModel: '@cf/qwen/qwen3-30b-a3b-fp8', temperature: null,
  role: 'Write adversarial tests', telos: 'Prove the contract', blocking: true,
  needsExecution: false, ideation: false, purser: true, blockWithoutSandbox: true,
  testPaths: [], graft: [],
};
let state: GitHubState;
beforeEach(() => {
  state = freshState();
  state.treeFiles.set('HEADSHA', ['src/widget.ts']);
  installGitHubFetch(state);
});
afterEach(() => vi.unstubAllGlobals());

function sandbox(kind: 'passed' | 'harness-failure' | 'assertion-failure') {
  return { destroy: vi.fn(async () => {}), exec: vi.fn(async (command: string) => {
    if (command.includes('__PD_PURSER_HEAD__')) return { exitCode: 0, stdout: '__PD_PURSER_HEAD__:HEADSHA' };
    if (command.includes('git cat-file')) return { exitCode: 0, stdout: btoa('export function widget(id: number) { if (id < 0) throw new Error("negative"); }') };
    if (!command.includes('__PD_PURSER_TEST_STARTED__')) return { exitCode: 0, stdout: '' };
    return { exitCode: kind === 'passed' ? 0 : 1, stdout: [
    '__PD_PURSER_TEST_STARTED__',
    '__PD_PURSER_JEST_SUMMARY__:' + btoa(JSON.stringify({
      numFailedTests: kind === 'assertion-failure' ? 1 : 0,
      numFailedTestSuites: kind === 'passed' ? 0 : 1,
      numPassedTests: kind === 'passed' ? 1 : 0,
      numRuntimeErrorTestSuites: kind === 'harness-failure' ? 1 : 0,
      numTotalTests: kind === 'harness-failure' ? 0 : 1,
      success: kind === 'passed',
    })),
  ].join('\n') }; }) };
}

async function run(binding: unknown, response = authored, context = ctx, sequence?: string[]) {
  const responses = sequence ?? [contract, response];
  const run = vi.fn(async () => ({ response: '```json\n' + (responses.shift() ?? '{}') + '\n```' }));
  const metrics: PurserMetrics = { calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, usageReports: 0, allEmpty: true };
  const steps: unknown[] = [];
  const transcript: TranscriptLike = { async step(...args) { steps.push(args); } };
  const result = await runPurser(ship, context, makeEnv({ AI: { run } as unknown as Ai, SANDBOX: binding }), 'test-token', transcript, metrics);
  return { result, run, steps };
}

describe('Purser publication follows the reviewed implementation', () => {
  it('parents the test commit on the tested head and targets its branch, never retargeting the implementation', async () => {
    const { result } = await run(sandbox('passed'));
    expect(result.errored).toBe(false);
    const commit = state.records.find(r => r.method === 'POST' && r.url.endsWith('/git/commits'));
    expect(commit?.body).toMatchObject({ parents: ['HEADSHA'] });
    expect(state.stackedPrs[0]).toMatchObject({ head: 'purser/pr-7-tests', base: 'feat/widget' });
    expect(state.prPatches.filter(p => p.number === 7)).toEqual([]);
    expect(state.stackedPrs[0].body).toContain('HEADSHA');
  });

  it.each(['harness-failure', undefined] as const)('does not publish unverified tests after %s', async kind => {
    const { result } = await run(kind ? sandbox(kind) : undefined);
    expect(state.blobsCreated).toBe(0);
    expect(state.stackedPrs).toEqual([]);
    expect(state.prPatches.filter(p => p.number === 7)).toEqual([]);
    expect(result.verdict).not.toBe('PASS');
  });

  it('preserves a genuine assertion failure in a child test PR without changing the implementation base', async () => {
    const { result, run: model } = await run(sandbox('assertion-failure'));
    expect(result.verdict).toBe('BLOCK');
    expect(state.stackedPrs[0]?.base).toBe('feat/widget');
    expect(state.prPatches.filter(p => p.number === 7)).toEqual([]);
    expect(model).toHaveBeenCalledTimes(2);
  });

  it('resolves a new implementation import on HEAD, not the trusted runner-policy base', async () => {
    const tests = JSON.stringify({ files: [{ path: 'tests/purser/widget.test.ts', contents: 'import { widget } from "../../src/widget.ts"; it("rejects negatives", () => expect(() => widget(-1)).toThrow());' }] });
    const { result } = await run(sandbox('passed'), tests);
    expect(result.verdict).toBe('PASS');
    expect(state.stackedPrs).toHaveLength(1);
    expect(state.records.some(r => r.url.includes('/git/trees/HEADSHA'))).toBe(true);
    expect(state.contentsRefs).toContainEqual({ path: 'jest.config.js', ref: 'BASESHA' });
  });

  it('does not substitute main when the reviewed branch cannot be a publication target', async () => {
    await run(sandbox('passed'), authored, { ...ctx, headRef: '' });
    expect(state.blobsCreated).toBe(0);
    expect(state.stackedPrs).toEqual([]);
  });

  it('never overwrites an existing branch, including unpublished human changes', async () => {
    state.gitRefs.set('purser/pr-7-tests', 'human-work-sha');
    const { result } = await run(sandbox('passed'));
    expect(result.errored).toBe(true);
    expect(state.gitRefs.get('purser/pr-7-tests')).toBe('human-work-sha');
    expect(state.refUpdates).toBe(0);
    expect(state.stackedPrs).toEqual([]);
    expect(state.records.filter(record => record.method === 'PATCH' && record.url.includes('/git/refs/'))).toEqual([]);
  });

  it('does not spend on another review when prior test-PR lookup fails', async () => {
    const githubFixture = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/pulls?state=open&head=') && String(input).includes('per_page=1')) {
        return Promise.resolve(new Response('unavailable', { status: 503 }));
      }
      return githubFixture(input, init);
    }));
    const binding = sandbox('passed');
    const { result, run: model } = await run(binding);
    expect(result).toMatchObject({ errored: true, verdict: 'BLOCK' });
    expect(model).not.toHaveBeenCalled();
    expect(binding.exec).not.toHaveBeenCalled();
    expect(state.stackedPrs).toEqual([]);
  });

  it('offers source reads before steelmanning without exposing credentials or a shell', async () => {
    const binding = sandbox('passed');
    const { result, run: model } = await run(binding, authored, ctx, [
      '{"read_files":["src/widget.ts"]}', contract, authored,
    ]);
    expect(result.verdict).toBe('PASS');
    expect(model).toHaveBeenCalledTimes(3);
    const requests = JSON.stringify(model.mock.calls);
    expect(requests).toContain('export function widget');
    expect(requests).toContain('read_files');
    expect(requests).not.toContain('test-token');
    expect(binding.destroy).toHaveBeenCalledOnce();
  });

  it('stops repeated inspection requests at the shared budget and tears down the sandbox', async () => {
    const binding = sandbox('passed');
    const { result, run: model } = await run(binding, authored, ctx, Array(4).fill('{"read_files":["src/widget.ts"]}'));
    expect(model).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ errored: true, verdict: 'BLOCK', failureReason: expect.stringContaining('budget') });
    expect(state.blobsCreated).toBe(0);
    expect(binding.destroy).toHaveBeenCalledOnce();
  });

  it.each(['passed', 'harness-failure'] as const)('repairs one actual import-loader failure, then stops at %s', async finalKind => {
    state.treeFiles.set('HEADSHA', ['src/widget.ts', 'src/wrong.ts', 'src/right.ts']);
    const tests = (module: string) => JSON.stringify({ files: [{
      path: 'tests/purser/widget.test.ts',
      contents: `import { widget } from "../../src/${module}.ts"; it("rejects negatives", () => expect(() => widget(-1)).toThrow());`,
    }] });
    const binding = sandbox('passed');
    const fallback = binding.exec.getMockImplementation()!;
    let executions = 0;
    binding.exec.mockImplementation(async command => {
      if (command.includes('__PD_PURSER_TEST_STARTED__')) {
        executions++;
        return sandbox(executions === 1 ? 'harness-failure' : finalKind).exec(command);
      }
      return fallback(command);
    });
    const { result, run: model, steps } = await run(binding, authored, ctx, [contract, tests('wrong'), tests('right')]);
    expect(model).toHaveBeenCalledTimes(3);
    expect(executions).toBe(2);
    expect(JSON.stringify(model.mock.calls[2])).toContain('runnerFailure');
    expect(JSON.stringify(steps)).toContain('purser-execution-repair');
    expect(result.errored).toBe(finalKind !== 'passed');
    expect(state.stackedPrs).toHaveLength(finalKind === 'passed' ? 1 : 0);
    expect(binding.destroy).toHaveBeenCalledOnce();
  });

  it('rejects an execution repair that removes an assertion without rerunning or publishing', async () => {
    const binding = sandbox('harness-failure');
    const diluted = JSON.stringify({ files: [{ path: 'tests/purser/widget.test.ts', contents: 'it("rejects negative ids", () => {});' }] });
    const { result, steps } = await run(binding, authored, ctx, [contract, authored, diluted]);
    expect(result.errored).toBe(true);
    expect(binding.exec.mock.calls.filter(([command]) => command.includes('__PD_PURSER_TEST_STARTED__'))).toHaveLength(1);
    expect(steps).toContainEqual(expect.arrayContaining(['purser-execution-repair', expect.anything(), expect.anything(), expect.objectContaining({ accepted: false })]));
    expect(state.stackedPrs).toEqual([]);
  });

  it('cannot publish when the owned sandbox fails to shut down', async () => {
    const binding = sandbox('passed');
    binding.destroy.mockRejectedValue(new Error('destroy failed'));
    await expect(run(binding)).rejects.toThrow('cleanup failed');
    expect(state.blobsCreated).toBe(0);
  });

  it.each(['core/console/main.rs', 'app/View.swift', 'scripts/pd-app-watch.sh'])('holds unsupported %s before model or sandbox spend', async filename => {
    const binding = sandbox('passed');
    const { result, run: model } = await run(binding, authored, { ...ctx, files: [{ ...ctx.files[0], filename }] });
    expect(result).toMatchObject({ errored: true, verdict: 'BLOCK', failureReason: expect.stringContaining('approved language/host runner') });
    expect(model).not.toHaveBeenCalled();
    expect(binding.exec).not.toHaveBeenCalled();
    expect(state.stackedPrs).toEqual([]);
  });
});
