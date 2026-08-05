/**
 * The DEADLOCK FIX, verified against the REAL guard scripts.
 *
 * These tests do not assert that a marker string is present and call it a day —
 * that is exactly how the syntax would silently drift out of what the guards
 * parse. Instead they take the body the purser ACTUALLY generates (captured
 * from a full `runPurser` run through the fake GitHub API), hand it to
 * `scripts/check-pr-requirements.mjs` as a real child process, and hand it to
 * the real `hasExempt` / `parseRoadmapTrailer` / `classify` implementations
 * imported from the repo. If a guard's parser tightens, these fail.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPurser, type TranscriptLike, type PurserMetrics } from '../src/purser.js';
import type { ShipConfig } from '../src/fleet.js';
import type { PRContext } from '../src/github.js';
import {
  fleetPrBodyTrailers,
  roadmapOptOutTrailer,
  REQUIREMENTS_EXEMPT_MARKER,
  COMMENTS_EXEMPT_MARKER,
} from '../src/fleet-pr-body.js';
import { freshState, installGitHubFetch, makeEnv, type GitHubState } from './harness.js';

// The repo root, three levels up from apps/fleet-executor/tests/.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REQUIREMENTS_GUARD = join(REPO_ROOT, 'scripts/check-pr-requirements.mjs');

/**
 * Run the REAL requirements guard against a body, as a child process.
 * Returns the exit code and combined output.
 */
