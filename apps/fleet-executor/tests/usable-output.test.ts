/**
 * The "no usable output" outcome (src/usable-output.ts + verdict.ts).
 *
 * Regression suite for the 2026-08-04 green-theater bug: a ship whose model
 * returned nothing the contract asked for was reported as "PASS · clean" — a
 * reviewer that reviewed nothing rendered as a reviewer that found nothing.
 *
 * Covers the classifier's two contract-derived tests and the gate semantics:
 * fail-closed for a blocking ship, visible-but-non-blocking for an advisory one.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyShipOutput,
  describeNoUsableOutput,
  MIN_REVIEWER_OUTPUT_CHARS,
  MIN_IDEATION_OUTPUT_CHARS,
} from '../src/usable-output.js';
import { aggregateConclusion, type ShipResult } from '../src/verdict.js';

const reviewer = { ideation: false };
const ideation = { ideation: true };

function ship(over: Partial<ShipResult>): ShipResult {
  return {
    ship: 'code-reviewer',
    blocking: false,
    verdict: 'PASS',
    errored: false,
    findings: [],
    ...over,
  };
}

describe('classifyShipOutput — contract floors are derived, not tuned', () => {
  it('derives the reviewer floor from the shortest legal reviewer answer', () => {
    // `buildOutputContract` states the findings block MAY be omitted, so the
    // shortest legal reviewer output is the mandatory verdict line alone.
    expect(MIN_REVIEWER_OUTPUT_CHARS).toBe('FLEET-VERDICT: PASS'.length);
  });

  it('derives the ideation floor from the shortest legal ideation answer', () => {
    // `ideationOutputContract` mandates BOTH an array and a verdict line.
    expect(MIN_IDEATION_OUTPUT_CHARS).toBe('```json\n[]\n```\nFLEET-VERDICT: PASS'.length);
  });

  it('does not hardcode the observed 34-char length as the threshold', () => {
    // The reported run showed 34 chars; the floor must come from the contract,
    // not from that datapoint. For reviewers the derived floor is well below it.
    expect(MIN_REVIEWER_OUTPUT_CHARS).toBeLessThan(34);
  });
});

describe('classifyShipOutput — unusable outputs', () => {
  it('flags a completely empty response', () => {
    const r = classifyShipOutput('', reviewer);
    expect(r.usable).toBe(false);
    expect(r.usable === false && r.reason).toBe('empty');
  });

  it('flags a response that is nothing but <think> reasoning', () => {
    // A reasoning model that spent its whole budget deliberating and never
    // answered must not be credited with the length of its own thinking.
    const r = classifyShipOutput('<think>I should look at the diff carefully…</think>', reviewer);
    expect(r.usable).toBe(false);
    expect(r.usable === false && r.reason).toBe('empty');
    expect(r.strippedLength).toBe(0);
  });

  it('flags a reply shorter than the shortest legal answer', () => {
    const r = classifyShipOutput('ok', reviewer);
    expect(r.usable).toBe(false);
    expect(r.usable === false && r.reason).toBe('below-contract-floor');
  });

  it('flags prose that answers nothing the contract asked for', () => {
    const r = classifyShipOutput(
      'I reviewed the change and it seems reasonable overall, nothing jumped out at me.',
      reviewer,
    );
    expect(r.usable).toBe(false);
    expect(r.usable === false && r.reason).toBe('no-contract-signal');
  });

  it('flags a refusal, however long', () => {
    const r = classifyShipOutput(
      "I'm sorry, but I cannot assist with reviewing this request.",
      reviewer,
    );
    expect(r.usable).toBe(false);
  });

  it('flags an ideation ship that proposed in prose without the contract block', () => {
    const r = classifyShipOutput(
      'Some ideas: we should probably extract the retry logic into its own module.',
      ideation,
    );
    expect(r.usable).toBe(false);
    expect(r.usable === false && r.reason).toBe('no-contract-signal');
  });
});

describe('classifyShipOutput — usable outputs are NOT flagged', () => {
  it('accepts the contract-minimal clean reviewer answer (the observed 34 chars)', () => {
    // This is an affirmative "I read the diff and found nothing", not silence.
    const minimal = '```json\n[]\n```\nFLEET-VERDICT: PASS';
    expect(minimal.length).toBe(34);
    expect(classifyShipOutput(minimal, reviewer).usable).toBe(true);
  });

  it('accepts a bare verdict line (the findings block is optional for reviewers)', () => {
    expect(classifyShipOutput('FLEET-VERDICT: BLOCK', reviewer).usable).toBe(true);
  });

  it('accepts real findings with a verdict', () => {
    const out =
      '```json\n[{"path":"src/a.ts","line":4,"severity":"HIGH","body":"npe"}]\n```\nFLEET-VERDICT: BLOCK';
    expect(classifyShipOutput(out, reviewer).usable).toBe(true);
  });

  it('accepts an answer that follows a <think> preamble', () => {
    const out = '<think>hmm, line 4 dereferences null</think>\n\nFLEET-VERDICT: PASS';
    expect(classifyShipOutput(out, reviewer).usable).toBe(true);
  });

  it('accepts the contract-minimal ideation answer', () => {
    expect(classifyShipOutput('```json\n[]\n```\nFLEET-VERDICT: PASS', ideation).usable).toBe(true);
  });
});

describe('describeNoUsableOutput', () => {
  it('never uses a verdict word and never claims a review happened', () => {
    const text = describeNoUsableOutput('pd-code-reviewer', 'no-contract-signal');
    expect(text).toContain('pd-code-reviewer returned no usable output');
    expect(text).toContain('nothing was reviewed');
    expect(text).not.toMatch(/\bPASS\b|\bclean\b/);
  });
});

describe('aggregateConclusion — gate semantics for no usable output', () => {
  it('FAILS CLOSED when a BLOCKING ship produced nothing', () => {
    // An absent review is not an approval. This must never be `success`.
    const results = [ship({ blocking: true, verdict: 'BLOCK', noUsableOutput: true })];
    expect(aggregateConclusion(results)).toBe('failure');
  });

  it('noUsableOutput dominates a PASS verdict on a blocking ship', () => {
    // Defensive pin: whatever verdict a future classifier leaves on the result,
    // a blocking ship flagged noUsableOutput can never reach `success`. The
    // aggregator must not depend on the verdict field to hold this line.
    const results = [ship({ blocking: true, verdict: 'PASS', noUsableOutput: true })];
    expect(aggregateConclusion(results)).toBe('failure');
  });

  it('does NOT fail the merge gate for an ADVISORY ship that produced nothing', () => {
    const results = [ship({ blocking: false, verdict: 'PASS', noUsableOutput: true })];
    expect(aggregateConclusion(results)).not.toBe('failure');
  });

  it('but never launders an advisory no-output into success', () => {
    const results = [
      ship({ ship: 'code-reviewer', blocking: true, verdict: 'PASS' }),
      ship({ ship: 'snipe', blocking: false, verdict: 'PASS', noUsableOutput: true }),
    ];
    expect(aggregateConclusion(results)).toBe('neutral');
  });

  it('still returns success when every ship really did answer', () => {
    const results = [
      ship({ ship: 'code-reviewer', blocking: true, verdict: 'PASS' }),
      ship({ ship: 'snipe', blocking: false, verdict: 'PASS' }),
    ];
    expect(aggregateConclusion(results)).toBe('success');
  });
});
