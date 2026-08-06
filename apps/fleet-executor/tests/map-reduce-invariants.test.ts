/**
 * WHY MAP/REDUCE EXISTS — and the beliefs that make it worth its complexity.
 *
 * This file is not a unit test of a function. It is the architecture's premise,
 * written down as assertions, because the premise was violated for months and
 * nothing noticed.
 *
 * **The history this exists to prevent.** Fan-out review was built to solve ONE
 * problem — Workers AI models have small context windows, so a large diff has
 * to be split. It was *described* as solving a second: spend a cheap model many
 * times and a capable one once. The second half was never implemented. MAP and
 * REDUCE both called `env.AI.run(ship.cfModel, ...)`, so the code reviewer ran
 * every one of N chunk scans on `@cf/openai/gpt-oss-120b` at 6.9x the input
 * rate of the cheap model — spending the most on the stage needing the least
 * capability, and inverting the entire economic argument for fanning out.
 *
 * No test failed. Nothing could fail, because no test encoded what the design
 * was FOR. A structure whose justification lives only in prose degrades into a
 * structure with no justification at all, and then someone reasonably asks why
 * it is there.
 *
 * So the reasons are assertions now. Each test below names a belief the
 * architecture rests on. If a change makes one false, the build says which
 * belief died and why it mattered — not merely that a number moved.
 *
 * ── THE TWO REASONS ─────────────────────────────────────────────────────────
 *
 * REASON 1 — CONTEXT. A diff can exceed any single model's window, so it is
 *   split on file boundaries and each piece reviewed independently. This one
 *   was always real. It is why a file is the smallest unit we split to: half a
 *   function cannot be reviewed by anyone, model or human.
 *
 * REASON 2 — ECONOMY. Scanning a chunk for local defects is mechanical work.
 *   Synthesising across chunks — deciding what is genuinely missing, dropping
 *   duplicates, weighing severity — is judgement. Those deserve different
 *   models, and the cheap one should do the work that happens N times.
 *
 * Reason 2 is what makes the complexity pay. Without it, map/reduce is an
 * expensive way to work around a context limit, and every extra call is pure
 * overhead. THAT is the state this file was written to make impossible to
 * re-enter silently.
 */
import { describe, expect, it } from 'vitest';

import { mapModelFor, reduceModelFor, chunkDiff, mapChunkCharLimit } from '../src/execute.js';
import {
  WORKERS_AI_RATES,
  costUsdForModel,
  isPricedModel,
  MODEL_CONTEXT_TOKENS,
} from '../src/spend.js';
import { defaultPRShips } from '../src/fleet.js';

/** Blended per-million-token rate, weighted toward input (diffs are input-heavy). */
function blendedRate(model: string): number {
  const r = WORKERS_AI_RATES[model];
  if (!r) return Number.POSITIVE_INFINITY; // unpriced: cannot be reasoned about
  return r.input * 0.8 + r.output * 0.2;
}

const ships = defaultPRShips();
const reviewers = ships.filter(s => !s.ideation);

