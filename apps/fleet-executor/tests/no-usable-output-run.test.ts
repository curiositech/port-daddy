/**
 * End-to-end regression suite for the 2026-08-04 green-theater bug
 * (PR #4725, run:3a8aee50-9046-11f1-9d73-4cf5ca0facd1).
 *
 * A ship whose model returned nothing usable was folded into the same outcome
 * as a ship that read the diff and found no problems, so the run recorded
 * "PASS · clean" for a reviewer that reviewed nothing. These tests drive the
 * real `executeFleet` pipeline and assert on what the check run, the transcript
 * and the summary actually say.
 *
 * Also covers the second half of that report: a 9-call run whose run page
 * showed "Input tokens 0 / Output tokens 0" because the executor never wrote
 * token counts into any transcript step (the run page sums them from there).
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

function fleetYaml(ships: Array<{ name: string; blocking?: boolean }>): string {
  const body = ships
    .map(s => {
      const lines = [`    ${s.name}:`, '      trigger: pull_request:opened'];
      if (s.blocking) lines.push('      blocking: true');
      lines.push('      fallbacks:');
      lines.push('        - backend: cloudflare');
      lines.push("          model: '@cf/qwen/qwen2.5-coder-32b-instruct'");
      lines.push('      prompt: |');
      lines.push(`        ${s.name} ship: review the diff and report findings.`);
      return lines.join('\n');
    })
    .join('\n');
  return `fleet:\n  name: test\n  agents:\n${body}\n`;
}

const BLOCKING_REVIEWER = fleetYaml([{ name: 'code-reviewer', blocking: true }]);
const ADVISORY_REVIEWER = fleetYaml([{ name: 'qa', blocking: false }]);

function seedToken(kv: KVNamespace): void {
  void kv.put(
    'github_inst_42',
    JSON.stringify({ token: 'seeded-tok', expiresAt: Date.now() + 3_600_000 }),
  );
}

/** Model output that satisfies NOTHING the ship contract asked for. */
const NOTHING_USABLE = 'I took a look and it seems fine to me overall.';

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function runFleet(opts: {
  yaml: string;
  ship: string;
  output: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
}) {
  state.files.set('main:pd-fleet.yml', opts.yaml);
  const kv = memoryKV();
  seedToken(kv);
  const ai = aiStub({
    perShip: { [opts.ship]: opts.output },
    ...(opts.usage ? { usage: opts.usage } : {}),
  });
  const d1 = memoryD1();
  await executeFleet(makeJob(), makeEnv({ FLEET_TOKENS: kv, CONTROL_KV: kv, AI: ai.ai, DB: d1.db }));
  return { d1, ai };
}

describe('a ship that produced no usable output is never reported as a pass', () => {
  it('records a ship-no-output step instead of a PASS verdict step', async () => {
    const { d1 } = await runFleet({
      yaml: ADVISORY_REVIEWER,
      ship: 'qa',
      output: NOTHING_USABLE,
    });

    const kinds = d1.steps.map(s => s.kind);
    expect(kinds).toContain('ship-no-output');
    // The laundering path: no ship-verdict row may claim a verdict for this ship.
    expect(d1.steps.filter(s => s.kind === 'ship-verdict' && s.ship === 'qa')).toHaveLength(0);

    const step = d1.steps.find(s => s.kind === 'ship-no-output')!;
    expect(String(step.title)).toContain('returned no usable output');
    expect(String(step.title)).toContain('nothing was reviewed');
    // Never a verdict word — the run page renders this title verbatim.
    expect(String(step.title)).not.toMatch(/\bPASS\b/);
    expect(JSON.parse(String(step.detail))).toMatchObject({
      noUsableOutput: true,
      reason: 'no-contract-signal',
    });
  });

  it('says so in the check-run summary rather than printing PASS', async () => {
    await runFleet({ yaml: ADVISORY_REVIEWER, ship: 'qa', output: NOTHING_USABLE });
    const summary = state.completed[0].summary ?? '';
    expect(summary).toContain('no usable output — nothing was reviewed');
    expect(summary).not.toMatch(/pd-qa\S*: PASS/);
  });

  it('never treats an empty model response as a clean review', async () => {
    const { d1 } = await runFleet({ yaml: ADVISORY_REVIEWER, ship: 'qa', output: '' });
    const step = d1.steps.find(s => s.kind === 'ship-no-output')!;
    expect(JSON.parse(String(step.detail)).reason).toBe('empty');
  });
});

describe('gate semantics: advisory fails open, blocking fails closed', () => {
  it('an ADVISORY ship with no usable output does NOT fail the merge gate', async () => {
    await runFleet({ yaml: ADVISORY_REVIEWER, ship: 'qa', output: NOTHING_USABLE });
    expect(state.completed[0].conclusion).not.toBe('failure');
  });

  it('…but it is reported, not laundered into success', async () => {
    await runFleet({ yaml: ADVISORY_REVIEWER, ship: 'qa', output: NOTHING_USABLE });
    expect(state.completed[0].conclusion).toBe('neutral');
  });

  it('a BLOCKING ship with no usable output FAILS CLOSED', async () => {
    await runFleet({
      yaml: BLOCKING_REVIEWER,
      ship: 'code-reviewer',
      output: NOTHING_USABLE,
    });
    expect(state.completed[0].conclusion).toBe('failure');
  });

  it('a blocking ship that emits a bare "PASS" word fails closed', async () => {
    // Not a FLEET-VERDICT line — just the word. Below the reviewer contract
    // floor, so it is no usable output, not an approval.
    await runFleet({ yaml: BLOCKING_REVIEWER, ship: 'code-reviewer', output: 'PASS' });
    expect(state.completed[0].conclusion).toBe('failure');
  });

  it('a real clean review still passes the gate', async () => {
    await runFleet({
      yaml: BLOCKING_REVIEWER,
      ship: 'code-reviewer',
      output: '```json\n[]\n```\nFLEET-VERDICT: PASS',
    });
    expect(state.completed[0].conclusion).toBe('success');
  });
});

describe('token metering reaches the transcript the run page reads', () => {
  it('writes a ship-spend step carrying the Workers AI token counts', async () => {
    const { d1 } = await runFleet({
      yaml: BLOCKING_REVIEWER,
      ship: 'code-reviewer',
      output: '```json\n[]\n```\nFLEET-VERDICT: PASS',
      usage: { prompt_tokens: 1200, completion_tokens: 340 },
    });

    const spend = d1.steps.find(s => s.kind === 'ship-spend')!;
    expect(spend).toBeDefined();
    const detail = JSON.parse(String(spend.detail));
    // The run page sums exactly these keys out of fleet_run_steps.
    expect(detail.inputTokens).toBe(1200);
    expect(detail.outputTokens).toBe(340);
    expect(detail.usageReported).toBe(true);
    expect(detail.calls).toBeGreaterThan(0);
  });

  it('marks usage as NOT reported (rather than zero) when the model omits it', async () => {
    const { d1 } = await runFleet({
      yaml: BLOCKING_REVIEWER,
      ship: 'code-reviewer',
      output: '```json\n[]\n```\nFLEET-VERDICT: PASS',
    });

    const spend = d1.steps.find(s => s.kind === 'ship-spend')!;
    const detail = JSON.parse(String(spend.detail));
    expect(detail.usageReported).toBe(false);
    // Critically: NO zero token fields, so the page renders "not reported"
    // instead of a 0 that reads as "this run was free".
    expect(detail.inputTokens).toBeUndefined();
    expect(detail.outputTokens).toBeUndefined();
    expect(String(spend.title)).toContain('not reported');
  });
});