function runRequirementsGuard(body: string): { code: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pd-prbody-'));
  const file = join(dir, 'body.md');
  writeFileSync(file, body, 'utf8');
  try {
    const output = execFileSync(
      process.execPath,
      [REQUIREMENTS_GUARD, '--body-file', file, '--changed', 'tests/purser/widget.contract.test.ts'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Purser fixtures (mirrors tests/purser.test.ts)

const STEELMAN_JSON = [
  '```json',
  JSON.stringify({
    purpose: 'Guarantee the widget frobs deterministically.',
    contract: { obligations: ['frobs on empty input without throwing'] },
    testTargets: ['src/widget.ts'],
  }),
  '```',
].join('\n');

const TESTS_JSON = [
  '```json',
  JSON.stringify({
    files: [{ path: 'tests/purser/widget.contract.test.ts', contents: 'it("x", () => {});' }],
  }),
  '```',
].join('\n');

function mkShip(): ShipConfig {
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
  } as ShipConfig;
}

function mkCtx(): PRContext {
  return {
    owner: 'erichowens',
    repo: 'port-daddy',
    prNumber: 4763,
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
    installationId: 42,
    files: [],
    diff: 'diff --git a/src/widget.ts b/src/widget.ts\n+frob',
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

function noopTranscript(): TranscriptLike {
  return { async step() {} };
}

/** An AI stub that returns the queued responses in order. */
function seqAi(responses: string[]) {
  let i = 0;
  const ai = {
    run: vi.fn(async () => ({ response: responses[Math.min(i++, responses.length - 1)] })),
  } as unknown as Ai;
  return ai;
}

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('fleet-authored PR bodies clear the real gates', () => {
  /** Capture the body the purser actually publishes on its test PR. */
  async function generatedPurserBody(): Promise<string> {
    await runPurser(
      mkShip(),
      mkCtx(),
      makeEnv({ AI: seqAi([STEELMAN_JSON, TESTS_JSON]) }),
      'tok',
      noopTranscript(),
      freshMetrics(),
    );
    expect(state.stackedPrs).toHaveLength(1);
    return state.stackedPrs[0].body;
  }

  it('the purser test PR body PASSES the real check-pr-requirements.mjs gate', async () => {
    const body = await generatedPurserBody();
    const { code, output } = runRequirementsGuard(body);
    expect(output).toContain('pr-requirements-exempt');
    expect(code).toBe(0);
  });

  it('a body WITHOUT the trailers still FAILS that gate (the test proves the gate is live)', () => {
    const naked =
      'Adversarial tests for #4763, authored by the purser against the steel-manned contract.';
    const { code, output } = runRequirementsGuard(naked);
    expect(code).toBe(1);
    expect(output).toContain('Summary');
  });

  it('the purser test PR body is accepted by the real pr-comments-exempt parser', async () => {
    const body = await generatedPurserBody();
    const guard = await import(
      /* @vite-ignore */ join(REPO_ROOT, 'scripts/check-pr-comments-answered.mjs')
    );
    expect(guard.hasExempt(body)).toBe(true);
    expect(guard.hasExempt('a body with no marker')).toBe(false);
  });

  it('the purser test PR body is a PASSING opt-out for the real roadmap gate', async () => {
    const body = await generatedPurserBody();
    const core = await import(/* @vite-ignore */ join(REPO_ROOT, 'lib/roadmap-link-core.ts'));

    const trailer = core.parseRoadmapTrailer(body);
    expect(trailer.slug).toBeNull();
    expect(trailer.optOutReason).toContain('4763');

    const snapshot = { generatedAt: Date.now(), items: [{ slug: 'x', status: 'backlog' }] };
    const result = core.classify(body, snapshot);
    expect(result.verdict).toBe('pass');
    expect(result.reason).toBe('opt-out');
    expect(result.requiresHumanApproval).toBe(false);
  });

  it('the opt-out reason is specific, not a blanket "bot"', async () => {
    const body = await generatedPurserBody();
    expect(body).toContain('Roadmap-Item: none —');
    expect(body.toLowerCase()).not.toMatch(/roadmap-item:\s*none\s*[—–-]\s*bot\s*$/im);
    // Each marker names a REASON specific to what this branch is.
    expect(REQUIREMENTS_EXEMPT_MARKER).toContain('machine-generated');
    expect(COMMENTS_EXEMPT_MARKER).toContain('no human authored this PR');
  });

  it('the roadmap trailer survives non-trailer content being appended after it', async () => {
    const body = await generatedPurserBody();
    // Simulates a later edit appending changelog-shaped lines to the body —
    // none of them parse as a trailer, so they cannot steal "the last matching
    // trailer wins" from the real opt-out.
    const withLog =
      `${body.trimEnd()}\n\n<!-- changelog -->\n` +
      `- 2026-08-04 00:00Z — merged \`main\` into this branch (it was 3 commit(s) behind).\n` +
      `- 2026-08-04 00:05Z — merged \`main\` into this branch again.\n`;
    const core = await import(/* @vite-ignore */ join(REPO_ROOT, 'lib/roadmap-link-core.ts'));

    expect(core.parseRoadmapTrailer(withLog).optOutReason).toContain('4763');
    expect(core.classify(withLog, { generatedAt: Date.now(), items: [{ slug: 'x', status: 'backlog' }] }).verdict).toBe('pass');
    // And the requirements gate still passes with the log appended.
    expect(runRequirementsGuard(withLog).code).toBe(0);
  });
});

describe('fleetPrBodyTrailers', () => {
  it('emits all three declarations, roadmap trailer last', () => {
    const block = fleetPrBodyTrailers('because reasons');
    const reqAt = block.indexOf('pr-requirements-exempt');
    const comAt = block.indexOf('pr-comments-exempt');
    const roadAt = block.indexOf('Roadmap-Item:');
    expect(reqAt).toBeGreaterThanOrEqual(0);
    expect(comAt).toBeGreaterThan(reqAt);
    expect(roadAt).toBeGreaterThan(comAt);
  });

  it('collapses a multi-line reason so the single-line trailer parser cannot truncate it', () => {
    const trailer = roadmapOptOutTrailer('line one\nline two   and\tthree');
    expect(trailer.split('\n')).toHaveLength(1);
    expect(trailer).toBe('Roadmap-Item: none — line one line two and three');
  });

  it('falls back to an honest generic reason rather than emitting a bare `none`', () => {
    expect(roadmapOptOutTrailer('   ')).toBe('Roadmap-Item: none — fleet-authored branch');
  });
});