describe('REASON 2 — the fan-out must be economically forward, not backward', () => {
  it('no ship scans chunks on a model more expensive than it reduces with', () => {
    // THE BELIEF: MAP runs once per chunk, REDUCE runs once. If MAP's model
    // costs more per token, the fan-out spends the most where the least
    // capability is needed — which is worse than not fanning out at all, since
    // you also pay the coordination overhead.
    //
    // This is the invariant that was false for months while the code looked
    // fine, because both stages read the same field.
    for (const ship of ships) {
      const map = mapModelFor(ship);
      const reduce = reduceModelFor(ship);
      if (!isPricedModel(map) || !isPricedModel(reduce)) continue;
      expect(
        blendedRate(map),
        `pd-${ship.name}: MAP runs on ${map} but REDUCE on ${reduce}. MAP executes ` +
          `once per chunk and REDUCE once, so a more expensive MAP inverts the ` +
          `reason for fanning out.`,
      ).toBeLessThanOrEqual(blendedRate(reduce));
    }
  });

  it('the capable reviewer actually tiers its stages rather than paying top rate N times', () => {
    // THE BELIEF: a ship deliberately placed on the expensive model has the
    // MOST to gain from tiering — it is the only one whose per-chunk cost is
    // worth avoiding. A reviewer on the capable model with no cfMapModel is
    // the exact half-idea this file exists to catch.
    const capable = reviewers.filter(s => isPricedModel(s.cfModel) && blendedRate(s.cfModel) > blendedRate('@cf/qwen/qwen3-30b-a3b-fp8'));
    expect(capable.length, 'expected at least one ship on the capable model').toBeGreaterThan(0);
    for (const ship of capable) {
      expect(
        mapModelFor(ship),
        `pd-${ship.name} reduces on the capable model but scans every chunk with it too. ` +
          `Set cfMapModel, or state in the ship config why this one must not tier.`,
      ).not.toBe(reduceModelFor(ship));
    }
  });

  it('tiering saves real money at the scale that motivated it', () => {
    // THE BELIEF: the saving is worth the complexity. Not a vibe — a number.
    // #4956 required 92 chunks. If tiering does not move the cost materially at
    // that scale, the tiering itself is the half-idea and should be deleted
    // rather than maintained.
    const ship = reviewers.find(s => s.cfMapModel)!;
    expect(ship, 'no tiered reviewer to measure').toBeDefined();

    const CHUNKS = 92;
    const IN_PER_CALL = 3_000;
    const OUT_PER_CALL = 500;

    const tiered =
      costUsdForModel(mapModelFor(ship), IN_PER_CALL * CHUNKS, OUT_PER_CALL * CHUNKS) +
      costUsdForModel(reduceModelFor(ship), IN_PER_CALL, OUT_PER_CALL);
    const untiered = costUsdForModel(
      reduceModelFor(ship),
      IN_PER_CALL * (CHUNKS + 1),
      OUT_PER_CALL * (CHUNKS + 1),
    );

    expect(tiered).toBeLessThan(untiered);
    // At least a third cheaper, or the complexity is not earning its keep.
    expect((untiered - tiered) / untiered).toBeGreaterThan(0.33);
  });

  it('cost is summed per call, never one rate applied to the ship total', () => {
    // THE BELIEF: tiering breaks single-rate costing, and the REPORTING has to
    // break with it. The moment MAP and REDUCE can differ, pricing a ship's
    // summed tokens at `ship.cfModel` charges every cheap MAP token at the
    // capable model's rate -- reporting a number the operator was never billed,
    // overstated by very nearly the amount the tiering exists to save.
    //
    // The failure would be invisible: a plausible dollar figure, on a page whose
    // entire purpose is to be believed. So the divergence is measured, and the
    // wrong formula is asserted absent from the source that would produce it.
    const ship = reviewers.find(s => s.cfMapModel)!;
    const CHUNKS = 92;
    const IN_PER_CALL = 3_000;
    const OUT_PER_CALL = 500;

    const perCall =
      costUsdForModel(mapModelFor(ship), IN_PER_CALL * CHUNKS, OUT_PER_CALL * CHUNKS) +
      costUsdForModel(reduceModelFor(ship), IN_PER_CALL, OUT_PER_CALL);
    const singleRate = costUsdForModel(
      reduceModelFor(ship),
      IN_PER_CALL * (CHUNKS + 1),
      OUT_PER_CALL * (CHUNKS + 1),
    );

    // Not a rounding difference -- the wrong formula would more than double it.
    expect(singleRate / perCall).toBeGreaterThan(2);

    const src = readExecuteSource().replace(/\s+/g, ' ');
    expect(
      src,
      "execute.ts is pricing a ship's SUMMED tokens at a SINGLE model rate " +
        'again. Accumulate cost per call, at the model that call actually ran on.',
    ).not.toContain('costUsdForModel(ship.cfModel, metrics.inputTokens');
  });
});

describe('REASON 1 — context, and the limits of what a split can preserve', () => {
  it('the chunk budget comes from the model that reads the chunk', () => {
    // THE BELIEF: splitting is justified ONLY by a real context limit. Every
    // chunk beyond the first costs money and, worse, costs certainty — a
    // reviewer holding part of a diff cannot know what it is missing, which is
    // how "X is undeclared" gets reported about a declaration two chunks away.
    //
    // The budget was `12_000` with no recorded reasoning anywhere in the
    // source: ~3,000 tokens against a MAP model with a 32,768-token window.
    // 22% of recent commits to this repo crossed it, so a fifth of all reviews
    // were fragmented by a number no model asked for. A limit nobody can
    // justify is a limit nobody can correct, so it is derived now.
    for (const ship of ships) {
      const model = mapModelFor(ship);
      const window = MODEL_CONTEXT_TOKENS[model];
      if (!window) continue; // unknown model: falls back, asserted separately
      const budget = mapChunkCharLimit(model);
      // Must actually use the window — not a token of it, and not all of it.
      expect(budget).toBeGreaterThan(window); // > 1 char/token is a low bar, met by any real derivation
      expect(budget).toBeLessThan(window * 4); // room for prompt + output
    }
  });

  it('a typical change is ONE chunk, so most reviews have no partial view', () => {
    // THE BELIEF: fan-out is the exception, not the default. Measured against
    // this repo: at the old 12,000-char budget, 13 of the last 60 commits
    // fragmented; at a budget derived from the MAP model's window, 4 do.
    //
    // 21,440 chars is the p90 commit here. If a p90 change no longer fits in
    // one chunk, the budget has drifted back toward splitting-by-default and
    // every reviewer is guessing about code it cannot see.
    const P90_COMMIT_CHARS = 21_440;
    const tiered = reviewers.find(s => s.cfMapModel)!;
    expect(mapChunkCharLimit(mapModelFor(tiered))).toBeGreaterThan(P90_COMMIT_CHARS);
  });

  it('an unknown MAP model falls back to the old budget, not to nothing', () => {
    // THE BELIEF: degrade to the behaviour that shipped, never to an untested
    // one. A model with no recorded window cannot justify a larger budget, so
    // it gets the conservative value rather than a guess.
    expect(mapChunkCharLimit('@cf/some/unknown-model')).toBe(12_000);
  });

  it('a file is the smallest unit we split to', () => {
    // THE BELIEF: coherence survives a file boundary and does not survive a
    // byte boundary. A reviewer handed half a function has no more chance of
    // judging it than one handed none, so slicing mid-file buys cheaper calls
    // and pays in findings nobody can trust.
    //
    // This assertion was held back until #6013 landed the behaviour it
    // describes — an invariant belongs in the change that makes it true, or it
    // is just a wish written down. #6013 is merged, so it lives here now.
    const huge = `diff --git a/lib/huge.ts b/lib/huge.ts\n${'+  const filler = 1;\n'.repeat(2000)}`;
    expect(chunkDiff(huge)).toHaveLength(1);
  });

  it('splitting never loses or duplicates a file', () => {
    // THE BELIEF: the split is lossless. A reviewer's view may be partial, but
    // the UNION of views must be the whole diff, or findings are missing for
    // reasons no one can see.
    const diff = ['a', 'b', 'c', 'd', 'e'].map(
      n => `diff --git a/lib/${n}.ts b/lib/${n}.ts\n--- a/lib/${n}.ts\n+++ b/lib/${n}.ts\n@@ -1 +1 @@\n+x\n`,
    ).join('');
    const seen = chunkDiff(diff).flatMap(c => [...c.matchAll(/^\+\+\+ b\/(.+)$/gm)].map(m => m[1]));
    expect(seen.sort()).toEqual(['lib/a.ts', 'lib/b.ts', 'lib/c.ts', 'lib/d.ts', 'lib/e.ts']);
  });
});

