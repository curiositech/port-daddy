/**
 * Unit tests for the contract-repair pass (src/repair.ts) — the fleet's first
 * line of defense against its own broken ships: heal formatting slips in-run
 * before the broken-ship doctrine fails anything.
 */

import { describe, it, expect } from 'vitest';
import {
  repairContractOutput,
  buildRepairSystemPrompt,
  REPAIR_ESCALATION_MODEL,
} from '../src/repair.js';

const CONTRACT = 'FLEET-VERDICT: PASS or FLEET-VERDICT: BLOCK on the last line.';

/** A call stub returning queued responses and recording (model, system). */
function seqCall(responses: string[]) {
  const calls: Array<{ model: string; system: string }> = [];
  return {
    calls,
    call: async (model: string, system: string) => {
      calls.push({ model, system });
      return responses[calls.length - 1] ?? '';
    },
  };
}

describe('repairContractOutput', () => {
  it('heals on the FIRST attempt (same model) and reports who healed it', async () => {
    const { calls, call } = seqCall(['FLEET-VERDICT: PASS']);
    const out = await repairContractOutput({
      shipLabel: 'pd-lookout',
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      contract: CONTRACT,
      priorOutput: 'I looked around and things seem okay',
      reason: "failed the 'no-contract-signal' contract test",
      call,
      validate: t => /FLEET-VERDICT/.test(t),
    });
    expect(out.healed).toBe(true);
    expect(out.healedBy).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    expect(out.text).toBe('FLEET-VERDICT: PASS');
    expect(out.attempts).toEqual([
      { model: '@cf/qwen/qwen3-30b-a3b-fp8', ok: true, outputLength: 19 },
    ]);
    expect(calls).toHaveLength(1);
  });

  it('escalates to the stronger tier when the ship model fails twice running', async () => {
    const { calls, call } = seqCall(['still prose, no verdict', 'FLEET-VERDICT: PASS']);
    const out = await repairContractOutput({
      shipLabel: 'pd-snipe',
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      contract: CONTRACT,
      priorOutput: 'garbage',
      reason: 'malformed block',
      call,
      validate: t => /FLEET-VERDICT/.test(t),
    });
    expect(out.healed).toBe(true);
    expect(out.healedBy).toBe(REPAIR_ESCALATION_MODEL);
    expect(calls.map(c => c.model)).toEqual(['@cf/qwen/qwen3-30b-a3b-fp8', REPAIR_ESCALATION_MODEL]);
  });

  it('gives up honestly after both attempts — never self-certifies', async () => {
    const { call } = seqCall(['nope', 'still nope']);
    const out = await repairContractOutput({
      shipLabel: 'pd-spark',
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      contract: CONTRACT,
      priorOutput: 'the original garbage',
      reason: 'empty',
      call,
      validate: () => false,
    });
    expect(out.healed).toBe(false);
    expect(out.healedBy).toBe('');
    expect(out.attempts).toHaveLength(2);
    expect(out.attempts.every(a => a.ok === false)).toBe(true);
    // The caller keeps the ORIGINAL broken output for its raw-fallback posting.
    expect(out.text).toBe('the original garbage');
  });

  it('makes only ONE attempt when the ship already runs on the escalation tier', async () => {
    const { calls, call } = seqCall(['no luck']);
    const out = await repairContractOutput({
      shipLabel: 'pd-red-team',
      model: REPAIR_ESCALATION_MODEL,
      contract: CONTRACT,
      priorOutput: 'x',
      reason: 'empty',
      call,
      validate: () => false,
    });
    expect(out.healed).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('a throwing model call counts as a failed attempt, never an exception', async () => {
    let n = 0;
    const call = async () => {
      n += 1;
      if (n === 1) throw new Error('transport');
      return 'FLEET-VERDICT: PASS';
    };
    const out = await repairContractOutput({
      shipLabel: 'pd-qa',
      model: '@cf/qwen/qwen3-30b-a3b-fp8',
      contract: CONTRACT,
      priorOutput: 'x',
      reason: 'empty',
      call,
      validate: t => /FLEET-VERDICT/.test(t),
    });
    expect(out.healed).toBe(true);
    expect(out.attempts[0]).toMatchObject({ ok: false, outputLength: 0 });
  });

  it('the repair prompt names the failure, restates the contract, and forbids commentary', () => {
    const system = buildRepairSystemPrompt('pd-lookout', CONTRACT, 'no verdict line');
    expect(system).toContain('pd-lookout');
    expect(system).toContain('no verdict line');
    expect(system).toContain(CONTRACT);
    expect(system).toContain('NOTHING else');
  });
});