/** Read execute.ts so prompt-contract beliefs can be asserted against real source. */
function readExecuteSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('node:fs') as typeof import('node:fs');
  const { join } = require('node:path') as typeof import('node:path');
  return readFileSync(join(__dirname, '..', 'src', 'execute.ts'), 'utf8');
}

describe('the division of labour that makes two stages necessary', () => {
  it('REDUCE is the only stage that may decide absence', () => {
    // THE BELIEF: this asymmetry is WHY there are two stages. If MAP could
    // judge what is missing, one stage would do and the second would be pure
    // cost. MAP sees one chunk, so "X is missing" is undecidable there; on
    // #4956 that produced ten findings, every one false, five of them HIGH.
    //
    // Asserted against the prompt rather than a function, because it is a claim
    // about what we ASK the model — and the prompt is where it was violated.
    // Whitespace-collapsed, because the belief is about what the prompt SAYS.
    // The source wraps at 80 columns, so a literal substring match would fail
    // for a reformat that changed nothing an agent reads.
    const src = readExecuteSource().replace(/\s+/g, ' ');
    expect(src).toContain('Do not report anything as missing');
    expect(src).toContain('decided later, by the stage that has every chunk');
  });

  it('a diagnostic names the model that actually ran, not the configured one', () => {
    // THE BELIEF: tiering makes `ship.cfModel` mean only "what this ship
    // REDUCES with", so every place that names a model has to be re-read. The
    // blackout warnings are the ones that matter most: they exist so an
    // empty-returning model is legible instead of a mystery green check
    // (2026-07-07 postmortem), and a warning that names the wrong model sends
    // whoever reads it to check the wrong model's status page.
    //
    // Raised in review on the tiering PR. Pinned here rather than fixed
    // quietly, because "grep for the other places cfModel is assumed" is
    // exactly the follow-through that gets skipped.
    //
    // The `$` is concatenated away from the `{` in the expected substrings
    // below. They are SOURCE TEXT being searched for, not interpolations -- but
    // written literally they read as a template placeholder inside a plain
    // quoted string, which is a genuinely suspicious shape everywhere else, so
    // CodeQL flags it and is right to. Splitting keeps the searched-for bytes
    // identical while removing the ambiguity for the next reader.
    const INTERP = '$' + '{';
    const src = readExecuteSource();
    expect(src).not.toMatch(/MAP chunk[^`]*EMPTY on[^`]*`\s*\+\s*`\$\{ship\.cfModel\}/);
    expect(src).toContain(`${INTERP}mapModelFor(ship)}: ${INTERP}describeResponseShape(res)}`);
    expect(src).toContain(`REDUCE EMPTY on ${INTERP}reduceModelFor(ship)}`);
  });

  it('a single-chunk diff skips REDUCE entirely', () => {
    // THE BELIEF: REDUCE earns its cost only when there is something to
    // reconcile. One chunk means no cross-chunk judgement exists to make, so
    // paying the capable model twice would be waste.
    const src = readExecuteSource();
    expect(src).toMatch(/chunks\.length === 1 \? partials\[0\]/);
  });
});
